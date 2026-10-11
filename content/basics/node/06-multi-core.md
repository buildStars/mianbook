---
difficulty: 2
tags: [高频, 对比]
---

# Node.js 怎么利用多核？cluster、child_process、worker_threads 有什么区别？

::: tip 一句话回答
一个 Node.js 进程只有一个线程执行 JS，只能用满一个 CPU 核。利用多核有两条路：**多进程**（child_process、cluster），每个进程有独立的内存和事件循环，通过 IPC 通信，一个崩溃不影响其他进程；**多线程**（worker_threads），在同一个进程里运行多个 JS 线程，开销更小，还能转移或共享内存，适合 CPU 密集的计算。让 Web 服务的吞吐随核数增长用 cluster，生产中常用 PM2 的 cluster 模式或部署多个容器副本；单个请求里的重计算交给 worker_threads。
:::

## 详细解析

### 多进程和多线程

| | 多进程 | 多线程（worker_threads） |
| --- | --- | --- |
| 内存 | 完全独立，数据通过 IPC 序列化传递 | 每个线程有自己的 V8 实例和堆，可以转移 ArrayBuffer，或用 SharedArrayBuffer 共享内存 |
| 隔离性 | 一个进程崩溃不影响其他进程 | Worker 里未捕获的异常会让这个 Worker 退出，并在主线程的 worker 对象上触发 `error` 事件（主线程要监听它）；线程同属一个进程，进程级的崩溃会影响所有线程 |
| 创建和通信开销 | 大：要启动新的 Node.js 进程 | 较小，但仍要创建新的 V8 实例，应该复用 |

### child_process：启动子进程

| 方法 | 特点 | 适用场景 |
| --- | --- | --- |
| `spawn(cmd, args)` | 默认不经过 shell，通过流读写子进程的输入输出 | 输出量大或长时间运行的命令，如 ffmpeg |
| `exec(cmd)` | 经过 shell 执行，输出先缓存在内存里，结束后一次性回调（默认上限 1 MiB） | 输出很少的简单命令 |
| `execFile(file, args)` | 和 exec 类似，但不经过 shell，参数不会被 shell 解析 | 执行带参数的外部程序 |
| `fork(modulePath)` | 启动新的 Node.js 进程运行指定模块，自带 IPC 通道，用 `send()` 和 `message` 事件通信 | 把任务交给另一个 Node.js 进程 |

`exec` 把整条命令交给 shell 解析，拼接了用户输入就可能被注入额外的命令。需要传参数时用 `execFile` 或 `spawn`。

### cluster：多进程共享端口

cluster 基于 `child_process.fork()`：主进程（primary）启动多个 worker 进程，它们运行同一份代码，可以监听同一个端口。除 Windows 外，默认由**主进程接收连接，再轮询分发**给各个 worker；Windows 上默认由 worker 直接接受连接，分配可能很不均衡。

```js
// server.mjs
import cluster from 'node:cluster'
import http from 'node:http'
import { availableParallelism } from 'node:os'

if (cluster.isPrimary) {
  // 主进程：按 CPU 核数启动 worker，自己不处理请求
  for (let i = 0; i < availableParallelism(); i++) cluster.fork()

  cluster.on('exit', (worker, code, signal) => {
    // 主动 disconnect 的（如逐个重启时）由重启逻辑负责补位，这里只补意外退出的
    if (worker.exitedAfterDisconnect) return
    console.log(`worker ${worker.process.pid} 意外退出（${signal ?? code}），重新启动一个`)
    cluster.fork()
  })
} else {
  // worker：各自是独立的进程，监听同一个端口
  http.createServer((req, res) => {
    res.end(`由进程 ${process.pid} 处理\n`)
  }).listen(3000)
}
```

worker 之间不共享内存，放在进程内存里的 session、缓存、限流计数器每个 worker 各有一份，要改放到 Redis 这类外部存储中。

### worker_threads：多线程

