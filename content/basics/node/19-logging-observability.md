---
difficulty: 2
tags: [实践, 高频]
---

# Node.js 服务的日志和监控应该怎么做？

::: tip 一句话回答
可观测性靠三类数据：**日志**记录发生了什么，**指标**反映整体趋势和健康度，**链路追踪**还原一个请求经过了哪些服务、每段花了多久。日志要输出**结构化的 JSON**（如用 pino），按级别区分，每条都带上 **traceId** 方便串起一个请求，并对密码、令牌等**敏感信息脱敏**。指标用 prom-client 暴露给 Prometheus，至少包括请求量、错误率、**延迟分位数**，以及 Node.js 特有的**事件循环延迟**和**堆内存**。链路追踪用 OpenTelemetry。告警按用户能感知到的症状来设，再配上**健康检查端点**给负载均衡和容器平台使用。
:::

## 详细解析

### 结构化日志

```text
❌ 2026-10-11 10:00:00 用户 1001 下单失败 库存不足
✅ {"level":50,"time":1791713084859,"traceId":"a1b2","userId":1001,"orderId":"o-9","msg":"下单失败","err":{"type":"StockError","message":"库存不足"}}
```

纯文本日志只能全文搜索；JSON 日志进入日志系统（如 ELK、Loki、云厂商的日志服务）后，可以按 `traceId`、`userId`、错误类型精确过滤和聚合统计。

| 级别 | 用途 |
| --- | --- |
| `fatal` | 进程即将退出 |
| `error` | 请求失败、需要人处理的错误 |
| `warn` | 异常但可以自动恢复，如重试成功、触发降级 |
| `info` | 关键业务事件：启动、请求摘要、状态变化 |
| `debug` / `trace` | 排查用的细节，生产环境默认关闭 |

为什么常选 pino：它的设计目标是尽量减少对主线程的占用，序列化很快，格式化、发送到远端这些工作交给单独的 transport（可以在 worker 线程中运行）处理。日志直接写到标准输出，由容器平台或采集代理收集，应用不负责切割和上传文件。

### traceId 和脱敏

- **traceId**：在请求入口生成（或沿用上游传来的），放进 [AsyncLocalStorage](/basics/node/12-async-local-storage)，用 pino 的 `mixin` 让每条日志自动带上，业务代码不用手动传。调用下游服务时，通过请求头把它传下去
- **脱敏**：pino 的 `redact` 按路径把字段替换成 `[Redacted]`，比如 `req.headers.authorization`、`*.password`。手机号、身份证号这类个人信息也要掩码。脱敏要在日志离开进程前完成，日志系统的访问权限通常比数据库宽松得多
- **不要记录**：完整的请求体和响应体、大对象、每次循环一条的日志。日志量太大既花钱，也会拖慢服务

### 指标

| 指标 | 类型 | 说明 |
| --- | --- | --- |
| 请求数 | Counter | 按 method、路由、状态码打标签，算出 QPS 和错误率 |
| 请求耗时 | Histogram | 按桶统计，在 Prometheus 中用 `histogram_quantile` 算 P95、P99 |
| 事件循环延迟 | 默认指标 | `nodejs_eventloop_lag_*`，持续升高说明主线程被阻塞，见 [CPU 飙高](/basics/node/13-cpu-profiling) |
| 堆内存、GC | 默认指标 | `nodejs_heap_size_used_bytes`、GC 耗时，用来发现 [内存泄漏](/basics/node/08-memory-leak) |
| 业务指标 | Counter / Gauge | 下单数、支付成功率、队列积压长度 |

- 看延迟要看**分位数**，平均值会掩盖少数很慢的请求
- 用 Histogram 而不是 Summary：Summary 在每个进程内算好分位数，多个实例的分位数无法再合并；Histogram 的桶可以跨实例相加后再算
- **标签基数要可控**：路由标签用模板（`/users/:id`），不能用原始 URL；不要把用户 ID、traceId 放进标签，否则时间序列数量会爆炸
- cluster 或 PM2 多进程时，每个进程各有一份指标，要用 prom-client 的 `AggregatorRegistry` 在主进程汇总，或者让每个进程单独暴露端口

