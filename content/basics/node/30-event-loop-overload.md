---
difficulty: 3
tags: [场景题, 性能优化]
---

# Node.js 服务高峰期响应越来越慢，怎么判断是不是事件循环过载？怎么做过载保护？

::: tip 一句话回答
先分清慢在哪：是**自己的主线程忙不过来**，还是**在等下游**（数据库、接口）。判断主线程看两个指标：**事件循环延迟**（`perf_hooks.monitorEventLoopDelay`，单位是纳秒，看 p99 和 max）和**事件循环利用率**（`performance.eventLoopUtilization`，接近 1 说明主线程几乎没有空闲）。确认过载后做**过载保护**：超过阈值直接返回 `503` 加 `Retry-After`，牺牲一部分请求，好过所有请求一起超时。根本解决还是找出阻塞代码、把 CPU 密集任务挪到 worker、水平扩容。
:::

## 详细解析

### 先分清：慢在自己还是慢在下游

| 现象 | 主线程过载 | 下游变慢 |
| --- | --- | --- |
| 事件循环延迟 | 明显升高 | 基本正常 |
| 事件循环利用率 | 接近 1 | 不高，大部分时间在等 I/O |
| 进程 CPU | 一个核打满 | 不高 |
| 慢请求分布 | 所有接口一起变慢，连健康检查都慢 | 集中在调用这个下游的接口 |
| 下游自身的耗时 | 正常 | 升高 |

主线程过载时，**连纯内存的接口也会变慢**，因为请求在排队等主线程。下游慢则只影响相关接口，这时要看的是连接池、超时和下游的指标，加 Node.js 实例没用，反而可能把下游压垮。

### 两个关键指标

- **事件循环延迟**：定时器"本该执行"到"实际执行"之间的差。主线程在跑同步代码时，所有回调都得排队，延迟就上去了。`monitorEventLoopDelay()` 返回一个直方图，数值单位是**纳秒**，除以 `1e6` 才是毫秒。看 p99 和 max，平均值会把偶发的长阻塞抹平
- **事件循环利用率（ELU）**：一段时间内事件循环"在干活"的时间占比，0～1。传入上一次的结果可以算出这段时间的增量。它比 CPU 使用率更直接：CPU 使用率包含 GC 线程、线程池的开销，而 Node.js 的 JS 代码只能用满一个核，多核机器上整机 CPU 看着不高，主线程可能已经满了

这两个指标和 [日志与监控](/basics/node/19-logging-observability) 里的其他指标一起上报，按实例画图，高峰期一眼就能看出是哪一类问题。

### 过载保护：拒绝一部分，好过全部超时

主线程过载时继续接收请求，每个请求排队的时间越来越长，最后全部超过客户端超时，CPU 都花在了没人要结果的请求上。更好的做法是**快速失败**：

1. 定时采样延迟和 ELU，算出一个"是否过载"的标记，请求进来时只读这个标记，判断本身不能太贵
2. 过载时直接返回 `503`，带上 `Retry-After`，让客户端或网关稍后重试
3. 健康检查接口不在拒绝范围内，否则负载均衡会把实例摘掉，压力转到其他实例，引发连锁反应；是否摘除实例应该由明确的策略决定
4. 可以按优先级拒绝：先拒绝报表导出这类非核心请求，保住下单、登录

Fastify 生态有现成的插件 `@fastify/under-pressure`，可以配置 `maxEventLoopDelay`、`maxEventLoopUtilization`、`maxHeapUsedBytes`、`maxRssBytes` 等阈值，超过后自动返回 Service Unavailable，并通过 `retryAfter` 设置 `Retry-After` 头。这些阈值默认都是 `0`，表示不检查，不配置就等于没开。

### 根本解决

- **找出阻塞代码**：采样 CPU profile 看火焰图，常见的是大 JSON 的序列化、同步加解密、正则回溯，见 [CPU 飙高怎么排查](/basics/node/13-cpu-profiling)
- **把 CPU 密集任务挪出主线程**：放到 worker 线程池，见 [worker_threads 之间怎么通信](/basics/node/25-worker-threads-messaging)；更重的任务放进 [任务队列](/basics/node/18-task-queue) 异步处理
- **水平扩容**：多进程、多实例，见 [怎么利用多核](/basics/node/06-multi-core)。自动扩容的指标可以用 ELU，比 CPU 使用率更贴近真实负载

## 代码示例

不依赖框架，用原生 `http` 实现过载保护：

```js
import http from 'node:http'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'

const h = monitorEventLoopDelay({ resolution: 10 })
h.enable()
let overloaded = false
let last = performance.eventLoopUtilization()

// 每秒采样一次，请求进来时只读 overloaded
setInterval(() => {
  const elu = performance.eventLoopUtilization(last).utilization // 这一秒的增量
  last = performance.eventLoopUtilization()
  const p99Ms = h.percentile(99) / 1e6 // 纳秒转毫秒
  h.reset()
  overloaded = p99Ms > 200 || elu > 0.95 // 阈值要按压测结果定
}, 1000).unref()

http.createServer((req, res) => {
  if (overloaded && req.url !== '/healthz') {
    res.writeHead(503, { 'Retry-After': '5' })
    return res.end('busy')
  }
  res.end('ok')
}).listen(3000)
```

在本地连续请求一个同步阻塞 300ms 的接口，前几个请求返回 200，采样发现过载后，后续请求直接得到 503。

## 面试官可能追问

::: details 为什么阈值不能直接用 CPU 使用率？
JS 代码只跑在主线程上，一个进程最多用满一个核。8 核机器上整机 CPU 才 12% 左右，主线程可能已经满了。另外 GC、线程池里的压缩和加密也会占 CPU，它们不一定拖慢事件循环。ELU 和事件循环延迟直接反映"主线程有没有空"，更准确。
:::

::: details 返回 503 之后，客户端立刻重试不是更糟吗？
所以要带 `Retry-After`，客户端和网关的重试要有退避和上限，最好再加熔断。服务端还可以在网关层限流，在请求进入 Node.js 之前就挡掉一部分。
:::

::: details 事件循环延迟正常，但接口还是很慢，怎么查？
大概率在等下游：看数据库慢查询、连接池是否排队、下游接口的耗时。也可能是 libuv 线程池排队，比如大量 `fs`、`crypto.pbkdf2`、`zlib` 操作，它们不阻塞主线程，但会互相等待。
:::

::: details 阈值怎么定？
压测找到拐点：逐步加压，记录延迟 p99 和 ELU，找到响应时间开始急剧上升的位置，阈值设在它前面一点。上线后结合告警继续调，不同实例规格的阈值可能不同。
:::

## 易错点

- 把 `monitorEventLoopDelay` 的值当成毫秒：单位是纳秒，要除以 `1e6`
- 只看平均延迟：几次几百毫秒的阻塞会被大量正常样本平均掉，要看 p99 和 max
- `eventLoopUtilization()` 不传参数得到的是进程启动以来的累计值，要传入上一次的结果算增量
- 下游慢时盲目扩容 Node.js 实例：请求更多地打到下游，问题更严重