适合在不阻塞主线程的前提下做 CPU 密集计算，比如图片处理、加解密、解析大文件。主线程和 Worker 用 `postMessage` 通信，数据经过结构化克隆，思路和浏览器的 [Web Worker](/basics/browser/15-web-worker) 一样，只是 API 不完全相同，比如 Worker 里用 `parentPort` 收发消息：

```js
// fib-worker.mjs：在 Worker 线程里执行
import { parentPort, workerData } from 'node:worker_threads'

const fib = (n) => (n < 2 ? n : fib(n - 1) + fib(n - 2))
parentPort.postMessage(fib(workerData))
```

```js
// main.mjs
import { Worker } from 'node:worker_threads'

function runFib(n) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./fib-worker.mjs', import.meta.url), { workerData: n })
    worker.once('message', resolve)
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker 异常退出，退出码 ${code}`))
    })
  })
}

const timer = setInterval(() => console.log('主线程没有被阻塞'), 200)
console.log('fib(40) =', await runFib(40))
clearInterval(timer)
```

每个任务都新建 Worker 开销较大，实际项目会用**线程池**复用 Worker，比如 piscina 这类库。多个线程要频繁读写同一份数据时，可以传入 SharedArrayBuffer，配合 `Atomics` 做原子操作；Node.js 中使用 SharedArrayBuffer 没有浏览器那样的跨源隔离要求。

### 对比和生产实践

| | child_process | cluster | worker_threads |
| --- | --- | --- | --- |
| 本质 | 子进程，可以运行任意程序 | 多个运行相同代码的 Node.js 进程 | 同一个进程里的多个线程 |
| 通信 | 标准输入输出、IPC（fork） | IPC | `postMessage`、共享内存 |
| 典型用途 | 调用外部程序，如 ffmpeg、git | 让 Web 服务用满多核 | CPU 密集计算 |

生产环境很少直接写 cluster 代码：

- **PM2 的 cluster 模式**：`pm2 start app.js -i max` 按 CPU 核数启动多个实例，负责崩溃重启、逐个平滑重启（`pm2 reload`）和日志收集
- **容器多副本**：在 Kubernetes 等平台上，每个容器只运行一个 Node.js 进程，靠增加副本数扩容，由平台负责负载均衡和重启。在容器里要按分到的 CPU 配额决定进程数，不要直接按宿主机的核数

## 面试官可能追问

::: details 用 worker_threads 处理 HTTP 请求，能提高吞吐吗？
对 I/O 密集的请求没有帮助。事件循环本来就能并发处理大量 I/O，把请求转给 Worker 反而多了序列化和线程通信的开销。Worker 只对 CPU 密集的部分有用；要让整体吞吐随核数增长，应该用 cluster 或多实例。线程池和事件循环的关系见 [Node.js 是单线程的吗](/basics/node/02-io-model)。
:::

::: details 怎么做到不停机重启？
逐个替换 worker：先启动一个新 worker，等它触发 `listening` 事件，再对旧 worker 调用 `worker.disconnect()`。旧 worker 关闭监听、不再接收新连接，已有的连接处理完后退出；长连接可能迟迟不断开，要加超时，到时间还没退出就强制结束。依次替换所有 worker，任何时刻都有进程在提供服务，PM2 的 `reload` 做的就是这件事。单个进程怎么优雅退出，见 [Node.js 服务怎么处理异常](/basics/node/07-error-handling)。
:::

::: details 多个 worker 之间要共享状态怎么办？
进程之间不共享内存，常见做法是把状态放到外部：会话、缓存放 Redis，限流计数用 Redis 的原子操作（见 [用 Redis 实现限流](/basics/redis/10-rate-limit)）。确实需要进程之间互相通知时，可以通过主进程的 IPC 转发，但这只在单机内有效，多台机器部署时还是要靠外部存储或消息队列。
:::

## 易错点

- cluster 是多进程，不是多线程，worker 之间不共享内存
- worker_threads 只对 CPU 密集计算有帮助，不能提升 I/O 密集任务的性能
- 每个任务都新建一个 Worker 开销很大，要用线程池复用
- 在容器里按宿主机的核数启动进程，数量会超出容器的 CPU 配额
