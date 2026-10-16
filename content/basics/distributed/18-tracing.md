---
difficulty: 2
tags: [原理, 实践]
---

# 分布式链路追踪的原理是什么？TraceId 是怎么在服务之间传递的？

::: tip 一句话回答
一次请求经过的所有服务构成一条 **Trace**，用全局唯一的 **TraceId** 标识；每一段处理（一次 RPC、一次数据库查询）是一个 **Span**，记录开始时间、耗时和父 Span 的 ID，组合起来就是一棵调用树。服务间传递靠**上下文透传**：调用下游时把 TraceId 和当前 SpanId 写进 **HTTP 头**（标准是 W3C 的 `traceparent`）或 **MQ 消息头**，下游读出来接着往下记。数据量大时用**采样**控制成本。**OpenTelemetry** 是现在通用的采集标准。
:::

## 详细解析

### Trace 和 Span

```text
TraceId = 4bf92f35...（整条链路共用）

[网关 Span A ──────────────────────────────── 320ms]
   [订单服务 Span B，父=A ──────────────── 280ms]
      [MySQL Span C，父=B ── 30ms]
      [库存服务 Span D，父=B ──────── 200ms]
         [Redis Span E，父=D ─ 5ms]
```

每个 Span 至少包含：TraceId、自己的 SpanId、父 SpanId、操作名、开始时间、耗时、状态，还可以带标签（HTTP 方法、SQL 语句摘要）和事件（异常信息）。后端把同一个 TraceId 的 Span 按父子关系拼起来，就能看到时间瀑布图，一眼看出慢在库存服务。

### TraceId 怎么传递

1. 入口服务收到请求，请求头里没有追踪上下文，就生成新的 TraceId，创建根 Span
2. 调用下游前，SDK 把 TraceId 和当前 SpanId 注入请求头，这一步叫 **inject**
3. 下游收到后从头里取出上下文（**extract**），新建 Span，父 Span 就是上游传来的 SpanId
4. 进程内部靠线程局部变量或协程上下文传递（Java 的 ThreadLocal、Go 的 `context.Context`、Node.js 的 AsyncLocalStorage）

W3C Trace Context 标准定义的请求头格式：

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             版本 TraceId（32 个十六进制字符）  父 SpanId（16 个） 标志位（01 表示已采样）
```

发 MQ 消息时同样把上下文写进消息的 header 属性，消费者取出后接上链路。异步场景下消费者的 Span 常用 **Link** 关联生产者，而不是直接当子 Span，因为消费可能很久之后才发生。

最容易断链的地方是线程池和异步回调：任务换了线程，线程局部变量里的上下文没跟过去。要用 SDK 提供的包装器或手动传递上下文。

### 采样策略

每个请求都完整记录，存储和网络成本都很高。常见策略：

- **头部采样**：入口处按比例决定是否采样，决定结果通过 `traceparent` 的标志位传给下游，整条链路保持一致。简单，但可能漏掉恰好没被采中的慢请求和错误请求
- **尾部采样**：先收集所有 Span，等整条 Trace 结束后再决定保留哪些，例如保留所有出错和超过阈值的请求。更有价值，但收集端要缓存大量数据

### OpenTelemetry 和日志关联

OpenTelemetry（OTel）统一了 Trace、Metrics、Logs 的 API、SDK 和传输协议（OTLP），应用接入一次，数据可以发到不同的后端（例如 Jaeger、Zipkin 或商业 APM），不被某个厂商绑定。它还提供很多框架的自动埋点，HTTP 客户端、数据库驱动的 Span 不用手写。

链路追踪和日志配合才好用：日志里带上 TraceId 和 SpanId，在追踪系统里看到慢 Span 后，用 TraceId 去日志系统搜出这条请求在各服务的全部日志。日志系统的设计见 [设计一个日志收集和查询系统](/basics/backend-design/14-log-system)，接口慢的整体排查思路见 [接口请求很慢怎么排查](/basics/network/19-slow-request)。

## 代码示例

用 OpenTelemetry 的 JS API 手动创建 Span，HTTP 的注入和提取由自动埋点完成：

```js
import { trace, SpanStatusCode } from '@opentelemetry/api'

const tracer = trace.getTracer('order-service')

async function createOrder(input) {
  // startActiveSpan 会把新 Span 设为当前上下文，内部发起的调用自动成为它的子 Span
  return tracer.startActiveSpan('createOrder', async (span) => {
    try {
      span.setAttribute('order.items', input.items.length)
      const order = await saveOrder(input)
      return order
    } catch (err) {
      span.recordException(err)
      span.setStatus({ code: SpanStatusCode.ERROR })
      throw err
    } finally {
      span.end() // 必须结束，否则不会上报
    }
  })
}
```

## 面试官可能追问

::: details 链路追踪会不会影响服务性能？
有开销但通常可控：创建 Span 是内存操作，上报是异步批量发送的，不阻塞业务请求。主要成本在采样率高时的序列化和网络传输，以及后端存储。真正要注意的是给 Span 加太多大字段，或者在高频循环里创建 Span。
:::

::: details TraceId 怎么生成才能保证唯一？
W3C 标准规定 TraceId 是 128 位（16 字节）、不能全为 0，并建议用随机值生成，一般用安全随机数，概率上几乎不会冲突，不需要中心化发号。和分布式 ID 不同，它不需要有序，见 [分布式 ID 怎么生成](/basics/distributed/03-distributed-id)。
:::

::: details 链路追踪和 Metrics 监控有什么区别？
Metrics 是聚合后的数字，例如 QPS、P99 延迟、错误率，适合看整体趋势和告警，存储便宜。Trace 是单个请求的明细，适合定位具体某次请求慢在哪里。一般是 Metrics 告警发现问题，再用 Trace 和日志找到原因。
:::

## 易错点

- Span 的父子关系靠父 SpanId 建立，只传 TraceId 拼不出调用树
- 线程池、异步回调、MQ 是最常见的断链点，上下文要显式传递
- 头部采样的决定要沿链路传给下游，否则各服务各采各的，Trace 会残缺不全
