---
difficulty: 2
tags: [高频, 原理]
---

# Node.js 是单线程的吗？它怎么处理高并发？

::: tip 一句话回答
"单线程"指的是**执行 JS 的主线程只有一个**，Node.js 进程本身是多线程的。网络 I/O 交给操作系统的 **I/O 多路复用**（Linux 的 epoll、macOS 的 kqueue、Windows 的 IOCP），一个线程就能同时等待大量连接；文件读写、`dns.lookup`、部分 crypto 和 zlib 操作放进 **libuv 的线程池**（默认 4 个线程）执行。主线程只负责执行回调、从不等待 I/O，所以 Node.js 适合 **I/O 密集型**服务；CPU 密集的计算会阻塞事件循环，拖慢所有请求。
:::

## 详细解析

### "单线程"指的是什么

- 我们写的 JS 代码都在主线程上运行，同一时刻只执行一段代码，不用考虑锁和线程安全
- 进程里还有其他线程：libuv 的线程池，V8 用来做垃圾回收、编译优化的后台线程等
- 主线程按[事件循环](/basics/node/01-event-loop)工作：取出已经就绪的事件，执行对应的回调，再取下一个

### 高并发靠非阻塞 I/O

```text
主线程（执行 JS）
  │ 发起 I/O：登记回调后立刻返回，继续处理别的请求
  ├──> 网络 I/O（TCP、UDP、管道）────> 操作系统多路复用：epoll / kqueue / IOCP
  └──> fs、dns.lookup、crypto、zlib ──> libuv 线程池（默认 4 个线程）
                    │ 完成后把事件交回事件循环
主线程取出事件，执行回调
```

以一个查数据库的请求为例：

1. 请求到达，主线程执行路由回调，向数据库发出查询（网络 I/O）
2. 这个 socket 交给 epoll 监听，主线程立刻返回，去处理其他请求
3. 数据库返回数据后，epoll 通知 libuv，事件循环在 poll 阶段执行回调，生成响应

传统的"一个连接一个线程"模型，连接越多线程越多，每个线程都要占用栈内存，线程切换也有开销。Node.js 用一个线程加事件通知服务大量连接，在以等待 I/O 为主的场景下资源占用更少。

### 哪些操作走线程池

操作系统对网络 I/O 有成熟的异步通知机制，但文件操作在各个平台上缺少统一、可靠的异步接口，`getaddrinfo` 这类系统调用本身也是同步的。libuv 就在线程池里调用这些同步接口，完成后再通知主线程：

| 操作 | 由谁完成 |
| --- | --- |
| TCP、UDP、HTTP 等网络 I/O | 操作系统多路复用，不占线程池 |
| `fs` 的异步 API（文件监听除外） | 线程池 |
| `dns.lookup()`，按域名建立连接时默认用它解析 | 线程池（内部调用同步的 `getaddrinfo`） |
| `dns.resolve4()` 等 `dns.resolve*()` | 直接向 DNS 服务器发查询，属于网络 I/O |
| `crypto.pbkdf2()`、`scrypt()`、`randomBytes()` 等异步版本 | 线程池 |
| `zlib` 的异步 API | 线程池 |

线程池默认 4 个线程，可以用环境变量 `UV_THREADPOOL_SIZE` 调整，上限 1024。要在启动时设置，比如 `UV_THREADPOOL_SIZE=8 node app.js`；在代码里改 `process.env` 不保证生效，比如线程池可能在用户代码运行前就已经创建。

## 代码示例

同时发起 8 个 pbkdf2 计算，观察线程池的排队：

```js
// pool.mjs
import { pbkdf2 } from 'node:crypto'

const start = performance.now()
for (let i = 1; i <= 8; i++) {
  pbkdf2('secret', 'salt', 300_000, 64, 'sha512', () => {
    console.log(`任务 ${i} 完成：${Math.round(performance.now() - start)}ms`)
  })
}
```

默认 4 个线程时，任务分两批完成，第二批的耗时大约是第一批的两倍；在核数足够的机器上用 `UV_THREADPOOL_SIZE=8 node pool.mjs` 运行，8 个任务几乎同时完成。完成的先后顺序不固定。

CPU 密集的同步代码会让所有请求一起等待：

```js
// block.mjs
import http from 'node:http'

http.createServer((req, res) => {
  if (req.url === '/slow') {
    const end = Date.now() + 5000
    while (Date.now() < end) {} // 模拟 5 秒的同步计算
  }
  res.end('ok\n')
}).listen(3000)
```

先请求 `/slow` 再请求 `/`，后者也要等将近 5 秒：主线程一直被占着，事件循环处理不了新的请求。这类计算应该放进 Worker 线程（见 [Node.js 怎么利用多核](/basics/node/06-multi-core)），或者拆成小块、用 `setImmediate` 分批执行，中间把主线程让出来。

## 面试官可能追问

::: details 线程池只有 4 个线程，会成为瓶颈吗？
会。线程池由 fs、`dns.lookup`、crypto、zlib 共用，一类任务又慢又多时，其他看似无关的操作也要排队。比如同时解析大量域名、DNS 服务器又响应慢，线程都卡在等待上，这时 CPU 占用不高，文件读写却越来越慢。可以按任务类型适当调大 `UV_THREADPOOL_SIZE`；CPU 密集的计算更适合交给 Worker 线程，不和 I/O 任务抢线程池。
:::

::: details 用域名发 HTTP 请求，会占用线程池吗？
请求和响应的收发是网络 I/O，不占线程池；但建立连接前默认要调用 `dns.lookup()` 解析域名，这一步在线程池里执行。新连接很多时，解析任务可能占满线程池，连带拖慢文件读写。常见做法：开启 keep-alive 复用连接，减少解析次数；通过请求的 `lookup` 选项换成带缓存的解析函数。
:::

::: details 怎么发现事件循环被阻塞了？
用 `perf_hooks` 的 `monitorEventLoopDelay()` 定时采样事件循环的延迟。它记录的是相邻两次采样的实际间隔，空闲时接近采样间隔，出现远大于采样间隔的值，说明有回调长时间占住了主线程：

```js
import { monitorEventLoopDelay } from 'node:perf_hooks'

const histogram = monitorEventLoopDelay({ resolution: 20 })
histogram.enable()
setInterval(() => {
  // 单位是纳秒，换算成毫秒
  console.log('p99:', (histogram.percentile(99) / 1e6).toFixed(1), 'ms', 'max:', (histogram.max / 1e6).toFixed(1), 'ms')
  histogram.reset()
}, 10_000).unref()
```

找到具体是哪段代码慢，可以用 `node --cpu-prof` 生成 CPU 分析文件，放到 Chrome DevTools 里看耗时最长的函数。
:::

::: details 既然是单线程，Node.js 怎么利用多核？
一个 Node.js 进程执行 JS 只能用满一个核。要用满多核，可以用 cluster 或 PM2 启动多个进程监听同一个端口，或者部署多个容器副本；单个请求里的重计算交给 worker_threads。详见 [Node.js 怎么利用多核](/basics/node/06-multi-core)。
:::

## 易错点

- "Node.js 是单线程的"只说对了一半：单线程的是 JS 的执行，I/O 由操作系统和线程池并发完成
- 网络 I/O 不走线程池，调大 `UV_THREADPOOL_SIZE` 对纯网络请求没有帮助（`dns.lookup` 解析除外）
- 异步 API 只是不用等待 I/O，回调里的计算照样占用主线程。`fs.readFileSync`、对很大的字符串做 `JSON.parse`、会灾难性回溯的正则，都会阻塞事件循环
