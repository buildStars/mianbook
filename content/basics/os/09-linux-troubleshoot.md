---
difficulty: 2
tags: [高频, 实践, 场景题]
---

# 线上服务器 CPU 或内存飙高，怎么用 Linux 命令排查？

::: tip 一句话回答
按"**机器 → 进程 → 线程 → 代码**"逐层缩小范围。CPU 高：`top` 找到占用高的进程，`top -H -p <pid>` 找到线程，再用语言自带的工具定位代码，Java 用 `jstack`，Go 用 `pprof`，Node.js 用 `--cpu-prof`。内存高：`free -h` 先看 **available** 而不是 free，`ps` 按 RSS 排序找进程，`dmesg` 查有没有被 **OOM Killer** 杀掉。还要分清 CPU 是用在用户态（us）、内核态（sy）还是在等 I/O（wa），**load average** 高不一定是 CPU 忙。
:::

## 详细解析

### 先看整体：load average 和 top

`uptime` 和 `top` 第一行的 load average 是最近 1、5、15 分钟的平均负载。Linux 上它统计的是**正在运行或等待运行的任务**加上**处于不可中断睡眠（D 状态，通常在等磁盘 I/O）的任务**，所以：

- 和 CPU 核数（`nproc`）比较：长期明显超过核数，说明任务在排队
- load 高但 CPU 使用率不高，多半是大量任务卡在 I/O 上，去看磁盘和 NFS 等存储
- 三个值对比能看趋势：1 分钟远大于 15 分钟，说明负载在上升

`top` 的 CPU 行要拆开看：

| 字段 | 含义 | 偏高时怀疑 |
| --- | --- | --- |
| us | 用户态 | 业务代码计算多，死循环、正则回溯、序列化 |
| sy | 内核态 | 系统调用太多、锁竞争（futex）、上下文切换 |
| wa | 等待 I/O | 磁盘慢或读写量大 |
| si | 软中断 | 网络包量大 |
| st | 被宿主机偷走的时间 | 云主机所在的物理机超卖 |

### CPU 飙高

1. `top` 后按 `P` 按 CPU 排序，找到进程 PID；多核机器上按 `1` 看每个核，确认是单核打满还是整体打满
2. `top -H -p <pid>` 看这个进程里哪个线程最忙，记下线程 ID
3. 按语言定位代码：
   - **Java**：用 `jstack <pid>` 按线程 ID 找到这个线程的堆栈。JDK 18 起 nid 直接是十进制；JDK 17 及以前要先 `printf '%x\n' <tid>` 转成十六进制，再搜 `nid=0x...`。GC 线程忙就转去看 GC 日志
   - **Go**：线程和 goroutine 不是一一对应的，直接用 pprof 采样：`go tool pprof http://<host>:<port>/debug/pprof/profile?seconds=30`（服务要引入 `net/http/pprof`）
   - **Node.js**：主线程打满时用 `--cpu-prof` 或 inspector 采集 CPU profile，见 [Node.js 服务 CPU 飙高怎么排查](/basics/node/13-cpu-profiling)
   - 通用：`perf top -p <pid>` 看热点函数，对 C/C++ 和内核态问题尤其有用

### 内存飙高

`free -h` 的输出：

- **buff/cache** 是内核用来缓存文件的内存，需要时可以回收，大不代表内存紧张
- **available** 是估算的、不用 swap 就能分给新程序的内存，判断内存够不够主要看它
- **free** 小很正常，Linux 会尽量把空闲内存用作缓存

接着找进程和原因：

1. `ps aux --sort=-rss | head` 按实际占用的物理内存排序
2. 看是否在持续增长：隔一段时间看 `/proc/<pid>/status` 里的 `VmRSS`，持续上涨不回落就怀疑泄漏
3. 被杀过没有：`dmesg -T | grep -iE 'out of memory|killed process'`，或 `journalctl -k | grep -i oom`
4. 进入语言层面：Java 用 `jmap` 导出堆、看 GC 日志；Go 用 `/debug/pprof/heap`；Node.js 对比堆快照，见 [Node.js 内存泄漏](/basics/node/08-memory-leak)

