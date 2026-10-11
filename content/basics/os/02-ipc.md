---
difficulty: 2
tags: [高频, 原理]
---

# 进程间通信有哪些方式？

::: tip 一句话回答
常见的有：**管道**和**命名管道（FIFO）**、**消息队列**、**共享内存**、**信号量**、**信号**、**Unix Domain Socket** 和**网络 Socket**。共享内存最快，因为数据不用在内核和进程之间来回拷贝，但要自己用信号量或锁做同步；信号只能传递"发生了什么事"，不适合传数据。实际开发里用得最多的是 **Socket**（本机用 Unix Domain Socket，跨机器用 TCP）、**管道**（Shell 的 `|`、父子进程通信），对性能要求极高的场景才用共享内存。
:::

## 详细解析

### 为什么需要 IPC

每个进程有独立的虚拟地址空间，进程 A 的指针在进程 B 里没有意义。要交换数据，只能借助内核提供的某种"中转"：要么让内核帮忙拷贝（管道、消息队列、Socket），要么让内核把同一块物理内存映射进两个进程（共享内存）。

### 各种方式

- **匿名管道**：`pipe()` 创建一对 fd，一端写一端读，单向、字节流。只能用于有亲缘关系的进程（通常是 fork 前创建，父子各留一端）。Shell 的 `cmd1 | cmd2` 就是它。管道有容量上限（Linux 2.6.11 起默认 16 个页，4KB 页时就是 65536 字节，可以用 `fcntl` 的 `F_SETPIPE_SZ` 调整），写满会阻塞写端
- **命名管道（FIFO）**：用 `mkfifo` 在文件系统里创建一个特殊文件，没有亲缘关系的进程也能通过路径打开它。数据仍然只经过内核，不会写到磁盘
- **消息队列**：内核维护的消息链表，按"消息"为单位收发，可以带类型或优先级，有 System V（`msgget`）和 POSIX（`mq_open`）两套接口。业务开发里很少直接用，更多是用 Kafka、RabbitMQ 这类中间件，它们是跨机器的另一回事
- **共享内存**：把同一块物理内存映射到多个进程的地址空间（`shm_open` + `mmap`，或 System V 的 `shmget`），读写就是普通的内存访问，不经过内核拷贝。没有任何同步机制，必须配合信号量、互斥锁或无锁结构使用
- **信号量**：本质是一个计数器，用来做同步和互斥（P/V 操作），本身不传数据，通常和共享内存搭配
- **信号**：异步通知，比如 `kill -TERM pid`、Ctrl+C 发 SIGINT。基本只携带信号编号（`sigqueue` 能额外附带一个整数或指针大小的值），进程可以捕获并处理，但 SIGKILL 和 SIGSTOP 不能被捕获或忽略
- **Unix Domain Socket**：用法和 TCP Socket 几乎一样，地址是一个文件路径。数据不经过网络协议栈，没有 TCP 的校验、重传和拥塞控制开销；还能传递文件描述符（`SCM_RIGHTS`）、获取对端进程的身份（`SO_PEERCRED`）
- **网络 Socket**：TCP/UDP，唯一能跨机器的方式，也是微服务之间通信的基础

### 对比

| 方式 | 速度 | 能否跨机器 | 适用场景 |
| --- | --- | --- | --- |
| 匿名管道 | 较快，要经内核拷贝 | 否 | 父子进程、Shell 命令串联 |
| 命名管道 | 较快 | 否 | 无亲缘关系的本机进程，简单的单向数据流 |
| 消息队列 | 较快 | 否 | 按消息收发、需要优先级 |
| 共享内存 | 最快，零拷贝 | 否 | 大量数据交换，例如数据库的共享缓冲区 |
| 信号量 | 不传数据 | 否 | 配合共享内存做同步 |
| 信号 | 不传数据 | 否 | 通知进程退出、重新加载配置 |
| Unix Domain Socket | 快于本机 TCP | 否 | 本机服务间通信 |
| TCP/UDP Socket | 受网络影响 | 是 | 跨机器通信、微服务 |

表里的速度只是定性比较，具体差多少取决于消息大小和使用方式，要以压测为准。

### 实际开发中的例子

- Nginx 和 PHP-FPM、应用和本机 MySQL、Docker CLI 和 dockerd 之间，常用 Unix Domain Socket（如 `/var/run/docker.sock`）
- 平滑重启：Nginx 收到 `SIGHUP` 重新加载配置，进程管理器先发 `SIGTERM` 让服务优雅退出
- Node.js 的 `child_process.fork()` 在父子进程之间建了一条 IPC 通道，`process.send()` 发送的就是序列化后的消息
- PostgreSQL 的多个后端进程通过共享内存访问同一块缓冲区，用锁做同步

## 代码示例

命名管道，两个终端之间传数据：

```bash
mkfifo /tmp/demo.fifo
# 终端 1：打开读端，没有写者时会阻塞
cat /tmp/demo.fifo
# 终端 2：写入后终端 1 立即输出
echo "hello" > /tmp/demo.fifo
```

用 Unix Domain Socket 做本机通信（Node.js）：

```js
// uds.mjs
import net from 'node:net'
import fs from 'node:fs'

const path = '/tmp/demo.sock'
fs.rmSync(path, { force: true }) // 上次没清理的 socket 文件会导致 EADDRINUSE

const server = net.createServer((conn) => {
  conn.on('data', (buf) => conn.end(`echo: ${buf}`))
})
server.listen(path, () => {
  const client = net.createConnection(path, () => client.write('ping'))
  client.on('data', (buf) => {
    console.log(buf.toString()) // echo: ping
    server.close()
  })
})
```

## 面试官可能追问

::: details 共享内存为什么最快？有什么代价？
其他方式都要把数据从发送方拷进内核，再从内核拷给接收方，还要进行系统调用。共享内存映射好以后，读写就是普通的内存访问，不再经过内核。代价是同步全靠自己：多个进程同时写会互相覆盖，要用信号量、进程间互斥锁或无锁队列；一个进程崩溃时持有的锁也可能没释放，需要额外处理。
:::

::: details Unix Domain Socket 和连 127.0.0.1 的 TCP 有什么区别？
走 127.0.0.1 的 TCP 仍然要经过完整的 TCP/IP 协议栈：三次握手、序号、确认、校验和、拥塞控制。Unix Domain Socket 是本机内核里直接在两个 socket 缓冲区之间传数据，开销更小，还能用文件权限控制谁能连接、传递文件描述符。缺点是只能本机用，部署到不同机器或容器时要改回 TCP。
:::

::: details 信号处理函数里能做什么？
信号可能在任意时刻打断正常代码，处理函数里只能调用异步信号安全的函数，像 `malloc`、`printf` 这类都不安全。常见做法是在处理函数里只设一个标志位或往管道写一个字节，主循环检测到后再做真正的处理。Go、Node.js 已经帮你做了这层转换：Go 用 `signal.Notify` 把信号发到 channel，Node.js 用 `process.on('SIGTERM', ...)` 在事件循环里回调。
:::

## 易错点

- 管道是单向的，要双向通信得建两个管道，或者改用 socketpair
- 共享内存本身不提供同步，"最快"的前提是同步做对了
- SIGKILL（`kill -9`）不能被捕获，进程没有机会做清理，优雅退出要先发 SIGTERM，超时后再用 SIGKILL
