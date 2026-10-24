---
difficulty: 2
tags: [实践, 性能优化]
---

# Node.js 调用下游 HTTP 接口时，连接复用、超时和并发怎么控制？

::: tip 一句话回答
Node 里有两套客户端：内置 `fetch` 基于 **undici**，`http.request` 用 **http.Agent**，各有自己的连接池。要点有四个：**复用连接**（自己 `new http.Agent()` 时 keepAlive 默认是关的，要显式打开）；**限制并发**（`maxSockets` 默认不限，下游扛不住时要限制）；**设超时**（fetch 默认没有整体超时，用 `AbortSignal.timeout`）；**响应体一定要读完或取消**，否则连接不会还回连接池。
:::

## 详细解析

### 两套连接池

| | `http.request` / `http.get` | `fetch` |
| --- | --- | --- |
| 实现 | `http.Agent` | undici 的 Agent，按 origin 建连接池 |
| 默认复用 | `http.globalAgent` 开启 keepAlive；`new http.Agent()` 默认关闭 | 默认复用 |
| 并发上限 | `maxSockets` 默认 `Infinity` | 连接池的 `connections` 默认不限 |
| 自定义 | 传 `agent` 选项 | 传 `dispatcher` 选项（需要 undici 包） |

不复用连接时，每个请求都要重新 TCP 握手（HTTPS 还有 TLS 握手），延迟高、CPU 开销大。短时间大量短连接还会堆积 TIME_WAIT（留在主动关闭连接的一方）；如果堆在客户端这边，可能耗尽本机的临时端口，表现为偶发的 `EADDRNOTAVAIL` 或连接超时。

### 并发控制

连接池不限上限，意味着瞬间 1000 个并发调用就会开 1000 条连接打到下游。下游扛不住时，可以：

- 限制每个 origin 的连接数：`http.Agent` 的 `maxSockets`，undici `Agent`/`Pool` 的 `connections`。超出的请求在本地排队
- 在业务层限流：用并发池（如 `p-limit`）或令牌桶控制同时发出的请求数
- 排队本身也要有上限，否则请求在本地堆积，内存和延迟一起涨

### 超时

- `fetch` 默认没有整体超时，靠 undici 的分段超时兜底：`headersTimeout`（等响应头）和 `bodyTimeout`（两个数据块的间隔）默认都是 300 秒，`connectTimeout` 默认 10 秒，以所用版本为准。对接口调用来说 300 秒太长，一定要自己加 `AbortSignal.timeout(ms)`
- `http.request` 的 `timeout` 选项只是 socket 不活动超时，触发 `'timeout'` 事件后要自己 `destroy`，它不会自动中止请求
- 超时取消的细节见 [AbortController](/basics/node/23-abort-controller)

### 响应体必须读完或取消

undici 文档专门强调：浏览器靠垃圾回收释放没读的响应体，Node 的 GC 时机不确定，不读响应体会让连接一直被占着，连接池耗尽时请求会卡住。所以：

- 成功时 `await res.json()` / `res.text()` 读完
- 不关心内容（比如状态码不对直接报错）时调用 `res.body?.cancel()`
- 只要响应头，用 HEAD 请求
- `http.get` 注册了 response 回调就必须消费数据，或者调用 `res.resume()` 丢弃

### 其他坑

- **DNS**：默认的 `dns.lookup` 走 libuv 线程池，DNS 慢时会拖慢同样用线程池的文件操作和 crypto，见 [Node.js 的 I/O 模型](/basics/node/02-io-model)。高并发调用时可以考虑缓存 DNS 结果
- **重试**：见 [手写重试和超时](/basics/handwriting/07-retry-timeout)，只对幂等请求（GET、带幂等键的写操作）重试，配合指数退避和抖动，重试总次数要有上限，否则下游故障时会被自己的重试放大流量

## 代码示例

```js
import http from 'node:http'

// http 模块：自己建 Agent 要显式开 keepAlive，并限制每个 host 的连接数
const agent = new http.Agent({ keepAlive: true, maxSockets: 50 })

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { agent, timeout: 3000 }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (c) => (data += c)) // 必须消费响应，否则 socket 不会归还
      res.on('end', () => resolve(JSON.parse(data)))
    })
      .on('timeout', function () { this.destroy(new Error('socket timeout')) })
      .on('error', reject)
  })
}

// fetch：没有整体超时，用 AbortSignal.timeout
async function fetchJSON(url, ms = 1000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) })
  if (!res.ok) {
    await res.body?.cancel() // 不用的响应体也要取消，连接才能复用
    throw new Error(`HTTP ${res.status}`)
  }
  return res.json() // 读完 body
}

try {
  console.log(await fetchJSON('http://localhost:3001/slow', 500))
} catch (err) {
  console.log(err.name) // 超时时是 TimeoutError
}
```

想给 fetch 换连接池参数，要安装 undici 包，用它的 `Agent` 作为 `dispatcher`：

```js
import { Agent } from 'undici'

const dispatcher = new Agent({
  connections: 50,       // 每个 origin 最多 50 条连接
  headersTimeout: 5_000,
  bodyTimeout: 10_000,
})
await fetch('https://api.example.com/users', { dispatcher, signal: AbortSignal.timeout(8_000) })
```

## 面试官可能追问

::: details 为什么 globalAgent 和 new Agent() 的默认值不一样？
`http.globalAgent` 在较新的版本里改成了默认开启 keepAlive，但 `new http.Agent()` 构造参数的默认值仍是 `keepAlive: false`，两者是分开的。所以自己创建 Agent 时要显式传 `{ keepAlive: true }`，用之前打印一下 `agent.keepAlive` 确认。
:::

::: details 下游关掉空闲连接时，客户端会不会拿到一条死连接？
会有这种竞态，表现为偶发的 `ECONNRESET` 或 "socket hang up"。客户端的空闲超时要比服务端短：undici 会参考服务端返回的 `Keep-Alive: timeout=...` 提前关闭，http.Agent 也有 `agentKeepAliveTimeoutBuffer` 做同样的事。服务端那侧的原理见 [keepAliveTimeout 和 502](/basics/node/21-http-server-timeouts)。
:::

::: details 连接数应该设多少？
没有通用值，看下游能承受的并发和单个请求耗时。可以从"目标 QPS × 平均耗时"估算需要的并发连接数，再留余量，最后用压测和下游的监控确认。
:::

## 易错点

- 以为 fetch 有默认超时：只有 300 秒级别的分段超时，接口调用必须自己加
- 状态码不对就直接 `throw`，没有取消响应体，连接慢慢被占满
- `http.request` 的 `timeout` 触发后没有 `destroy`，请求还在继续
- 对 POST 这类非幂等请求无脑重试，造成重复下单
