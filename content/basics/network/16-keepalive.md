---
difficulty: 2
tags: [原理]
---

# HTTP keep-alive 和 TCP keepalive 有什么区别？

::: tip 一句话回答
两者名字相似，但完全是两回事。**HTTP keep-alive** 是持久连接：在同一个 TCP 连接上发送多个 HTTP 请求，省掉重复握手的开销，HTTP/1.1 默认开启。**TCP keepalive** 是 TCP 层的保活探测：连接空闲一段时间后发送探测报文，检查对方是否还在，需要通过 `SO_KEEPALIVE` 开启，Linux 默认空闲 2 小时后才开始探测。前者是为了**复用**连接，后者是为了**发现**已经断掉的连接。
:::

## 详细解析

### 对比

| | HTTP keep-alive | TCP keepalive |
| --- | --- | --- |
| 所在层级 | 应用层（HTTP） | 传输层（TCP） |
| 作用 | 复用连接，减少 TCP 握手和 TLS 握手的开销 | 探测空闲连接的对端是否还在，清理死连接 |
| 开启方式 | HTTP/1.1 默认开启；HTTP/1.0 需要带上 `Connection: keep-alive` | 在 socket 上设置 `SO_KEEPALIVE` 选项 |
| 触发条件 | 一个请求结束后不关闭连接，等待下一个请求，空闲超时后关闭 | 连接空闲超过设定时间（Linux 默认 7200 秒）后，开始发送探测报文 |

### HTTP keep-alive：持久连接

- HTTP/1.0 默认每个请求新建一个连接，需要显式带上 `Connection: keep-alive`，服务端同意时在响应里也带上
- HTTP/1.1 默认就是持久连接，想关闭时用 `Connection: close`
- 服务端会设置空闲超时（如 Nginx 的 `keepalive_timeout`，默认 75 秒）和单个连接的最大请求数（如 Nginx 的 `keepalive_requests`），达到后关闭连接
- HTTP/1.1 的一个连接上，请求基本只能一个接一个地处理，所以浏览器会对同一个域名开多个连接；HTTP/2 只用一个连接多路复用，见 [HTTP 各版本的区别](/basics/network/07-http-versions)

Node.js 作为客户端调用其他服务时，也要注意复用连接。从 Node.js 19 开始，`http.globalAgent` 默认开启 keepAlive；更早的版本需要自己创建 Agent：

```js
import http from 'node:http'

const agent = new http.Agent({ keepAlive: true, maxSockets: 50 })

http.get('http://user-service/api/users/1', { agent }, (res) => {
  // 响应体必须读完（或调用 res.resume() 丢弃），连接才能回到连接池被复用
  res.resume()
})
```

### TCP keepalive：保活探测

Linux 的默认参数：

```bash
$ sysctl net.ipv4.tcp_keepalive_time net.ipv4.tcp_keepalive_intvl net.ipv4.tcp_keepalive_probes
net.ipv4.tcp_keepalive_time = 7200
net.ipv4.tcp_keepalive_intvl = 75
net.ipv4.tcp_keepalive_probes = 9
```

- 连接空闲 7200 秒后开始探测，之后每 75 秒探测一次，连续 9 次都没有响应，就认为连接已经断开。算下来要 2 小时 11 分钟以上才能发现
- 对方回复 ACK，说明连接正常；对方已经重启过，会回复 RST，连接被重置；一直没有响应，探测次数用完后连接被关闭，应用再读写时会收到 `ETIMEDOUT` 错误
- 应用可以针对单个连接调整，比如 Node.js 的 `socket.setKeepAlive(true, 60000)` 表示空闲 60 秒后开始探测

### 为什么还需要应用层心跳

- 默认 2 小时才开始探测，太久了；调整参数要改系统配置或 socket 选项，不是每个环境都能控制
- 它只能证明对方的 TCP 协议栈还在，不能证明应用正常：进程卡死时，内核照样会回复探测
- 中间的 NAT、防火墙、负载均衡的空闲超时往往短得多，连接可能早就被它们断开了

所以 WebSocket、IM 这类长连接，一般都会在应用层自己发心跳，见 [WebSocket 如何保活](/basics/network/15-websocket)。

### 常见的坑：偶发 502 或 ECONNRESET

```text
客户端 → 负载均衡器（空闲超时 60 秒）→ 复用连接 → 后端服务（keep-alive 空闲超时 5 秒）

1. 负载均衡器和后端之间的一个连接空闲了 5 秒，后端把它关闭
2. 负载均衡器还没感知到，恰好复用这个连接转发新请求
3. 后端回复 RST，负载均衡器返回 502；如果复用连接的是 Node.js 等 HTTP 客户端，则会报 ECONNRESET
```

解决：让后端的 keep-alive 空闲超时**大于**负载均衡器的空闲超时，保证总是由负载均衡器（复用连接的一方）先关闭空闲连接。以 Node.js 为例：

```js
const server = http.createServer(app)
// 大于负载均衡器的空闲超时（这里假设是 60 秒）
server.keepAliveTimeout = 65000
```

## 面试官可能追问

::: details 长连接会不会占用服务器资源？
会。每个连接都要占用文件描述符和内存，空闲连接太多也是负担，所以服务端会设置空闲超时和单个连接的最大请求数。但相比每个请求都新建连接（多一次握手的往返、TLS 的计算、大量 TIME_WAIT 状态的连接），复用连接整体上更省。Nginx、Node.js 这类事件驱动的服务器，维持空闲连接的开销很小。
:::

::: details HTTP/2 中还需要 keep-alive 吗？
不需要再用 `Connection: keep-alive` 了。HTTP/2 禁止使用 `Connection`、`Keep-Alive` 这类与连接相关的头部，它本身就是长连接：同一个域名通常只用一个连接，所有请求在上面多路复用。需要检测连接是否存活时，可以发送 PING 帧。
:::

::: details 怎么确认请求有没有复用连接？
在 Chrome DevTools 的 Network 面板，右键表头勾选 Connection ID 列，ID 相同的请求用的是同一个连接。复用了连接的请求，在 Timing 里也没有 Initial connection 和 SSL 阶段。
:::

## 易错点

- 开启 HTTP keep-alive 不会发送任何探测报文，它和 TCP keepalive 没有关系
- HTTP/1.1 默认就是持久连接，不需要再手动加 `Connection: keep-alive`
- 配置超时的原则：复用连接的一方（客户端、负载均衡器）的空闲超时，要比服务端的短
