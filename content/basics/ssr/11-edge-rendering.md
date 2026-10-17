---
difficulty: 2
tags: [原理, 新技术]
---

# 边缘渲染是什么？Edge Runtime 有哪些限制？

::: tip 一句话回答
边缘渲染是把服务端代码部署到离用户最近的 **CDN 边缘节点**上执行，而不是集中在一两个机房的 Node 服务器。边缘运行时一般基于 **V8 隔离环境 + Web 标准 API**（`fetch`、`Request`、`Response`、Web Crypto），冷启动快、就近响应，代价是**不能用大部分 Node API**、执行时间和内存受限。它最适合重定向、A/B 分流、鉴权中间件这类"轻计算、不查库"的逻辑；如果每次渲染都要查远处的数据库，边缘反而更慢。
:::

## 详细解析

### 和传统 Node 服务器的区别

| 维度 | 传统 Node 服务器 | 边缘函数 |
| --- | --- | --- |
| 位置 | 固定的一个或几个区域 | 全球边缘节点，就近执行 |
| 运行环境 | 完整 Node.js 进程 | 轻量隔离环境（V8 isolate 一类） |
| 冷启动 | 容器或进程启动，较慢 | 很快，隔离环境创建开销小 |
| 可用 API | 全部 Node API、原生模块 | Web 标准 API 为主 |
| 资源限制 | 自己配置 | 平台限制 CPU 时间、内存、包体积 |
| 长连接、长任务 | 可以 | 通常不适合 |

CDN 原本只缓存静态内容（见 [CDN](/basics/network/12-cdn)），边缘函数让 CDN 节点也能"跑代码"：请求先在边缘被处理，能直接回就直接回，不能回再转发回源。

### 为什么限制这么多

边缘节点上同时跑着大量租户的代码，平台要用隔离环境保证安全和密度，不会给每个请求起一个完整的 Node 进程。所以：

- **没有文件系统**：`fs` 读写本地文件一般不可用，配置要打包进代码或放到 KV 存储
- **不能用 Node 专属模块**：`child_process`、`net` 原生 TCP、C++ 原生扩展都用不了；依赖了这些模块的 npm 包（很多老的数据库驱动）会直接报错
- **只能用 Web 标准 API**：HTTP 用 `fetch`，加密用 `crypto.subtle`，流用 Web Streams。部分平台提供 Node 兼容层，但覆盖范围各家不同，要以平台文档为准
- **资源受限**：单次请求的 CPU 时间、内存、代码包体积都有上限，不适合做图片处理、大量计算
- **没有长期状态**：实例随时可能被回收，不能靠内存缓存或模块变量存状态

### 最大的坑：数据离边缘太远

边缘节点离用户近，但数据库通常只在一个区域。如果渲染一个页面要串行查三次库：

```text
用户 ──近──> 边缘节点 ──远──> 数据库（查 1）
                     ──远──> 数据库（查 2，依赖查 1）
                     ──远──> 数据库（查 3）
```

每次查询都要跨大洲往返，形成**请求瀑布**，总耗时可能比直接在数据库旁边的 Node 服务器渲染还长。常见对策：

1. 渲染放在**靠近数据库的区域**，边缘只做路由和缓存
2. 数据用边缘 KV、只读副本或全球分布式数据库
3. 把多次查询合成一次接口调用，减少往返

### 适合放在边缘的事

- **重定向和重写**：按国家、语言跳转到对应站点
- **A/B 测试分流**：读 Cookie 决定走哪个版本，写入分组 Cookie
- **鉴权中间件**：校验 JWT 签名，未登录直接重定向，不用回源
- **轻量个性化**：按地区改 Header、拼接缓存好的片段
- **缓存层逻辑**：自定义缓存 key、给响应加安全头

渲染模式本身的选择见 [CSR、SSR、SSG、ISR](/basics/ssr/01-rendering-modes)，边缘是"在哪里跑"的问题，和"什么时候渲染"是两个维度。

## 代码示例

一个只用 Web 标准 API 的边缘中间件（各平台的入口写法不同，这里写成通用的 `handler`）：

```js
export async function handler(request) {
  const url = new URL(request.url)
  const token = request.headers.get('cookie')?.match(/token=([^;]+)/)?.[1]

  // 未登录访问后台：在边缘直接重定向，不回源
  if (url.pathname.startsWith('/admin') && !token) {
    return Response.redirect(new URL('/login', url), 302)
  }

  // A/B 分流：没分过组就随机分一个
  let group = request.headers.get('cookie')?.match(/ab=(a|b)/)?.[1]
  const isNew = !group
  if (!group) group = Math.random() < 0.5 ? 'a' : 'b'

  const res = await fetch(new Request(`${url.origin}/${group}${url.pathname}`, request))
  const out = new Response(res.body, res)
  if (isNew) out.headers.append('set-cookie', `ab=${group}; Path=/; Max-Age=2592000`)
  return out
}
```

## 面试官可能追问

::: details 边缘函数和 Serverless 函数是一回事吗？
都是按请求计费、免运维的函数，但部署位置和运行时不同。常说的 Serverless 函数一般跑在某个区域的容器里，有完整 Node 环境，冷启动相对慢；边缘函数跑在全球节点的轻量隔离环境里，启动快但 API 受限。很多框架允许按路由选择运行时。
:::

::: details 在边缘怎么连数据库？
传统数据库驱动依赖 TCP 长连接，在边缘通常用不了。常见做法是走基于 HTTP 的数据库代理或 Serverless 驱动，或者用平台自带的 KV、边缘数据库。即便连上了，也要考虑距离带来的延迟。
:::

::: details 边缘渲染能用模块变量做缓存吗？
不可靠。同一个隔离环境可能处理多个请求，变量有时会"碰巧"留着，但实例随时被回收，不同节点之间也不共享。缓存要放在平台的 KV 或 Cache API 里。另外模块变量在多个请求之间共享，存用户数据还会串号，见 [跨请求状态污染](/basics/ssr/12-cross-request-state)。
:::

## 易错点

- 以为"放到边缘一定更快"：数据在远处时，串行查询会让边缘渲染更慢
- 引入的 npm 包间接依赖了 `fs`、`net` 等 Node 模块，本地开发正常，部署到边缘才报错
- 在边缘中间件里做重计算或大量 I/O，超过平台的 CPU 时间限制被直接中断
