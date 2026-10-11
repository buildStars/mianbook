---
difficulty: 2
tags: [高频, 实践]
---

# 大模型应用的流式输出，为什么常用 SSE 而不是 WebSocket？

::: tip 一句话回答
大模型的流式输出是典型的**服务端单向推送**：客户端发一次请求，服务端持续返回生成的内容。SSE 基于普通 HTTP，实现简单，能直接复用现有的网关、鉴权和负载均衡，主流大模型 API 也都用 SSE。WebSocket 是全双工长连接，适合需要双向实时通信的场景，比如实时语音对话、协同编辑。
:::

## 详细解析

### 对比

| | SSE | WebSocket |
| --- | --- | --- |
| 通信方向 | 服务端 → 客户端，单向 | 双向 |
| 协议 | 普通 HTTP，`Content-Type: text/event-stream` | 通过 HTTP Upgrade 切换到独立的 ws/wss 协议 |
| 数据格式 | 文本 | 文本或二进制 |
| 断线重连 | 浏览器的 EventSource 自带自动重连 | 需要自己实现 |
| 基础设施 | 走现有的 HTTP 链路，兼容性好 | 网关、代理需要专门支持 |
| 适合场景 | AI 回复、通知、进度推送 | 实时语音、聊天室、协同编辑、游戏 |

### SSE 的数据格式

每条消息由若干"字段: 值"行组成，以**空行**结束：

```text
data: {"delta":"你"}

data: {"delta":"好"}

data: [DONE]

```

### 实践要点：用 fetch，不用 EventSource

浏览器原生的 `EventSource` 只支持 GET 请求，也不能自定义请求头（比如 `Authorization`），而大模型接口通常要 POST 一大段对话记录。所以实践中一般用 `fetch` 读取流，自己解析：

```js
async function streamChat(messages, onDelta, signal) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal, // 传入 AbortController 的 signal，用户点"停止生成"时中断
  })

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    const events = buffer.split('\n\n')
    buffer = events.pop() // 最后一段可能还没收完整，留到下次拼接
    for (const event of events) {
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') return
        onDelta(JSON.parse(data).delta)
      }
    }
  }
}
```

生产环境也可以直接用成熟的解析库（如 eventsource-parser），处理换行符、多行 data 等边界情况。

### 部署时要注意

- Nginx 等反向代理默认会缓冲响应，要关闭缓冲（`proxy_buffering off;`，或者响应头加 `X-Accel-Buffering: no`），否则用户会看到内容一大段一大段地出现
- HTTP/1.1 下浏览器对同一域名最多保持约 6 个连接，多开几个页面就可能占满；HTTP/2 多路复用，没有这个问题
- 用户点击"停止生成"后，服务端也要感知连接断开、停止调用模型，避免继续消耗 token

## 面试官可能追问

::: details 什么场景必须用 WebSocket？
客户端需要在接收的同时持续发送数据的场景。比如实时语音对话：一边上传用户的语音，一边接收模型的语音回复，还要支持随时打断。
:::

::: details 流式渲染 Markdown 时页面闪烁怎么处理？
内容不完整时，没闭合的代码块、表格会让渲染结果反复跳动。可以节流渲染（比如每帧最多渲染一次），对未闭合的语法做临时补全，或者使用支持增量渲染的 Markdown 组件。
:::

::: details 首字延迟（TTFT）受哪些因素影响？怎么优化？
主要受模型大小、输入长度（模型要先处理完整个提示词才能输出第一个 token）、排队情况和网络影响。优化方法：利用提示词缓存（prompt caching）、精简上下文、选择更快的模型、就近部署。
:::

## 易错点

- SSE 不是长轮询，而是一次请求、持续接收
- 网络数据是分块到达的，一条消息可能被拆在两个块里，必须做缓冲拼接
