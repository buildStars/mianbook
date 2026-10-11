---
difficulty: 2
tags: [高频, 原理, 实践]
---

# 文件描述符是什么？Too many open files 怎么处理？

::: tip 一句话回答
Linux 里**一切皆文件**：普通文件、socket、管道、epoll 实例打开后都用一个非负整数表示，这就是**文件描述符（fd）**，它是进程 fd 表的下标，背后还有内核的**打开文件表**和 **inode** 两层结构。`Too many open files` 表示进程打开的 fd 数达到了 **RLIMIT_NOFILE** 上限（错误码 EMFILE），常见原因是**连接或文件用完没关**，或者并发确实超过了默认上限（很多系统默认软限制是 1024）。处理方法：先用 `lsof` 或 `/proc/<pid>/fd` 看是不是泄漏，再按需调大上限，systemd 服务要改 **LimitNOFILE**，改 `ulimit` 或 limits.conf 对它不生效。
:::

## 详细解析

### 三层结构

```text
进程 A 的 fd 表           系统级的打开文件表               inode
  0 ─────────────────> [偏移量、打开模式、引用计数] ──┐
  1 ─────────────────> [ ... ]                         ├──> inode（文件元数据、数据块位置）
  3 ─────────────────> [偏移量 100, O_RDONLY] ────────┘
进程 B 的 fd 表
  5 ─────────────────> [偏移量 0, O_WRONLY] ──────────────> 同一个 inode
```

- **fd 表**：每个进程一张，fd 就是下标。0、1、2 默认是标准输入、标准输出、标准错误；`open` 总是返回当前最小的可用编号
- **打开文件表**（打开文件描述）：每次 `open` 新建一项，记录读写偏移量、打开模式等。`dup` 和 `fork` 会让多个 fd 指向同一项，因此共享偏移量
- **inode**：文件本身，记录权限、大小、数据块位置、硬链接数。两个进程分别 `open` 同一个文件，得到两个打开文件表项，指向同一个 inode，各自维护偏移量

### 上限有哪几层

| 层级 | 查看 | 说明 |
| --- | --- | --- |
| 进程（RLIMIT_NOFILE） | `ulimit -n`（软）、`ulimit -Hn`（硬）、`cat /proc/<pid>/limits` | 超过时报 EMFILE；软限制可以由进程自己调高，但不超过硬限制 |
| 硬限制的天花板 | `cat /proc/sys/fs/nr_open` | RLIMIT_NOFILE 不能超过它，默认 1048576 |
| 整个系统 | `cat /proc/sys/fs/file-max`、`cat /proc/sys/fs/file-nr` | 所有进程打开文件总数的上限，超过时报 ENFILE；file-nr 第一个数是已分配的数量 |

修改方式取决于进程是怎么启动的：

- 登录 Shell 启动的进程：`/etc/security/limits.conf` 里配置 `nofile`，由 PAM 在登录时生效，要重新登录
- **systemd 管理的服务**：不经过 PAM 登录，limits.conf 对它不生效，要在 unit 文件的 `[Service]` 里写 `LimitNOFILE=65535`，然后 `systemctl daemon-reload` 并重启服务
- Docker 容器：`docker run --ulimit nofile=65535:65535`，或在 daemon 配置里设默认值
- 系统级：`sysctl -w fs.file-max=...`，写进 `/etc/sysctl.conf` 或 `/etc/sysctl.d/` 下的文件持久化

### 报错的常见原因

- **泄漏**：HTTP 响应体没关闭、数据库连接没归还、文件打开后异常路径上没关闭。表现是 fd 数随时间单调上涨，调大上限只能推迟报错
- **并发确实高**：每个连接占一个 fd，一个网关同时维持几万个长连接，默认的 1024 当然不够
- **连接没有复用**：每次请求下游都新建连接，并发高时同时打开的 socket 很多；关闭后还会留下大量 TIME_WAIT，占用本地端口

排查：先 `ls /proc/<pid>/fd | wc -l` 看当前数量，对比 `/proc/<pid>/limits` 里的上限；再用 `lsof -p <pid>` 看 fd 都是什么类型、指向哪里。大量指向同一个下游地址的 socket，或者大量 CLOSE_WAIT 状态的连接，基本就是代码没关闭连接。

