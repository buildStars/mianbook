---
difficulty: 2
tags: [实践, 原理]
---

# 怎么给 LLM 调用链做链路追踪？

::: tip 一句话回答
一个 **Trace** 代表一次完整的用户请求，由多个 **Span** 组成，每个 Span 是其中的一步操作（一次检索、一次模型调用、一次工具调用），记录起止时间、输入输出和属性，Span 之间的父子关系组成一棵树。LLM 应用的一次请求往往包含查询改写、检索、多轮模型调用和工具调用，用嵌套的 Span 记录下来，就能看清每一步花了多少时间和 token、在哪一步出了错。实现上可以用 OpenTelemetry 埋点（它有面向生成式 AI 的语义约定），也可以用 Langfuse、LangSmith 这类专门的 LLM 观测平台。
:::

## 详细解析

### Trace 和 Span

- **Trace**：一次请求的完整链路，其中所有 Span 共享同一个 trace ID
- **Span**：一个操作，包含名称、开始和结束时间、父 Span 的 ID、属性（键值对）、事件和状态（默认是 Unset，出错时设为 Error）
- **上下文传播**：同一进程内，通过上下文对象把当前 Span 传给下一层；跨服务时通过请求头传递（W3C Trace Context 标准的 `traceparent` 头），下游服务就能接着这条链路继续记录

### 一次请求的 Trace 长什么样

```text
POST /api/chat                         总耗时 6.2s
├─ rewrite_query   小模型               0.6s   输入 820 / 输出 45 tokens
├─ retrieve                             0.3s
│  ├─ vector_search                     0.12s  返回 50 条
│  ├─ keyword_search                    0.08s  返回 50 条
│  └─ rerank                            0.2s   保留 5 条
├─ chat 主模型（第 1 轮）                1.8s   首 token 0.7s，发起工具调用 get_order
├─ execute_tool get_order               0.4s   成功
└─ chat 主模型（第 2 轮）                3.1s   首 token 0.9s，输出 410 tokens
```

数字只是示例。从这棵树能直接看出：最慢的是第 2 轮生成，检索里的两路召回是并行的，模型调用了一次工具后再生成回答。

每个 Span 上记录哪些字段（模型和参数、token 用量、检索结果、工具的参数和结果等），见 [可观测性要关注哪些数据](/engineering/eval/06-observability)。根 Span 上再记录用户 ID（哈希后）、会话 ID、功能入口和 Prompt 版本，之后的用户反馈和评分也关联到这个 trace 上。

### OpenTelemetry 的生成式 AI 语义约定

OpenTelemetry 是厂商中立的观测标准，包括 API、SDK 和 OTLP 传输协议，数据可以发到任何兼容的后端。它为生成式 AI 定义了一套语义约定，统一了属性名，例如：

| 属性 | 含义 |
| --- | --- |
| `gen_ai.operation.name` | 操作类型，如 `chat`、`embeddings`、`execute_tool` |
| `gen_ai.provider.name` | 模型供应商 |
| `gen_ai.request.model`、`gen_ai.response.model` | 请求的模型、实际响应的模型 |
| `gen_ai.usage.input_tokens`、`gen_ai.usage.output_tokens` | 输入、输出的 token 数 |
| `gen_ai.response.finish_reasons` | 结束原因 |

模型调用的 Span 名称建议用"操作名 模型名"的形式（如 `chat` 加上模型名），工具调用用 `execute_tool` 加上工具名。输入输出的消息内容可能包含隐私，在约定里属于需要主动开启才采集的属性。这套约定还在演进，属性名改过（比如供应商原来记在 `gen_ai.system` 里，后来改成 `gen_ai.provider.name`），不同版本的埋点库输出的名字可能不一样，使用前以官方文档标注的状态为准。

### 用什么工具

