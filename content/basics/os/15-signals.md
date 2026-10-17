---
difficulty: 1
tags: [高频, 实践]
---

# Linux 信号是什么？kill -9 和 kill -15 有什么区别？

::: tip 一句话回答
信号是内核发给进程的**异步通知**，告诉它"发生了某件事"，进程可以**执行默认动作、忽略或者注册处理函数捕获**。`kill -15` 发的是 **SIGTERM**，也是 `kill` 不带参数时的默认信号，进程可以捕获它做清理再退出，属于"礼貌地请你退出"；`kill -9` 发的是 **SIGKILL**，**不能捕获也不能忽略**，内核直接终止进程，来不及关连接、刷缓冲。正确的停服务方式是先发 SIGTERM，等一段宽限期，还不退再发 SIGKILL。
:::

## 详细解析

### 信号从哪来，怎么处理

信号的来源：

- **终端按键**：Ctrl+C 发 SIGINT，Ctrl+\ 发 SIGQUIT，Ctrl+Z 发 SIGTSTP
- **其他进程**：`kill` 命令或 `kill()` 系统调用
- **内核**：访问非法内存发 SIGSEGV，向读端已关闭的管道写数据发 SIGPIPE，子进程退出时给父进程发 SIGCHLD

进程对每个信号有三种处置方式：执行默认动作（终止、终止并生成 core、停止、继续或忽略）、显式忽略、注册处理函数。内核在进程从内核态返回用户态时检查有没有待处理的信号，有就去执行。进程还可以用信号掩码暂时阻塞某些信号，它们会挂起，解除阻塞后再递送。

### 常见信号

| 信号 | 编号 | 默认动作 | 典型场景 |
| --- | --- | --- | --- |
| SIGHUP | 1 | 终止 | 终端断开；很多守护进程约定收到后重新加载配置 |
| SIGINT | 2 | 终止 | Ctrl+C |
| SIGKILL | 9 | 终止 | 强制杀死，不能捕获 |
| SIGSEGV | 11 | 终止并 core | 非法内存访问 |
| SIGPIPE | 13 | 终止 | 写已关闭的管道或 socket |
| SIGTERM | 15 | 终止 | `kill` 默认信号，请求优雅退出 |
| SIGCHLD | 17 | 忽略 | 子进程退出或停止，父进程借此 `wait` 回收 |
| SIGSTOP | 19 | 停止 | 暂停进程，不能捕获 |

编号以 x86/ARM 上的 Linux 为准，部分信号在其他架构上编号不同，脚本里写信号名更稳妥，比如 `kill -TERM`。SIGKILL 和 SIGSTOP 是唯二不能捕获、阻塞或忽略的信号，这保证管理员总能停住一个进程。

### 优雅退出怎么做

收到 SIGTERM 后，服务通常要：停止接收新请求，处理完进行中的请求，关闭数据库连接和文件，刷新日志缓冲，最后退出。下面是 Node.js 的写法：

```js
const http = require('http')
const server = http.createServer((req, res) => res.end('ok')).listen(3000)

function shutdown(signal) {
  console.log(`收到 ${signal}，开始优雅退出`)
  // 停止接收新连接，已有请求处理完后回调
  server.close(() => process.exit(0))
  // 兜底：超时还没关完就强制退出
  setTimeout(() => process.exit(1), 10000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
```

Go 的写法见[优雅关闭](/basics/go/12-graceful-shutdown)。用 `kill -9` 杀进程，以上清理全部跳过：缓冲区里的日志丢失，临时文件和锁文件残留，客户端看到连接被重置。

### 容器里 PID 1 收不到信号

`docker stop` 先给容器的 PID 1 发 SIGTERM，等待宽限期（默认 10 秒）后发 SIGKILL。常见问题是应用没收到 SIGTERM，每次都等满宽限期被强杀。原因有两个：

1. **PID 1 的特殊保护**：PID 命名空间里的 init 进程只会收到它注册了处理函数的信号，没注册的直接丢掉；唯一例外是从祖先命名空间（宿主机）发来的 SIGKILL 和 SIGSTOP 会强制递送，所以宽限期后的强杀总能生效。应用作为 PID 1 又没捕获 SIGTERM，这个信号就被丢掉
2. **shell 不转发信号**：Dockerfile 写成 `CMD node app.js`（shell 形式）时，PID 1 是 `/bin/sh -c`，它通常不会把信号转发给子进程

解决办法：用 exec 形式 `CMD ["node", "app.js"]`；启动脚本最后用 `exec` 替换成应用进程；或者用 `docker run --init` 之类的小型 init 进程负责转发信号和回收僵尸进程。

```bash
kill 1234            # 默认发 SIGTERM
kill -TERM 1234      # 同上，写信号名更清楚
kill -9 1234         # SIGKILL，最后手段
kill -l              # 列出所有信号
grep Sig /proc/1234/status   # SigBlk、SigIgn、SigCgt 是阻塞、忽略、捕获的信号位图
```

## 面试官可能追问

::: details kill -9 也杀不掉的进程是怎么回事？
一种是僵尸进程（Z 状态），它已经死了，只剩进程表项等父进程回收，要处理父进程。另一种是处于不可中断睡眠（D 状态）的进程，通常卡在磁盘或 NFS 等 I/O 上，信号要等它醒来才会处理。两种状态的排查见[进程状态和僵尸进程](/basics/os/11-process-state-zombie)。
:::

::: details 信号处理函数里能做什么？
只能调用异步信号安全的函数。信号可能在 `malloc` 执行到一半时到来，处理函数里再调 `malloc` 或 `printf` 就可能死锁或破坏数据。常见做法是只设一个标志位或往管道写一个字节，让主循环去做真正的处理。Node.js 和 Go 已经替你做了这层转换。
:::

::: details SIGHUP 为什么常用来重新加载配置？
SIGHUP 本意是"终端挂断"，守护进程本来就脱离了终端，不会收到真正的挂断，于是这个信号被约定挪作"重新读配置"。Nginx 收到 SIGHUP 会用新配置启动新的 worker，再让旧 worker 处理完请求后退出。它只是约定，应用自己不处理的话，默认动作是终止。
:::

## 易错点

- 一上来就 `kill -9`：进程没有机会清理，可能留下损坏的文件或未释放的外部锁
- 以为 `kill` 默认发 SIGKILL：默认是 SIGTERM
- 容器里应用不响应 `docker stop`，去调大宽限期，而没有检查 PID 1 是谁、有没有捕获信号
- 把信号当成可靠的消息通道：同一种普通信号挂起时多次发送只会记一次，不能用来计数，进程间传数据见[进程间通信](/basics/os/02-ipc)
