---
difficulty: 3
tags: [场景题, 原理]
---

# Node.js 服务放在 Nginx 或负载均衡后面，偶发 502 是怎么回事？keepAliveTimeout 这些超时怎么配？

::: tip 一句话回答
典型原因是**连接复用的竞态**：代理和 Node 之间用 keep-alive 长连接，Node 的 `keepAliveTimeout` 默认只有 **5 秒**，比代理的空闲超时（例如 AWS ALB 默认 60 秒）短。Node 刚关掉一条空闲连接，代理恰好把新请求发到这条连接上，就拿到连接重置，回给客户端 502，Node 日志里根本没有这个请求。解决办法是让 **Node 的 keepAliveTimeout 大于上游代理的空闲超时**，再配好 `headersTimeout`、`requestTimeout` 这几个超时。
:::

## 详细解析

### 现象和原因

- 流量越低越容易出现：连接经常空闲到 5 秒，被 Node 关掉的机会就多
- Node 日志里查不到对应请求，因为请求根本没被 Node 读到
- 代理日志里是 "upstream prematurely closed"、"connection reset by peer" 一类的错误

时序是这样的：

```text
代理                                   Node
 |--- 请求 1 ------------------------->|
 |<-- 响应 1 --------------------------|  连接进入空闲
 |          ...空闲接近 keepAliveTimeout...
 |--- 请求 2（复用这条连接）---------->|  几乎同时：Node 超时，关闭 socket
 |<-- FIN / RST -----------------------|
 => 代理回客户端 502
```

关闭连接的一方应该是"等得更久"的那一方。代理先关，代理自己清楚这条连接不能再用；Node 先关，代理可能还没收到关闭的包就发了请求。AWS ALB 的文档也是这么建议的：应用的空闲超时要大于负载均衡的空闲超时，它的故障排查文档把"目标的 keep-alive 时长短于负载均衡的空闲超时"列为 502 的原因之一。

### 怎么配

- **AWS ALB**：空闲超时默认 60 秒，Node 的 `keepAliveTimeout` 设成比它大，例如 65 秒
- **Nginx**：到上游的长连接由 upstream 的 `keepalive_timeout` 控制，默认 60 秒，同样让 Node 更长。较新的版本里 upstream 的 `keepalive` 和 `proxy_http_version 1.1` 已经默认开启；较老的版本要手动配，以所用版本的文档为准

```nginx
upstream app {
    server 127.0.0.1:3000;
    keepalive 32;            # 每个 worker 缓存的空闲连接数
    keepalive_timeout 60s;   # 要小于 Node 的 keepAliveTimeout
}
server {
    location / {
        proxy_pass http://app;
        proxy_http_version 1.1;          # 较老的版本需要显式写
        proxy_set_header Connection "";  # 清掉 Connection 头，否则不会复用
    }
}
```

Node 自己也做了缓解：实际的 socket 超时是 `keepAliveTimeout` 加上 `keepAliveTimeoutBuffer`（默认 1000 毫秒）。对外宣告的超时短一点，真正关连接晚一点，用来减少 ECONNRESET。不过它挡不住"代理空闲超时比 Node 长很多"的情况，配置上还是要让 Node 更长。

### 四个超时各管什么

| 属性 | 本机实测默认值 | 管什么 |
| --- | --- | --- |
| `keepAliveTimeout` | 5000 | 响应写完后，空闲连接保留多久等下一个请求 |
| `headersTimeout` | 60000 | 从开始接收到收完请求头的时限，超时回 408 |
| `requestTimeout` | 300000 | 收完整个请求（含请求体）的时限，超时回 408 |
| `server.timeout` | 0 | socket 多久没有任何活动就算超时，0 表示不限制 |

默认值会随版本调整，以所用版本为准，部署前打印一下最稳。`headersTimeout` 和 `requestTimeout` 也是防慢速攻击的防线：攻击者可以一点一点地发请求头或请求体，长时间占住连接。直接暴露在公网、前面没有代理时，这两个值一定不能设成 0。把 `keepAliveTimeout` 调大时，有人会把 `headersTimeout` 也调到比它大一点，避免两者交错时提前断开。

### 停机时的连接处理

滚动发布时，`server.close()` 停止接受新连接，并关掉当前空闲的连接，正在处理的请求会继续完成。但这些请求完成后，连接变成空闲的，`close()` 不会再去关它，要等 `keepAliveTimeout` 到期，服务器才算真正关闭；所以等待期间要定期调用 `server.closeIdleConnections()` 清掉这类连接。`closeAllConnections()` 会强制断掉进行中的请求，只适合在超时后兜底。进程信号、退出码的处理见 [异常处理和优雅退出](/basics/node/07-error-handling)，keep-alive 协议本身见 [HTTP 长连接](/basics/network/16-keepalive)。

## 代码示例

```js
import http from 'node:http'

const server = http.createServer((req, res) => res.end('ok'))
// 默认值以所用版本为准，先打印出来看看
console.log({
  keepAliveTimeout: server.keepAliveTimeout,
  keepAliveTimeoutBuffer: server.keepAliveTimeoutBuffer,
  headersTimeout: server.headersTimeout,
  requestTimeout: server.requestTimeout,
  timeout: server.timeout,
})

// 放在空闲超时 60 秒的代理后面：Node 这边要更长
server.keepAliveTimeout = 65_000
server.headersTimeout = 66_000
server.listen(3000)

process.on('SIGTERM', () => {
  server.close(() => process.exit(0)) // 等进行中的请求完成
  // close() 之后才变空闲的连接不会被自动关掉，定期清一次
  setInterval(() => server.closeIdleConnections(), 1000).unref()
  setTimeout(() => server.closeAllConnections(), 10_000).unref() // 兜底
})
```

## 面试官可能追问

::: details 为什么不是"把 Node 的超时调小、让代理更早重连"？
代理复用连接前并不会探测它是否还活着，它只知道自己这边的计时。只有关连接的一方是代理，代理才能确定"这条连接不会再用"。所以规则是后端的空闲超时大于前面一层，层层往后递增。
:::

::: details 本地能稳定复现这个 502 吗？
很难。竞态窗口只有几毫秒，还受 `keepAliveTimeoutBuffer`、客户端 Agent 根据 `Keep-Alive` 响应头提前丢弃连接等机制影响。排查时更可靠的做法是对比两边的超时配置，看 502 是否集中在低流量时段、代理日志是否是连接被重置。
:::

::: details 用 Fastify、Express 也有这个问题吗？
Express 直接用 Node 的 http 服务器，默认值一样。Fastify 在工厂选项里有自己的 `keepAliveTimeout`，默认 72 秒，比 Node 原生默认值长，见 [Fastify](/basics/node/31-fastify)。不管用什么框架，都以实际生效的值和代理配置对比。
:::

## 易错点

- 只调大 `server.timeout`：它管的是 socket 不活动，不是 keep-alive 空闲时间，解决不了这个 502
- 修改 `keepAliveTimeout` 只影响之后建立的新连接，已有连接还按旧值，最好在 `listen` 前设置
- 在 Nginx 里配了 `keepalive`，却没清 `Connection` 头（老版本），连接根本没复用
- 前面没有代理时把 `headersTimeout`、`requestTimeout` 设成 0，给了慢速攻击机会