### 链路追踪

OpenTelemetry 是目前通用的标准：在应用启动时加载它的 Node.js SDK 和自动插桩，HTTP、数据库、Redis 客户端的调用会自动生成 span，通过 `traceparent` 请求头在服务之间传递上下文，数据发给 Jaeger、Tempo 等后端展示。日志里带上 trace ID，就能从一条错误日志直接跳到对应的调用链。

### 告警和健康检查

- **按症状告警**：错误率、P99 延迟超过阈值，这些是用户能感知到的；CPU 高、内存高这类原因型指标作为排查线索，而不是半夜叫醒人的告警。告警要有明确的处理办法，频繁误报的告警要调整或删除
- **存活检查**（`/healthz`）：只要进程能响应就返回 200，不检查数据库。失败会导致容器被重启，数据库一抖动所有实例都被重启，反而扩大故障
- **就绪检查**（`/readyz`）：启动完成、依赖可用才返回 200，失败时只是暂时不分配流量。优雅退出时先让它返回失败，见 [Kubernetes 的探针](/basics/container/07-k8s-probes-rollout)

## 代码示例

```js
import http from 'node:http'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import client from 'prom-client'

const als = new AsyncLocalStorage()
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  mixin: () => ({ traceId: als.getStore()?.traceId }), // 每条日志自动带 traceId
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password'],
})

client.collectDefaultMetrics() // CPU、堆内存、事件循环延迟、GC 等默认指标
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP 请求耗时',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 3],
})

http.createServer(async (req, res) => {
  if (req.url === '/metrics') {
    res.setHeader('Content-Type', client.register.contentType)
    return res.end(await client.register.metrics())
  }
  if (req.url === '/healthz') return res.end('ok')

  als.run({ traceId: req.headers['x-request-id'] ?? randomUUID() }, () => {
    // route 用路由模板，避免标签基数爆炸
    const end = httpDuration.startTimer({ method: req.method, route: '/login' })
    res.on('finish', () => end({ status_code: res.statusCode }))
    logger.info({ req: { headers: req.headers } }, '登录请求') // authorization 会被替换成 [Redacted]
    res.end('ok')
  })
}).listen(3000)
```

## 面试官可能追问

::: details 为什么不用 console.log 打日志？
`console.log` 没有级别、不是结构化的，无法按环境调整输出量。另外，它写入标准输出是同步还是异步取决于输出目标和平台：写文件时是同步的，在 Linux、macOS 上写终端也是同步的，日志量大时会阻塞事件循环；在这些平台上写管道则是异步的，进程突然退出时可能丢失还没写出的日志。专门的日志库提供级别、结构化字段、脱敏、子 logger（`logger.child({ module: 'order' })`），并对性能做了优化。
:::

::: details 错误日志应该怎么写？
把错误对象放在 `err` 字段里，而不是拼进消息字符串：`logger.error({ err, orderId }, '下单失败')`，pino 会序列化出类型、消息和堆栈。同一个错误只在最终处理它的地方记录一次，中间层要么处理、要么带上上下文继续抛出，否则一个错误会在日志里出现好几遍。
:::

::: details 日志量太大，成本很高怎么办？
先砍掉没人看的日志，生产环境只开 info 及以上；正常请求的摘要日志可以采样记录，错误日志全量保留；链路追踪同样可以按比例采样，或者只保留出错和慢的请求（尾部采样）。日志按重要程度设置不同的保留时间。
:::

## 易错点

- 把用户 ID、完整 URL 放进指标标签，时间序列数量爆炸
- 存活检查依赖数据库，数据库一抖动，所有实例被反复重启
- 只看平均响应时间，P99 已经很差却没有发现
- 在日志中打印完整的请求头或请求体，泄露令牌和个人信息