### 按场景的命令清单

| 场景 | 命令 | 看什么 |
| --- | --- | --- |
| 整体概览 | `uptime`、`top`、`vmstat 1` | 负载、CPU 各项、r（运行队列）、si/so（swap） |
| 进程 CPU 和内存 | `ps -eo pid,%cpu,%mem,rss,cmd --sort=-%cpu` | 谁占得最多 |
| 线程 | `top -H -p <pid>` | 最忙的线程 |
| 磁盘 I/O | `iostat -x 1`、`pidstat -d 1` | `%util`、`await`，哪个进程在读写 |
| 磁盘空间 | `df -h`、`df -i`、`du -h -d 1 /var` | 空间和 inode 是否用满，哪个目录大 |
| 网络连接 | `ss -s`、`ss -tanp`、`ss -lnt` | 连接数、状态分布，监听队列是否积压 |
| 打开的文件 | `lsof -p <pid>`、`lsof +L1` | fd 泄漏，已删除但未释放的文件 |
| 内核日志 | `dmesg -T` | OOM、磁盘错误、网卡异常 |

`iostat`、`pidstat` 属于 sysstat 包，`iotop`、`htop` 可能也需要单独安装，平时就应该在基础镜像里准备好。

## 代码示例

Java 进程 CPU 高时的完整流程：

```bash
top -H -p 1234                 # 找到最忙的线程，假设 TID 是 1250
jstack 1234 | grep -A 30 'nid=1250 '   # JDK 18 起 nid 是十进制
printf '%x\n' 1250                      # JDK 17 及以前先转十六进制，输出 4e2
jstack 1234 | grep -A 30 'nid=0x4e2'

# 连续抓几次堆栈，间隔几秒对比，持续出现在同一位置的才是热点
for i in 1 2 3; do jstack 1234 > /tmp/jstack.$i.txt; sleep 5; done
```

## 面试官可能追问

::: details top 里一个进程的 %CPU 显示 300%，正常吗？
正常。`top` 默认把单个进程的 CPU 使用率按单核计算，多线程进程用满三个核就显示 300%（这是 Irix 模式，按 `I` 可以切换成按总核数折算）。判断是否打满要和核数对比，也要看是否只有一个线程占满一个核，那种情况往往是死循环或单线程瓶颈。
:::

::: details 磁盘满了，du 统计出来却远小于 df 显示的已用空间，为什么？
常见原因是文件被删除了，但还有进程打开着它，空间要等文件被关闭才释放；`du` 遍历目录看不到它，`df` 却算它的占用。用 `lsof +L1` 找出这些文件和进程，重启进程或让它重新打开日志文件即可，见 [文件描述符](/basics/os/10-file-descriptor)。另一种可能是文件写在了挂载点下被覆盖的目录里。
:::

::: details 内存没满，进程却被 OOM 杀了，是怎么回事？
多半是容器或 cgroup 的内存限制先到了：进程所在的 cgroup 超过上限就会在这个 cgroup 内触发 OOM，和整机剩多少内存无关，Kubernetes 里表现为 OOMKilled，见 [requests 和 limits](/basics/container/08-k8s-resources)。还要注意 Java 这类运行时，堆之外还有元空间、线程栈、直接内存，只限制堆大小不够。
:::

## 易错点

- 看到 free 很小就以为内存不够，应该看 available
- load average 高不等于 CPU 忙，Linux 的 load 包含了等待磁盘 I/O 的 D 状态任务
- `top -H` 里显示的是十进制线程 ID；JDK 17 及以前 jstack 里的 nid 是十六进制，要先转换，JDK 18 起 nid 直接打印成十进制，不用再转
- 只排查到进程就停下，没有落到具体的代码或请求，问题还会复发；处理时先保留现场（堆栈、profile、日志），再重启恢复
