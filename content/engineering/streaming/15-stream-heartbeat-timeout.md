---
difficulty: 2
tags: [实践]
---

# 流式接口怎么处理心跳、超时和鉴权？

::: tip 一句话回答
负载均衡、网关这些中间设备会断开**一段时间没有数据**的连接，所以服务端要定期发心跳，SSE 里最方便的是发一行**注释** `: ping`，客户端解析时会忽略。超时要分开设：**首字超时**、**空闲超时**（两块数据之间）和**整体超时**，用一个计时器加 `AbortController` 实现。鉴权用 `fetch` 在请求头里带 Token，Token 只在建立连接时校验一次；快过期的 Token 先刷新再发请求。服务端要监听**客户端断开**，及时取消上游请求、释放资源。
:::

## 详细解析

### 为什么要心跳

一条流式连接里可能有很长的空白：推理模型在思考、Agent 在等工具结果、排队等 GPU。链路上的负载均衡、网关、代理通常都有**空闲超时**，一段时间没有数据就断开连接，前端看到的是莫名其妙的中断。

- 服务端每隔一段时间（比中间设备最短的空闲超时短）写一条注释行 `: ping\n\n`。按 SSE 规范，冒号开头的行是注释，`EventSource` 和规范的解析器都会忽略
- 心跳只在没有数据时才需要，有数据在发就不用发；实现上用定时器，每次写数据时重置
- 心跳写不进去本身就是信号：写入失败说明客户端已经断了
- 心跳解决的是空闲断开。整个响应被缓冲、一次性返回是另一个问题，见 [代理缓冲](/engineering/streaming/07-proxy-buffering)

### 三种超时分开设

| 超时 | 衡量什么 | 超时后 |
| --- | --- | --- |
| 首字超时 | 发请求到收到第一块业务数据 | 可以重试或切备用模型，用户还没看到内容 |
| 空闲超时 | 两块数据之间的间隔 | 判定连接卡死，提示中断，可尝试 [续传](/engineering/streaming/10-resume) |
| 整体超时 | 整个请求的总时长 | 防止无限生成，按场景设上限 |

只设一个整体超时不够：设短了长回答会被截断，设长了卡死的连接要等很久才发现。注意心跳也会重置空闲计时，如果想检测"只有心跳没有内容"，首字超时只认业务数据。

### 鉴权

`EventSource` 不能设置请求头，只能靠 Cookie 或把 Token 放在 URL 里，后者会出现在日志和历史记录中（见 [EventSource 的限制](/engineering/streaming/03-eventsource-limits)）。AI 应用一般用 `fetch` 发 POST，在 `Authorization` 头里带 Token。

- Token 只在建立连接时校验。一次流可能持续几分钟，中途过期一般不影响这次响应，不需要中途断开
- 发请求前检查 Token 剩余有效期，快过期就先刷新；收到 401 时刷新后重试一次，这时还没有输出内容，重试是安全的
- 续传、重连时要重新带上有效的 Token，不能复用建连时的旧 Token
- 服务端除了验证身份，还要校验这个用户能不能访问这个会话

### 服务端检测客户端断开

用户关页面、点停止、网络断开，服务端都应该尽快知道，否则会继续向模型要 token，白白花钱、占并发。Node.js 里监听响应的 `close` 事件，取消上游请求并清理定时器（前后端配合见 [停止生成](/engineering/streaming/04-abort)）。

## 代码示例

```js
// 服务端：SSE 心跳 + 断开检测（Node.js 原生 http）
import http from 'node:http'

http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  })
  const upstream = new AbortController() // 用来取消调用模型的请求
  let timer
  const resetHeartbeat = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { res.write(': ping\n\n'); resetHeartbeat() }, 15000)
  }
  const send = (data) => { res.write(`data: ${JSON.stringify(data)}\n\n`); resetHeartbeat() }
  resetHeartbeat()
  send({ text: '开始' })
  res.on('close', () => { // 客户端断开或响应结束都会触发
    clearTimeout(timer)
    upstream.abort()
  })
}).listen(3000)
```

```js
// 客户端：首字超时和空闲超时
async function readWithTimeouts(res, { firstMs, idleMs }, onChunk) {
  const reader = res.body.getReader()
  let got = false
  while (true) {
    const ms = got ? idleMs : firstMs
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(got ? 'idle timeout' : 'first byte timeout')), ms)
    })
    try {
      const { value, done } = await Promise.race([reader.read(), timeout])
      if (done) return
      got = true
      onChunk(value)
    } catch (err) {
      reader.cancel() // 释放连接
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
}
```

这里简化成"收到任何字节都算数据"，实际使用时可以在解析出 SSE 事件后再判断是不是心跳。整体超时可以直接用 `AbortSignal.timeout(ms)` 传给 `fetch`。

## 面试官可能追问

::: details 心跳间隔怎么定？
比链路上最短的空闲超时短，留出余量。不知道所有中间设备的配置时，先查负载均衡和网关的空闲超时，取一个明显更短的值。太频繁只是浪费一点带宽，影响不大。
:::

::: details 用 WebSocket 时心跳怎么做？
WebSocket 协议有 ping/pong 控制帧，服务端可以发 ping，浏览器会自动回 pong，但浏览器端的 JavaScript 不能主动发 ping，也看不到这些帧。需要客户端检测时，通常在应用层自己定义心跳消息。
:::

::: details 服务端没检测到断开会怎样？
上游模型继续生成，token 照样计费；并发槽位被占着，其他用户要排队；如果有 Agent 在执行工具，还可能继续产生副作用。所以断开要一路传到最上游，见 [服务端转发](/engineering/streaming/08-server-relay)。
:::

## 易错点

- 心跳用 `data:` 发，前端把它当成业务消息解析，出现空内容或 JSON 解析错误
- 只设整体超时，卡死的连接要等很久才发现
- 把 Token 拼在 URL 上用 `EventSource`，Token 被记进访问日志
- 只处理了正常结束，客户端断开后服务端还在调用模型
