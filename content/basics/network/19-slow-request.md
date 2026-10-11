---
difficulty: 2
tags: [实践, 场景题]
---

# 接口请求很慢，怎么排查？

::: tip 一句话回答
先**定位慢在哪个阶段**，再对症处理。在 Chrome DevTools 的 Network 面板选中请求看 **Timing**：排队、DNS、建立连接慢，是浏览器和网络层面的问题；**Waiting for server response**（即 TTFB）长，多半是服务端处理慢，要结合服务端日志和链路追踪排查；**Content Download** 慢，说明响应体太大。同时要区分偶发还是必现、个别用户还是所有用户，用 P95、P99 而不是平均值来衡量。
:::

## 详细解析

### 第一步：看 Timing，定位阶段

| 阶段 | 含义 | 慢的常见原因 | 处理 |
| --- | --- | --- | --- |
| Queueing | 排队 | 优先级低；HTTP/1.1 下同一域名的连接数已达上限（Chrome 是 6 个） | 升级到 HTTP/2、减少并发请求、调整优先级 |
| Stalled | 建立连接前的停顿 | 原因和排队类似 | 同上 |
| DNS Lookup | 域名解析 | DNS 服务慢、没有命中缓存 | `dns-prefetch`，检查 DNS 服务 |
| Initial connection、SSL | TCP 握手和 TLS 握手 | 网络延迟高、跨地区访问 | `preconnect`，复用连接，使用 CDN |
| Request sent | 发送请求 | 请求体很大，比如上传文件 | 一般很短 |
| Waiting for server response | 即 TTFB，从发出请求到收到响应的第一个字节 | 服务端处理慢，或网络往返时间长 | 见下文 |
| Content Download | 下载响应体 | 响应体太大、带宽小 | 开启压缩、分页、只返回需要的字段 |

`dns-prefetch`、`preconnect` 的用法见[资源提示](/basics/browser/11-resource-hints)，DNS 的解析过程见 [DNS 解析](/basics/network/11-dns)。

### TTFB 长：到服务端找原因

TTFB 包含服务端处理时间和网络往返时间，大多数情况是服务端处理慢：
- 慢 SQL：缺少索引、扫描的行数多、锁等待
- 依赖的下游服务慢，或者串行调用了多个服务
- 冷启动：Serverless 函数、刚扩容的实例，缓存和连接池还没预热
- 资源不足：CPU 打满、连接池耗尽

排查时看服务端日志里的处理耗时。比如 Nginx 可以记录 `$request_time`（从读到客户端请求的第一个字节，到响应发送完毕）和 `$upstream_response_time`（和后端交互的耗时），前者大、后者小，说明时间花在了 Nginx 和客户端之间。再用链路追踪（如 OpenTelemetry、SkyWalking）查看每一段调用的耗时。

还可以用 `Server-Timing` 响应头把服务端各阶段的耗时带给浏览器，DevTools 的 Timing 面板会直接展示出来：

```js
// Express 示例：记录查库和调用下游服务的耗时（单位：毫秒）
app.get('/api/orders', async (req, res) => {
  const t0 = performance.now()
  const orders = await db.findOrders(req.query)
  const t1 = performance.now()
  const users = await userService.batchGet(orders.map((o) => o.userId))
  const t2 = performance.now()
  res.set('Server-Timing', `db;dur=${(t1 - t0).toFixed(1)}, rpc;desc="user service";dur=${(t2 - t1).toFixed(1)}`)
  res.json({ orders, users })
})
```

### 用 curl 分阶段计时

排除浏览器的影响，直接看各阶段的耗时：

```bash
curl -o /dev/null -s -w 'dns: %{time_namelookup}s\nconnect: %{time_connect}s\ntls: %{time_appconnect}s\nttfb: %{time_starttransfer}s\ntotal: %{time_total}s\n' https://api.example.com/orders
```

```text
dns: 0.012s
connect: 0.045s
tls: 0.120s
ttfb: 0.980s
total: 1.020s
```

这些时间都是**从请求开始累计**的，要两两相减：DNS 12 毫秒，TCP 握手 33 毫秒，TLS 握手 75 毫秒，等待首字节 860 毫秒（含一次网络往返），下载 40 毫秒。问题出在服务端。

### 缩小范围

- **偶发还是必现**：必现的，直接沿着链路查；偶发的，看出问题的时间点是否和流量高峰、定时任务、缓存集中过期、连接池耗尽吻合
- **个别用户还是所有用户**：只有某个地区、某个运营商慢，可能是 CDN 节点、跨运营商链路或 DNS 调度的问题（见 [CDN 的原理](/basics/network/12-cdn)）
- **单个接口还是所有接口**：全部都慢，查网络、网关和公共依赖；单个接口慢，查它自己的逻辑和 SQL

### 看分布，不看平均值

用前端监控统计接口的耗时，按 P50、P95、P99 看分布，而不是只看平均值（见[前端监控](/basics/browser/20-monitoring)）。如果用 Resource Timing 采集跨域接口的分阶段耗时，服务端要返回 `Timing-Allow-Origin` 响应头，否则拿不到详细数据。

## 面试官可能追问

::: details TTFB 很长，一定是后端的问题吗？
不一定。TTFB 还包含网络往返的时间，以及中间网关、代理转发和排队的时间（比如网关限流、等待可用的后端连接）。对比服务端日志：服务端只处理了 50 毫秒，前端看到的 TTFB 却有 800 毫秒，时间就花在了网络或中间层上。
:::

::: details 请求一直处于 pending 状态，可能是什么原因？
- 浏览器端排队：HTTP/1.1 下同一域名的 6 个连接被长轮询、SSE、大文件下载这类长请求占满，后面的请求只能等
- 服务端一直没返回：卡在慢查询、死锁或等待下游服务，并且没有设置超时
- 服务端返回了响应头，但响应体一直没结束，比如流式接口，或者服务端代码忘了结束响应

前端也要给请求设置超时，比如 `fetch(url, { signal: AbortSignal.timeout(10000) })`，避免无限等待。
:::

::: details 为什么要看 P95，而不是平均值？
接口耗时通常是长尾分布：大部分请求很快，少数特别慢，平均值会把长尾掩盖掉。比如 99 个请求耗时 100 毫秒、1 个耗时 10 秒，平均值只有 199 毫秒，看起来很正常，但有 1% 的用户等了 10 秒。而且一个页面往往要调用多个接口，调用 10 个接口时，至少碰上一次 P99 级别慢请求的概率接近 10%。
:::

## 易错点

- curl `-w` 输出的是从请求开始累计的时间点，不是各阶段各自的耗时
- TTFB 不等于服务端处理时间，它还包含网络往返
- 本地测试很快，不代表用户那里也快，要看监控里不同地区、运营商和网络环境的数据
