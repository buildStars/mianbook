---
difficulty: 2
tags: [高频, 实践]
---

# WebSocket 的握手过程是怎样的？如何保活？

::: tip 一句话回答
WebSocket 借助一次 HTTP 握手建立：客户端发送带 `Upgrade: websocket` 和随机 `Sec-WebSocket-Key` 的 GET 请求，服务端返回 **101 Switching Protocols** 和由 Key 算出的 `Sec-WebSocket-Accept`，之后双方在同一个 TCP 连接上以**帧**为单位全双工通信。保活靠**应用层心跳**：定时发 ping，超时收不到 pong 就判定断线，再按**指数退避**自动重连。需要心跳，是因为代理和网关会断开长时间空闲的连接，而浏览器的 API 又不能直接发送 ping 帧。
:::

## 详细解析

### 为什么需要 WebSocket

HTTP 是请求-响应模式，服务端不能主动推送。用轮询模拟推送，大部分请求都是空跑，延迟还取决于轮询间隔；长轮询改善了延迟，但每收到一条消息都要重新发起请求，带上完整的请求头。WebSocket 握手一次，之后双方随时可以发消息，帧头最小只有 2 字节。

### 握手过程

```text
客户端请求：
GET /chat HTTP/1.1
Host: example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
Origin: https://example.com

服务端响应：
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

- 客户端发送的是 HTTP/1.1 的 GET 请求，`Sec-WebSocket-Key` 是随机生成的值（16 字节随机数的 Base64 编码）
- 服务端返回 101（见 [HTTP 常见状态码](/basics/network/09-status-codes)）。`Sec-WebSocket-Accept` 的算法是：把客户端的 Key 拼接上固定的 GUID `258EAFA5-E914-47DA-95CA-C5AB0DC85B11`，做 SHA-1，再做 Base64 编码，用来证明服务端确实支持 WebSocket，而不是把它当成了普通的 HTTP 请求
- `wss://` 是基于 TLS 的 WebSocket，和 HTTPS 的关系一样
- 这是 RFC 6455 定义的握手方式；HTTP/2 下另有基于扩展 CONNECT 方法的握手（RFC 8441），了解即可

### 握手之后：以帧为单位通信

- 数据帧有文本帧和二进制帧；控制帧有 ping、pong 和 close，close 帧可以带上状态码（如 1000 表示正常关闭）。收到 ping 的一方必须回复 pong
- 客户端发给服务端的帧必须做**掩码**处理（用随机的 4 字节掩码对数据做异或），服务端发给客户端的不做。掩码是为了防止恶意构造的数据被中间代理误解析、污染缓存，不是为了加密

### 保活：心跳和断线重连

为什么需要心跳：
- **中间设备会断开空闲连接**：代理、负载均衡、NAT 都有空闲超时。例如 Nginx 的 `proxy_read_timeout` 默认 60 秒，这段时间内后端没有发来数据，连接就会被断开
- **断网不一定能被感知**：手机切换网络、拔掉网线时，可能收不到任何关闭通知，连接处于"半开"状态，只有发数据时才能发现
- **TCP keepalive 不够用**：默认 2 小时才开始探测，见 [HTTP keep-alive 和 TCP keepalive](/basics/network/16-keepalive)
- **浏览器发不了 ping 帧**：浏览器会自动回复服务端发来的 ping，但 `WebSocket` API 没有发送 ping 的方法。所以通常在应用层自定义心跳消息，比如客户端定时发 `{"type":"ping"}`，服务端回复 `{"type":"pong"}`

断线重连：
- **指数退避加随机抖动**：间隔 1 秒、2 秒、4 秒……设置上限，再加一个随机值，避免服务重启后所有客户端在同一时刻涌入
- **监听网络状态**：`offline` 时暂停重连，`online` 时立即重连
- 重连成功后重置退避次数，重新订阅，并补拉断线期间的消息

### 部署和选型

- `Upgrade` 和 `Connection` 是逐跳的请求头，Nginx 默认不会转发给后端。代理 WebSocket 时要加上 `proxy_set_header Upgrade $http_upgrade` 和 `proxy_set_header Connection upgrade`（1.29.7 之前的版本还要加 `proxy_http_version 1.1`），并按需调大 `proxy_read_timeout`
- 如果只需要服务端单向推送（通知、AI 流式回复），用 SSE 更简单，见[为什么常用 SSE 而不是 WebSocket](/engineering/streaming/01-sse-vs-websocket)