### 硬链接和软链接

| | 硬链接（`ln a b`） | 软链接（`ln -s a b`） |
| --- | --- | --- |
| 本质 | 同一个 inode 的另一个目录项 | 一个独立的文件，内容是目标路径 |
| inode | 和原文件相同 | 有自己的 inode |
| 删除原文件 | 不受影响，链接数减 1，减到 0 才真正删除 | 链接失效，变成悬空链接 |
| 跨文件系统 | 不能 | 能 |
| 指向目录 | 一般不允许 | 可以 |

用 `ls -li` 能看到 inode 号和硬链接数。

### 删除正在写的大文件，空间为什么不释放

`rm` 只是删除目录项、把 inode 的链接数减 1。文件真正被释放，要同时满足**链接数为 0** 且**没有进程打开它**。日志文件被 `rm` 后，写日志的进程还持有 fd，还在继续写，`df` 显示的空间不会减少，`du` 却统计不到它。

处理：`lsof +L1` 找出已删除但仍被打开的文件；重启进程或让它重新打开日志（Nginx 用 `nginx -s reopen`）；不能重启时，可以通过 `/proc/<pid>/fd/<n>` 把文件截断为 0（进程不是用 `O_APPEND` 打开的话，后续写入会从原来的偏移继续，文件变成前面是空洞的稀疏文件，`ls` 看到的大小不变，但磁盘空间已经释放）。日常轮转日志用 logrotate，按程序是否支持重新打开日志，选择通知程序 reopen 或 `copytruncate`。

## 代码示例

```bash
# 当前 fd 数和上限
ls /proc/1234/fd | wc -l
grep 'open files' /proc/1234/limits

# fd 按类型统计，看是文件、socket 还是管道占得多（anon_inode 是 epoll、eventfd 这类）
ls -l /proc/1234/fd | awk 'NR>1 {print $NF}' | sed -E 's/:.*//; s#^/.*#file#' | sort | uniq -c | sort -rn
# 看每个 fd 的详情：TYPE 列是类型，NAME 列是路径或连接的两端地址
lsof -p 1234

# 已删除但还被打开的文件，把第 5 号 fd 指向的文件截断为 0
lsof +L1
: > /proc/1234/fd/5
```

Go 里最常见的 fd 泄漏：

```go
resp, err := http.Get(url)
if err != nil {
	return err
}
defer resp.Body.Close() // ✅ 必须关闭；漏掉这一行，连接不会被关闭或放回连接池，fd 越积越多
body, err := io.ReadAll(resp.Body)
```

## 面试官可能追问

::: details 为什么监听 socket 也会受这个限制？
每接受一个连接，`accept` 都会返回一个新的 fd。fd 用完后 `accept` 会失败，新连接进不来，而已建立的连接还能正常收发，表现为服务"部分不可用"。高并发服务启动时常常主动调高 RLIMIT_NOFILE 的软限制，Go 1.19 起运行时会在启动时自动把软限制调到硬限制。
:::

::: details 把上限调到很大，有什么风险？
fd 上限本身只是一个配额，调大不占内存，真正打开的 fd 才会占用内核内存。风险在于掩盖了泄漏：上限从 1024 调到一百万，泄漏的程序只是更晚出问题，到时可能连带耗尽内存或端口。另外有些老程序用 select，fd 编号超过 1023 就无法监视，调大上限后反而会出错。
:::

::: details 子进程会继承父进程的 fd 吗？
会。fork 后子进程复制了 fd 表；exec 后如果 fd 没有设置 close-on-exec（`O_CLOEXEC`），新程序也会继续持有它。这可能导致父进程关闭了监听端口，子进程还占着；或者文件被删除后空间迟迟不释放。不少现代运行时默认给新打开的 fd 设置 close-on-exec，Go 标准库和 Node.js（libuv）都是这样；C 程序要自己在 `open` 时加 `O_CLOEXEC`。
:::

## 易错点

- 改了 `/etc/security/limits.conf`，systemd 启动的服务不生效，要改 `LimitNOFILE`
- EMFILE 是进程级上限，ENFILE 是系统级上限，两者的处理方式不同
- 删除大日志文件后空间不释放，不是文件系统出错，是还有进程持有 fd，应该截断或让进程重新打开，而不是一直删