- **专门的 LLM 观测平台**：例如 Langfuse（开源，可以自托管）、LangSmith 等，提供 trace 可视化、按 trace 打分和标注、Prompt 管理、评测集管理
- **已有的观测体系**：已经用 OpenTelemetry 加 Jaeger、Grafana Tempo 这类后端的团队，可以直接在现有链路里加上生成式 AI 的属性
- **自动埋点**：很多框架和 SDK 有现成的集成，能自动记录模型调用；检索、工具这类自己写的业务步骤，仍然要手动埋点

## 代码示例

用 OpenTelemetry 的 API 手动埋点。还需要初始化 SDK 和导出器，把数据发到后端；在 Node.js 里，Span 的父子关系能跨 `await` 传递，靠的是 SDK 注册的异步上下文管理器。这些初始化代码这里省略：

```ts
import { trace, SpanStatusCode, type Attributes, type Span } from '@opentelemetry/api'

const tracer = trace.getTracer('chat-service')

// 创建一个 Span，自动记录耗时和异常
function withSpan<T>(name: string, attributes: Attributes, fn: (span: Span) => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span)
    } catch (err) {
      span.recordException(err as Error)
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      throw err
    } finally {
      span.end() // 无论成功失败都要结束 Span
    }
  })
}

async function answer(question: string, userHash: string) {
  return withSpan('chat_request', { 'app.user': userHash }, async () => {
    // 在父 Span 的回调里创建的 Span，会自动成为它的子节点
    const docs = await withSpan('retrieve', {}, async (span) => {
      const hits = await hybridSearch(question, 5)
      span.setAttribute('app.retrieved_ids', hits.map((h) => h.id))
      return hits
    })

    const attrs = { 'gen_ai.operation.name': 'chat', 'gen_ai.provider.name': PROVIDER, 'gen_ai.request.model': MODEL }
    return withSpan(`chat ${MODEL}`, attrs, async (span) => {
      const res = await llm.chat({ model: MODEL, messages: buildMessages(question, docs) })
      span.setAttribute('gen_ai.usage.input_tokens', res.usage.inputTokens)
      span.setAttribute('gen_ai.usage.output_tokens', res.usage.outputTokens)
      return res.content
    })
  })
}
```

## 面试官可能追问

::: details 流式输出时，Span 什么时候结束？
在流真正结束时才结束 Span：正常读完、用户中断或者出错。中间可以把收到第一个片段的时间作为事件或属性记下来，用来计算首 token 延迟。用户中断要单独标记，不要和错误混在一起统计。
:::

::: details 前端、网关、模型服务分属不同的服务，怎么串成一条链路？
通过请求头传播 trace 上下文（`traceparent`），每个服务从请求头里取出上一级的 Span，在它下面继续记录。前端也可以生成或拿到 trace ID，用户点踩时一起上报，反馈就能和整条链路关联起来。调用外部的模型 API 时，链路只能记录到出站请求为止，看不到供应商内部的过程。
:::

::: details Agent 跑了几十步，trace 太大怎么看？
记录时控制体积：每一步的 Span 只记录必要的属性，大段内容（完整的工具返回、长文档）截断，或者存到别处只保留引用。在根 Span 上汇总总步数、总 token 和总费用，先看整体。查看细节时用时间线（瀑布图）找出最慢的一步，再按状态筛出出错的 Span。
:::

::: details 用专门的 LLM 观测平台，还是自己基于 OpenTelemetry 搭？
专门的平台开箱即用，对 Prompt、token、评分这类 LLM 特有的数据展示得更好，还带标注和评测功能；基于 OpenTelemetry 自建，可以和现有的监控、日志体系统一，数据完全由自己掌控。两者也可以结合：用 OpenTelemetry 埋点，同时导出到 LLM 观测平台和现有的后端，前提是平台支持接收 OpenTelemetry 的数据。
:::

## 易错点

- 只在入口打一条日志，看不到内部的每一步
- 并行或异步的步骤没有正确传递上下文，Span 之间丢了父子关系，trace 变成一堆零散的记录
- 把完整的用户输入输出直接写进属性，没有考虑大小限制和隐私
- 出错时没有结束 Span，或者没有标记错误状态