## 代码示例

带心跳和自动重连的客户端封装：

```js
class ReconnectingSocket {
  constructor(url, onMessage) {
    this.url = url
    this.onMessage = onMessage
    this.retries = 0
    this.connect()
  }

  connect() {
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => {
      this.retries = 0
      // 每 25 秒发一次 ping，发出后 10 秒内没收到任何消息，就判定连接已失效
      this.pingTimer = setInterval(() => {
        this.send({ type: 'ping' })
        clearTimeout(this.pongTimer)
        this.pongTimer = setTimeout(() => this.close(true), 10000)
      }, 25000)
    }
    ws.onmessage = (event) => {
      clearTimeout(this.pongTimer) // 收到任何消息都说明连接正常
      const msg = JSON.parse(event.data) // 约定消息都是 JSON 文本
      if (msg.type !== 'pong') this.onMessage(msg)
    }
    ws.onclose = () => this.close(true) // error 之后一定会触发 close，统一在这里重连
  }

  send(data) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data))
  }

  // 关闭当前连接，reconnect 为 true 时按退避时间重连；外部调用 close() 则彻底关闭
  close(reconnect = false) {
    clearInterval(this.pingTimer)
    clearTimeout(this.pongTimer)
    clearTimeout(this.retryTimer)
    // 先解绑事件再关闭，不等旧连接的 close 事件（断网时它可能很久才触发）
    const { ws } = this
    ws.onopen = ws.onmessage = ws.onclose = null
    ws.close()
    if (!reconnect) return
    // 指数退避：1 秒、2 秒、4 秒……最长 30 秒，再加最多 1 秒的随机抖动
    const delay = Math.min(1000 * 2 ** this.retries, 30000) + Math.random() * 1000
    this.retries++
    this.retryTimer = setTimeout(() => this.connect(), delay)
  }
}
```

生产环境还要处理：`online` 事件触发时立即重连；根据 `close` 事件的 code 判断要不要重连（比如鉴权失败就不该重连）；断线期间待发送消息的缓存。

## 面试官可能追问

::: details 浏览器的 WebSocket 为什么不能设置 Authorization 请求头？怎么鉴权？
浏览器的 `WebSocket` 构造函数只接受 URL 和子协议两个参数，没有提供设置请求头的接口。常用的鉴权办法：
- **Cookie**：握手请求会像普通请求一样自动带上目标域名的 Cookie，服务端照常校验；跨站页面发起的握手也可能带上 Cookie，所以同时要校验 `Origin`，防止跨站劫持
- **URL 参数**：如 `wss://example.com/ws?token=xxx`，简单，但 token 会出现在访问日志里。最好先用普通接口换一个短期、一次性的票据，再拿票据连接
- **首条消息认证**：连接建立后，第一条消息发送 token；服务端认证通过前不处理其他消息，超时未认证就断开
:::

::: details 如何保证消息不丢？
连接断开时，已经发出、但对方还没处理的消息可能丢失，需要在应用层做确认：
- 每条消息带唯一 ID 或递增序号，接收方处理后回复确认（ack），发送方超时没收到确认就重发
- 重发可能造成重复，接收方按消息 ID 去重
- 断线重连后，客户端带上最后收到的序号，服务端补发之后的消息，这要求服务端把消息持久化或缓存一段时间
:::

::: details Socket.IO 和 WebSocket 是什么关系？
Socket.IO 是一个实时通信库。它的传输层可以用 WebSocket，也可以用 HTTP 长轮询，在此之上有自己的协议，提供自动重连、心跳、房间、广播、消息确认等功能。正因为有自己的协议，Socket.IO 客户端不能直接连接原生的 WebSocket 服务端，反过来也不行。
:::

## 易错点

- `Sec-WebSocket-Accept` 只用来确认服务端支持 WebSocket 协议，不是鉴权手段，鉴权要另外做
- WebSocket 不受同源策略和 CORS 的限制，服务端必须校验 `Origin`，否则可能被跨站劫持（CSWSH）
- 连接异常断开时，`close` 事件的 code 是 1006；`error` 事件之后一定会触发 `close`，重连逻辑放在 `onclose` 里，避免重复重连
