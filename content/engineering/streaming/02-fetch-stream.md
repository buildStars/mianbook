---
difficulty: 2
tags: [高频, 手写题]
---

# 前端怎么用 fetch 接收并解析流式响应？

::: tip 一句话回答
用 `res.body.getReader()` 逐块读取字节，用 `TextDecoder` 加上 `{ stream: true }` 解码，避免被切开的中文字符变成乱码。网络分块和 SSE 事件的边界没有关系：一块里可能有好几条事件，也可能只有半条，所以要把文本放进**缓冲区**，按**空行**切出完整的事件，再解析其中的 `event`、`data` 字段。通常封装成一个**异步生成器**，调用方用 `for await` 逐条处理，遇到 `[DONE]` 这类结束标记就停止。
:::

## 详细解析

### 读取：reader 和 TextDecoder

`fetch` 收到响应头就会 resolve，此时响应体还在传输中。`res.body` 是一个 `ReadableStream`，可以边收边读：

- `reader.read()` 返回 `{ value, done }`，`value` 是一块 `Uint8Array`。每块多大、在哪里切开，由网络和服务端的写入方式决定，不可预测
- UTF-8 下常用汉字占 3 个字节，一块数据可能正好在一个汉字中间结束。直接 `decoder.decode(value)` 会把不完整的字节解成乱码；加上 `{ stream: true }`，解码器会把末尾不完整的字节留着，和下一块拼起来再解码
- 流结束时再调用一次不带参数的 `decoder.decode()`，输出剩下的内容。也可以写成 `res.body.pipeThrough(new TextDecoderStream())`，内部做的是同样的流式解码

### SSE 的格式

```text
event: delta
data: {"text":"你好"}

: 冒号开头的是注释行，常用作心跳

data: 第一行
data: 第二行

data: [DONE]

```

- 事件之间用**空行**分隔。每行是"字段: 值"，冒号后面的一个空格不算内容。规范允许 `\n`、`\r\n`、`\r` 三种换行，自己实现时至少要兼容 `\r\n`
- `event` 是事件类型，没写时默认为 `message`；`data` 可以有多行，按换行符拼接起来；`id` 和 `retry` 用于断线重连（见[流式连接断了怎么续传](/engineering/streaming/10-resume)）
- `data: [DONE]` 不是 SSE 规范的内容，而是 OpenAI 等接口约定的结束标记。也有接口用专门的事件类型表示结束，自己的接口要约定清楚

### 为什么要缓冲

```text
第 1 块：data: {"text":"你"}\n\ndata: {"te
第 2 块：xt":"好"}\n\n
```

第 1 块里有一条完整的事件和半条事件，对每块直接 `JSON.parse` 一定会出错。正确的做法是：读到的文本追加到缓冲区，循环查找空行，切出完整的事件交给解析函数，剩下不完整的部分留在缓冲区，等下一块到了再拼。

## 代码示例

```js
// 把 fetch 的响应体解析成一条条 SSE 事件
export async function* readSSE(body) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      // stream: true：末尾不完整的多字节字符先留在解码器里，和下一块拼起来
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      let index
      while ((index = buffer.indexOf('\n\n')) !== -1) {
        const event = parseEvent(buffer.slice(0, index))
        buffer = buffer.slice(index + 2)
        if (event) yield event
      }
      if (done) return // 结尾不完整的半条事件，按规范丢弃
    }
  } finally {
    // 正常结束时这一步什么都不做；调用方提前 break 时，取消读取并断开连接
    reader.cancel().catch(() => {})
  }
}

function parseEvent(block) {
  let event = 'message'
  const data = []
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue // 注释行
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1) // 只去掉一个空格
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  return data.length ? { event, data: data.join('\n') } : null // 没有 data 的事件不派发
}

// 使用
const res = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages }),
  signal: controller.signal, // 用于"停止生成"
})
// fetch 只有网络错误才会 reject，4xx、5xx 要自己判断，不能把错误响应当成流来解析
if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? `请求失败（${res.status}）`)

let answer = ''
for await (const { event, data } of readSSE(res.body)) {
  if (data === '[DONE]') break
  if (event === 'error') throw new Error(JSON.parse(data).message)
  answer += JSON.parse(data).text
  render(answer)
}
```

## 面试官可能追问

::: details 流读完了，却没收到结束标记，说明什么？
说明连接被意外断开了，比如服务端崩溃、网关超时、网络中断。根据断开的方式，`reader.read()` 可能返回 `done: true`，也可能直接抛错。这种情况不能当成正常结束：已经显示的内容保留，同时提示"回答不完整"，让用户重试。所以服务端最好总是发送一个明确的结束事件，前端才能区分"正常结束"和"中途断开"。
:::

::: details 为什么 data 里推荐放 JSON，而不是直接放文本？
- 文本里的换行和 SSE 的格式冲突，必须拆成多行 `data`；`JSON.stringify` 会把换行转义，一条事件只占一行
- 模型输出的片段经常以空格开头（英文单词之间的空格），直接放文本时，解析时稍不注意用了 `trim()`，空格就被吃掉，单词连在一起
- JSON 方便以后扩展字段，比如带上消息 ID、引用来源
:::

::: details 有现成的库吗？为什么还要会手写？
有。例如 eventsource-parser 只负责解析 SSE 文本；@microsoft/fetch-event-source 在 fetch 之上封装了类似 EventSource 的接口，支持 POST、自定义请求头和重试。生产环境用成熟的库更省心，它们处理了 `\r` 换行、`retry` 字段等边界情况。手写考的是对分块、缓冲和解码的理解，线上排查乱码、丢字、事件粘连时也离不开这些知识。
:::

::: details 每收到一条事件就更新一次页面，会有性能问题吗？
会。一个回答可能有上千个片段，每次都触发渲染，再加上 Markdown 解析，主线程会很忙。一般先把片段攒起来，每帧最多更新一次，见[流式 Markdown 渲染](/engineering/streaming/05-markdown-streaming)和[打字机效果](/engineering/streaming/06-typewriter)。
:::

## 易错点

- 把每次 `read()` 拿到的数据当成一条完整的消息。分块和事件边界没有关系，必须缓冲
- `TextDecoder` 没加 `{ stream: true }`：中文偶尔出现乱码，只在汉字恰好跨块时出现，很难复现
- 没检查 `res.ok`：`fetch` 遇到 4xx、5xx 不会 reject，错误页面会被当成流来解析
- 按 `\n\n` 切分事件却没处理 `\r\n`，换行是 `\r\n` 的服务端发来的事件永远切不开
