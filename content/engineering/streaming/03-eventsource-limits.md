---
difficulty: 2
tags: [原理, 对比]
---

# EventSource 有哪些限制？为什么很多 AI 应用不用它？

::: tip 一句话回答
`EventSource` 是浏览器原生的 SSE 客户端，用法简单，还自带断线重连。但它**只能发 GET 请求**，**不能带请求体，也不能自定义请求头**，鉴权只能靠 Cookie 或 URL 参数；连接结束后它会**自动重连**，对"一问一答"的生成接口来说，可能触发重复生成；出错时也**拿不到状态码**。AI 对话要 POST 一长串消息、要带 `Authorization` 请求头，所以多数应用改用 fetch + ReadableStream 自己解析。站内通知、任务进度这类用 GET 就能表达的订阅，EventSource 仍然很合适。
:::

## 详细解析

### 限制一：只能 GET，不能自定义请求头

```js
const es = new EventSource('/api/notifications', { withCredentials: true })
```

构造函数只接受 URL 和一个 `withCredentials` 选项：
- 不能指定请求方法，不能发请求体。多轮对话的历史可能有几万字，放进 URL 不现实，URL 的长度也有限制
- 不能设置 `Authorization` 等请求头。鉴权只剩两条路：Cookie（同源自动携带，跨域要设置 `withCredentials` 并配置 CORS），或者把 token 放进 URL 参数。后者会留在服务器访问日志、浏览器历史和代理日志里，最好换成短期有效的一次性票据

### 限制二：自动重连可能导致重复生成

EventSource 把 SSE 看作长期的订阅，**只要连接断开就会重连**，包括服务端正常结束响应的情况：
1. 服务端生成完回答，结束响应
2. 等待一段时间后（默认时长由浏览器决定，服务端可以用 `retry:` 字段修改），浏览器自动重新请求同一个 URL
3. 服务端如果把它当成新请求，就会再生成一遍，重复计费

避免的办法：客户端收到结束事件后主动调用 `es.close()`；服务端对已经结束的任务返回 **204**，浏览器收到 204 就不再重连。重连请求会带上 `Last-Event-ID` 请求头（前提是之前的事件带过 `id`），服务端可以据此续传，见[断线续传](/engineering/streaming/10-resume)。

### 限制三：错误信息太少

`onerror` 拿到的只是一个普通的 `Event`，没有状态码，也没有响应体，分不清是 401 未登录、429 限流还是网络断了。服务端返回非 200 状态码时，EventSource 直接关闭；网络中断时，它又会默默重连。而 AI 应用恰恰需要明确的提示，比如"今天的额度用完了""请重新登录"。

### 限制四：HTTP/1.1 下的连接数

HTTP/1.1 下，浏览器对同一个域名最多同时保持约 6 个连接，所有标签页共用。每个 EventSource 长期占着一个连接，用户多开几个标签页，同域名的其他请求就要排队。HTTP/2 下多个请求共用一个连接，基本没有这个问题（见 [HTTP 各版本的区别](/basics/network/07-http-versions)）。这一点对 fetch 读流同样成立，只是 EventSource 通常一直挂着，问题更突出。

### 对比

| | EventSource | fetch + ReadableStream |
| --- | --- | --- |
| 请求方法 | 只有 GET | 任意 |
| 请求头、请求体 | 不能自定义 | 可以 |
| 断线重连 | 自动，带 `Last-Event-ID` | 自己实现 |
| 错误信息 | 拿不到状态码和响应体 | 完整的 Response |
| 中断 | `es.close()` | AbortController |
| 解析 SSE | 浏览器内置 | 自己写或用库 |

fetch 的解析方法见[前端怎么用 fetch 解析流式响应](/engineering/streaming/02-fetch-stream)。

### 什么时候仍然适合用 EventSource

- 服务端主动推送、GET 就能表达的订阅：站内通知、后台任务进度、日志输出
- 用 Cookie 鉴权的同源应用
- 需要自动重连和续传的长连接

AI 场景也可以组合使用：先用 POST 创建生成任务、拿到任务 ID，再用 EventSource 订阅这个任务的输出。请求体的问题由 POST 解决，断线重连交给 EventSource，前提是服务端的生成任务和连接是解耦的。

## 代码示例

```js
// 先 POST 创建任务，再用 EventSource 订阅输出
const { taskId } = await fetch('/api/chat/tasks', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages }),
}).then((res) => res.json())

const es = new EventSource(`/api/chat/tasks/${taskId}/events`) // 同源，自动带 Cookie
let answer = ''

// 服务端发送的是 event: delta，要用 addEventListener 监听，onmessage 收不到
es.addEventListener('delta', (e) => {
  answer += JSON.parse(e.data).text
  render(answer)
})
es.addEventListener('done', () => es.close()) // 必须主动关闭，否则会自动重连
es.onerror = () => {
  // 拿不到状态码；readyState 为 CLOSED 说明浏览器已经放弃重连
  if (es.readyState === EventSource.CLOSED) showError('连接失败，请重试')
}
```

## 面试官可能追问

::: details EventSource 的自动重连是怎么工作的？
连接断开后（包括服务端正常结束响应），浏览器等待一段重连时间，再请求同一个 URL；服务端可以发送 `retry: 毫秒数` 修改这个时间。如果之前收到的事件带有 `id`，重连请求会带上 `Last-Event-ID` 请求头。服务端返回 204 或其他非 200 状态码，或者 `Content-Type` 不是 `text/event-stream` 时，浏览器会彻底关闭连接，不再重连。
:::

::: details 一定要用 Cookie 鉴权的话，要注意什么？
跨域时要用 `new EventSource(url, { withCredentials: true })`，服务端返回 `Access-Control-Allow-Credentials: true`，并且 `Access-Control-Allow-Origin` 不能是 `*`。另外要防 CSRF：用 GET 触发生成本身就是一种副作用，别的网站可以让用户的浏览器发起这个请求、消耗用户的额度。Cookie 要设置合适的 `SameSite`，触发生成的操作最好放在 POST 里（见 [XSS 和 CSRF](/basics/browser/06-xss-csrf)）。
:::

::: details fetch 读流能不能也做到自动重连？
可以，但要自己实现：记录最后收到的事件 ID，遇到网络错误（不是用户主动中断）时按指数退避重新请求，并带上 `Last-Event-ID` 请求头。服务端能续传，重连才有意义，否则只能重新生成。@microsoft/fetch-event-source 这类库封装了这套逻辑。
:::

## 易错点

- 以为 EventSource 能发 POST 或设置请求头：它的构造函数只有 URL 和 `withCredentials`
- 收到结束事件后没有调用 `close()`，浏览器隔几秒就重连一次，服务端反复生成
- 服务端用 `event:` 指定了事件类型，前端却只写了 `onmessage`，什么都收不到
- 把 `onerror` 当成连接彻底失败：`readyState` 还是 `CONNECTING` 时，浏览器正在重连
