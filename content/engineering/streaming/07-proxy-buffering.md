---
difficulty: 2
tags: [高频, 实践]
---

# 线上的流式输出变成一次性返回，可能是什么原因？

::: tip 一句话回答
本地正常、线上一次性返回，多半是**中间层在缓冲**：Nginx 默认开启 `proxy_buffering`，CDN、API 网关、负载均衡也可能缓冲响应；Node.js 的压缩中间件不主动刷新时，会把数据攒在压缩器里；部分 Serverless 平台的默认响应模式同样会把流攒成一整块。处理方法是对流式接口**关闭缓冲和压缩**：Nginx 配置 `proxy_buffering off`，或者由应用返回 `X-Accel-Buffering: no`；响应头带上 `Content-Type: text/event-stream` 和 `Cache-Control: no-cache`。排查时用 `curl -N` **从内到外逐层请求**，看是哪一层开始变成一次性返回的。
:::

## 详细解析

### 每一层都可能缓冲

```text
浏览器 ← CDN ← 负载均衡 / API 网关 ← Nginx ← Node.js 应用（压缩中间件）← 模型服务
```

| 位置 | 原因 | 处理 |
| --- | --- | --- |
| Node.js 应用 | 压缩中间件（如 Express 的 compression）把输出攒在压缩器里 | 流式接口跳过压缩，或者每次写完调用它提供的 `res.flush()` |
| Nginx | `proxy_buffering` 默认开启，上游的响应先写进缓冲区，通常要攒到一定大小或响应结束才转发 | 对流式接口关闭；或者应用返回 `X-Accel-Buffering: no` |
| Nginx | 开了 `gzip`，并且 `gzip_types` 包含 `text/event-stream` | 流式接口关闭压缩。关闭缓冲后 Nginx 会逐块刷新压缩数据，一般不是主因，但片段很小，压缩的收益也不大 |
| CDN、网关、负载均衡 | 部分产品会缓冲完整响应、自动压缩或缓存，或者限制响应时长 | 查对应产品关于流式响应的配置；流式接口不走 CDN 缓存 |
| Serverless 平台 | 一些平台默认等函数执行完才返回完整响应 | 开启平台的流式响应模式 |
| 用户侧 | 企业代理、安全软件可能缓冲 HTTP 响应 | 全站 HTTPS 能避开一部分；无法控制时要有降级方案 |

### 响应头

```js
res.writeHead(200, {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform', // 不缓存，也不要让中间层改写内容（如压缩）
  'X-Accel-Buffering': 'no', // 告诉 Nginx 不要缓冲这个响应
})
res.flushHeaders() // 立即发出响应头，前端的 fetch 马上就能 resolve
```

- `text/event-stream` 便于各层识别这是流式响应，EventSource 也要求这个类型
- `X-Accel-Buffering` 是给 Nginx 用的，其他代理和 CDN 不一定认。Nginx 默认不会把 `X-Accel-` 开头的响应头转发给下一层，所以有多层 Nginx 时，外层收不到这个头：要么内层用 `proxy_pass_header` 放行，要么外层也关闭缓冲

### Nginx 配置

```nginx
location /api/chat/ {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Host $host;

  proxy_buffering off;      # 关闭响应缓冲：收到上游的数据就转发
  proxy_cache off;          # 流式响应不缓存
  gzip off;                 # 流式接口不压缩
  proxy_read_timeout 300s;  # 两次从上游读到数据的最大间隔，默认 60 秒
}
```

`proxy_read_timeout` 不是整个响应的超时，而是两次读取之间的间隔。模型长时间思考、迟迟不出第一个字时，默认 60 秒就会断开。与其一味调大，不如让服务端定期发送心跳（见[服务端怎么转发流式响应](/engineering/streaming/08-server-relay)）。反向代理的基础知识见[反向代理和负载均衡](/basics/network/20-reverse-proxy)。

### 逐层排查

```bash
# -N 关闭 curl 自己的输出缓冲；正常时内容会一段一段地出现，而不是最后一起出现
curl -N -X POST http://127.0.0.1:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"你好"}]}'

# 再依次通过 Nginx、负载均衡、CDN 的地址请求；-i 同时打印响应头
curl -N -i -X POST https://example.com/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"你好"}]}'
```

从直连应用开始，每次往外多加一层，哪一层开始变成一次性返回，问题就在哪一层。响应头也能提供线索：出现 `Content-Encoding: gzip`，说明被压缩了；出现 `Content-Length`，说明某一层是攒完了整个响应才发出的，因为流式响应事先不知道总长度。

## 面试官可能追问

::: details 全局关掉 proxy_buffering 行不行？
不建议。开启缓冲时，Nginx 能尽快把上游的响应收下来，上游马上就可以去处理别的请求，慢速的客户端由 Nginx 慢慢发送；关闭后，客户端读得多慢，上游的连接就要被占用多久。只对流式接口所在的 location 关闭，或者只给流式响应加 `X-Accel-Buffering: no`。
:::

::: details 本地开发时为什么一般没问题？
本地通常是浏览器直连开发服务器，中间没有 Nginx 和 CDN，开发环境也很少开启压缩。所以流式效果要在接近线上的环境里验证，上线前用 curl 走一遍完整链路。
:::

::: details 流式输出到一半，总在固定的时间点断开，怎么查？
多半是某一层的超时：Nginx 的 `proxy_read_timeout`、负载均衡的空闲超时、网关或 Serverless 平台的最长响应时间。先看断开的时间点是否固定（比如总在 60 秒左右），再对照各层的超时配置。空闲超时用心跳解决；最长响应时间的限制，只能调大配置或者改成异步任务。
:::

::: details 换成 HTTP/2 能解决缓冲问题吗？
不能。缓冲是代理、压缩、网关这些中间层的行为，和 HTTP 版本无关。HTTP/2 下数据以 DATA 帧发送，不再使用分块传输编码，排查方法是一样的。
:::

## 易错点

- 只改了 Nginx，忘了 CDN、网关或者应用自己的压缩中间件
- 以为 `proxy_read_timeout` 是整个响应的超时，把它调得很大来"解决"断流，真正的问题是空闲太久
- 只在应用里返回 `X-Accel-Buffering: no`，外面还有一层 Nginx 时不生效
- 只在浏览器里测试，看不出是哪一层的问题；用 curl 逐层对比更快
