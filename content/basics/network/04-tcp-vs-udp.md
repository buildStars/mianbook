---
difficulty: 1
tags: [高频]
---

# TCP 和 UDP 有什么区别？

::: tip 一句话回答
**TCP** 面向连接、可靠、面向字节流，有流量控制和拥塞控制，适合要求数据完整、有序的场景，比如网页、文件传输。**UDP** 无连接、尽力交付、面向数据报，首部只有 8 字节，延迟低，适合实时性优先的场景，比如音视频通话、DNS 查询、在线游戏。需要可靠性时也可以在 UDP 之上自己实现，HTTP/3 所基于的 QUIC 就是这样做的。
:::

## 详细解析

### 对比

| 对比项 | TCP | UDP |
| --- | --- | --- |
| 连接 | 面向连接，通信前三次握手，结束时四次挥手 | 无连接，直接发送 |
| 可靠性 | 通过确认、重传、排序、去重，保证数据可靠、有序 | 尽力交付，可能丢包、乱序 |
| 传输方式 | 面向字节流，没有消息边界 | 面向数据报，保留消息边界 |
| 首部开销 | 最少 20 字节，最多 60 字节 | 固定 8 字节 |
| 流量控制、拥塞控制 | 有 | 没有，发多快完全由应用决定 |
| 通信方式 | 只能一对一 | 一对一、一对多、广播、多播 |
| 速度与实时性 | 握手、确认和重传带来额外延迟 | 开销小、延迟低 |

TCP 的可靠性机制见 [TCP 如何保证可靠传输](/basics/network/05-tcp-reliability)，拥塞控制见 [TCP 拥塞控制](/basics/network/06-tcp-congestion)。

UDP 的首部只有源端口、目的端口、长度、校验和 4 个字段。它也有校验和，但只能发现数据损坏，损坏的数据报直接丢弃，不会重传。

### 典型应用

| 协议 | 典型应用 |
| --- | --- |
| TCP | 网页（HTTP/1.1、HTTP/2）、文件传输、邮件（SMTP）、远程登录（SSH）、数据库连接 |
| UDP | DNS 查询、音视频通话和低延迟直播（如 WebRTC）、在线游戏、DHCP，以及 HTTP/3 所基于的 QUIC（见 [HTTP 版本区别](/basics/network/07-http-versions)） |

### 粘包问题

TCP 是字节流：发送方连续写入两条消息，接收方可能一次就读到两条（粘包），也可能一条消息要分两次才读完（拆包）。这不是 TCP 的缺陷，而是字节流本来就没有消息边界，需要应用层协议自己划分消息：

- **定长**：每条消息长度固定，不够就补齐
- **分隔符**：用特殊字符分隔，比如 HTTP/1.1 的头部以一个空行（`\r\n\r\n`）结束
- **长度字段**：在消息头部写明消息体的长度，比如 HTTP 的 `Content-Length`，以及很多自定义的二进制协议

下面用"4 字节长度 + 消息体"的格式收发消息（Node.js）：

```js
// 发送：在消息前加上 4 字节的长度（大端序）
function encode(msg) {
  const body = Buffer.from(JSON.stringify(msg))
  const header = Buffer.alloc(4)
  header.writeUInt32BE(body.length)
  return Buffer.concat([header, body])
}

// 接收：数据可能被拆开或粘在一起，先缓存，凑够一条完整的消息再处理
function createDecoder(onMessage) {
  let buffer = Buffer.alloc(0)
  return (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 4) {
      const len = buffer.readUInt32BE(0)
      if (buffer.length < 4 + len) break // 消息体还没收完整，等下一块数据
      onMessage(JSON.parse(buffer.subarray(4, 4 + len).toString()))
      buffer = buffer.subarray(4 + len)
    }
  }
}

socket.on('data', createDecoder((msg) => console.log(msg)))
```

UDP 每次发送的就是一个完整的数据报，接收方每次读取一个，不存在粘包问题。

## 面试官可能追问

::: details 视频通话为什么用 UDP？
实时性比完整性更重要。丢了一个包，等它重传回来，那一帧画面早就过时了，等待重传反而造成延迟和卡顿；TCP 还要求按序交付，一个包丢了，后面的数据都要等它。用 UDP 时应用可以自己取舍：允许少量丢失、用冗余数据（FEC）恢复，或者只重传关键数据。WebRTC 默认用 UDP 传输音视频，UDP 被防火墙拦截时，也能通过 TURN 中继改走 TCP 兜底。基于 HTTP 的直播方案（如 HLS）通常走 TCP，延迟更高，但兼容性好。
:::

::: details UDP 上能实现可靠传输吗？
可以，在应用层自己实现确认、重传、排序和拥塞控制就行。QUIC 就是这样：它运行在 UDP 上，提供可靠、有序的多路复用流，是 HTTP/3 的基础。好处是协议通常实现在用户态，不用升级操作系统内核就能更新；每个流独立交付，还避免了 TCP 的队头阻塞。
:::

::: details DNS 为什么主要用 UDP？
DNS 查询是一问一答，请求和响应通常都很小。用 UDP 不需要握手，一个往返就能完成；丢了就由客户端超时重试，代价很低。响应太大被截断时，客户端会改用 TCP 重新查询；DNS 服务器之间同步整个区域的数据（区域传送）也用 TCP。详见 [DNS 解析过程](/basics/network/11-dns)。
:::

## 易错点

- UDP 的"不可靠"是指不保证送达和顺序，不是说它经常丢包；需要可靠时可以在应用层补上
- "粘包"是字节流的特性，不是 TCP 的 bug，要靠应用层协议划分消息边界；UDP 没有这个问题
- TCP 首部不是固定 20 字节，带选项时最长 60 字节
