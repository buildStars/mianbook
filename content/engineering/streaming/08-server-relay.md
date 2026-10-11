---
difficulty: 3
tags: [高频, 实践]
---

# 服务端怎么把大模型的流式响应转发给前端？

::: tip 一句话回答
服务端以流式方式请求模型接口，**逐行解析**上游的 SSE，把每个片段**转换成自己约定的事件**（如 `delta`、`done`、`error`）再写给前端，而不是原样透传。这样能隐藏密钥和供应商细节、统一不同模型的格式，还能在中间插入审核、计费、保存等业务逻辑。转发时要**定时发送心跳注释行**，防止中间层断开空闲的连接；响应头发出后就不能再改状态码，中途出错只能发 `error` 事件；生成结束后**保存全文和 token 用量**；客户端断开时**中止上游请求**。
:::

## 详细解析

### 为什么不直接透传

| 透传的问题 | 转换后的好处 |
| --- | --- |
| 前端依赖供应商的数据格式，换模型就要改前端 | 前端只认自己的事件格式，换供应商只改服务端的适配层（见[适配器模式](/basics/design-pattern/07-adapter)） |
| 上游的错误信息、模型名、内部 ID 直接暴露给用户 | 只返回前端需要的字段，错误统一翻译成用户能看懂的提示 |
| 服务端拿不到完整的内容，也没法插入业务逻辑 | 边转发边拼接全文，结束后保存消息、记录用量；还可以在中间做内容审核、引用来源处理 |

密钥只保存在服务端，前端只调用自己的接口，这是前提（见 [API Key 怎么安全管理](/engineering/security/07-api-key)）。

### 事件设计

```text
event: delta
data: {"text":"你好"}

event: done
data: {"messageId":"8f3c…","usage":{"input":1200,"output":356}}

```

- `delta` 是文本片段；以后要支持工具调用、引用来源，再加对应的事件类型
- `done` 是明确的结束信号，带上消息 ID 和用量；出错时发 `error`。前端没收到 `done` 或 `error` 连接就断了，说明是异常中断
- 心跳用冒号开头的注释行（如 `: ping`），前端解析时直接忽略（见[前端怎么用 fetch 解析流式响应](/engineering/streaming/02-fetch-stream)）

### 几个关键点

1. **先确认上游成功，再写响应头**。上游返回 401、429 这类错误时，还能给前端返回合适的状态码和 JSON（下面的代码统一返回 502）；一旦写出了 200 和 SSE 响应头，后面的错误只能用 `error` 事件表达
2. **心跳**：模型排队、长时间思考或者执行工具时，可能很久没有输出，Nginx 的 `proxy_read_timeout`、负载均衡的空闲超时会把连接断掉。定期发一行注释，间隔要小于链路上最短的空闲超时（见[流式输出变成一次性返回](/engineering/streaming/07-proxy-buffering)）
3. **用量**：OpenAI 兼容的接口要在请求里传 `stream_options: { include_usage: true }`，最后会多一块只带 usage 的数据；其他厂商的字段不完全一样

## 代码示例

Express + Node.js 自带的 fetch，上游以 OpenAI 兼容的接口为例（省略了 `express.json()` 等初始化）。客户端断开时中止上游请求的原理，见[停止生成时前后端怎么配合](/engineering/streaming/04-abort)：

```js
import { randomUUID } from 'node:crypto'

app.post('/api/chat', async (req, res) => {
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) controller.abort() // 客户端提前断开，中止上游
  })

  const upstream = await fetch(`${process.env.LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LLM_API_KEY}` },
    body: JSON.stringify({
      model: process.env.LLM_MODEL,
      messages: req.body.messages,
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal: controller.signal,
  }).catch(() => null)
  if (!upstream?.ok) {
    if (upstream) console.error('upstream', upstream.status, await upstream.text()) // 详情只记日志
    return res.status(502).json({ message: 'AI 服务暂时不可用，请稍后再试' })
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' })
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000)

  const messageId = randomUUID()
  let text = ''
  let usage = null
  let status = 'completed'
  try {
    for await (const chunk of readUpstream(upstream.body)) {
      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) {
        text += delta
        send('delta', { text: delta })
      }
      if (chunk.usage) usage = chunk.usage
    }
    send('done', { messageId, usage: usage && { input: usage.prompt_tokens, output: usage.completion_tokens } })
  } catch {
    status = controller.signal.aborted ? 'stopped' : 'failed'
    if (status === 'failed') send('error', { message: '生成中断，请重试' })
  } finally {
    clearInterval(heartbeat) // 先停心跳，再结束响应
    res.end()
    if (text) await saveMessage({ id: messageId, text, usage, status }).catch(console.error)
  }
})

// 逐行解析上游的 SSE。按 OpenAI 兼容格式简化处理：每个事件只有一行 data
async function* readUpstream(body) {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() // 最后一行可能不完整，留到下次
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      yield JSON.parse(data)
    }
  }
}
```

## 面试官可能追问

::: details 前端网速很慢，服务端一直 res.write 会怎样？
写不出去的数据会先堆在内存里，`res.write` 返回 false 表示缓冲已经超过上限，这就是背压。大模型输出的速度不快，一般不成问题；但如果转发的是大文件或高速的数据流，要在 `write` 返回 false 时等 `drain` 事件再继续写，或者用 `pipeline` 把流连起来，见 [Stream 和背压](/basics/node/03-stream)。
:::

::: details 怎么同时支持多个模型供应商？
定义一套内部统一的事件，比如 delta、tool_call、usage、done，每个供应商写一个适配器，把它的流转换成统一事件。业务代码和前端只依赖统一的格式。再往上就是大模型网关：统一鉴权、路由、限流和计费，见[设计一个大模型网关](/engineering/system-design/05-llm-gateway)。
:::

::: details 为什么心跳用注释行，而不是发一个 ping 事件？
注释行是 SSE 规范的一部分，EventSource 和常见的解析库都会自动忽略，前端不用写任何过滤代码。发成普通事件也能工作，但每个客户端都要额外处理它，不小心还会把它当成正文显示出来。
:::

## 易错点

- 还没收到上游的响应就写出了 200 和 SSE 响应头，上游的 401、429 只能变成一条 `error` 事件，前端拿不到状态码
- 把上游的原始错误信息直接发给前端，可能暴露内部信息
- 结束响应前没有清掉心跳定时器，`res.end()` 之后再写入会报错
- 只在正常结束时保存消息，中途停止或出错时，已生成的内容和用量都丢了
