---
difficulty: 2
tags: [原理, 实践]
---

# Nuxt 的服务端引擎 Nitro 是什么？server 目录下的接口、中间件和插件怎么写？

::: tip 一句话回答
**Nitro** 是 Nuxt 的服务端引擎，底层用 **h3** 处理请求。它把页面渲染、`server/` 目录里的接口和中间件一起打包进 `.output`，产物不依赖 `node_modules`，再通过 **preset** 部署到 Node、Serverless、边缘或静态托管。`server/api` 下的文件自动加 `/api` 前缀，`server/routes` 不加；文件名带 `.get.ts`、`.post.ts` 限定方法；处理函数用 `defineEventHandler` 写。`server/middleware` 每个请求都执行，只往 `event.context` 放数据、不返回内容；`server/plugins` 用 `defineNitroPlugin` 挂钩子。
:::

## 详细解析

### Nitro 做了什么

- **统一打包**：`nuxt build` 生成 `.output`，里面有服务端代码和静态资源，用到的依赖会被打进去，部署时不用再 `npm install`
- **多平台部署**：同一份代码换个 preset 就能产出适合 Node 服务器、Serverless 函数或边缘平台的产物
- **服务端能力**：文件路由的接口、中间件、插件、缓存、存储，写法都基于 h3

所以 Nuxt 不需要再单独起一个 Express 服务，简单的后端接口直接写在 `server/` 里。

### 接口：server/api 和 server/routes

```text
server/
├── api/
│   ├── posts/index.get.ts     → GET  /api/posts
│   ├── posts/index.post.ts    → POST /api/posts
│   └── posts/[id].get.ts      → GET  /api/posts/:id
├── routes/
│   └── sitemap.xml.ts         → /sitemap.xml（不加前缀）
├── middleware/auth.ts         → 每个请求都先执行
├── plugins/logger.ts          → Nitro 启动时执行
└── utils/db.ts                → 服务端自动导入
```

带方法后缀的文件只响应对应方法，用别的方法访问返回 405。常用的读取函数：

- `getQuery(event)`：查询参数
- `getRouterParam(event, 'id')`：路径参数（也在 `event.context.params` 里）
- `readBody(event)`：请求体，在 GET 里调用会抛 405
- `readValidatedBody(event, validate)`、`getValidatedQuery`：读的同时校验，常配合 Zod

返回对象会自动序列化成 JSON；没捕获的错误返回 500，主动报错用 `throw createError({ status, statusText })`，旧代码里常见 `statusCode`、`statusMessage`，含义一样。

### 中间件、插件、utils

- **server/middleware**：在所有 server route 之前执行，包括页面渲染和接口请求。它**不应该返回内容或结束响应**，只做检查、往 `event.context` 写数据，或者抛错。典型用法是解析 Cookie 里的会话，把用户放进 `event.context.user`
- **server/plugins**：Nitro 启动时执行一次，用 `defineNitroPlugin((nitroApp) => {})` 拿到 `nitroApp`，通过 `nitroApp.hooks.hook(...)` 挂钩子，例如统一记录错误、修改渲染结果
- **server/utils**：导出的函数在服务端自动导入，放数据库连接、鉴权工具

### SSR 时调自己的接口不走 HTTP

页面在服务端渲染时用 `$fetch('/api/posts')`，Nitro 发现是本应用的接口，会**直接调用对应的处理函数**，不发真实的 HTTP 请求，省掉一次网络往返。需要把当前请求的 Cookie 等上下文带过去时，用 `event.$fetch` 或 `useRequestFetch`，详见 [SSR 登录态](/basics/ssr/10-ssr-auth)。

### 缓存和存储

- `defineCachedEventHandler(handler, { maxAge })`：缓存整个接口的响应
- `defineCachedFunction(fn, { maxAge, swr, getKey })`：缓存任意函数的结果，可以在多个接口里复用；`getKey` 决定缓存键，`varies` 按指定请求头区分缓存
- `maxAge` 单位是秒，默认只有 1 秒，要显式设置；状态码 400 及以上的响应不会写进缓存
- `useStorage()`：Nitro 的键值存储，默认挂在内存上，可以在 `nitro.storage` 里挂 Redis 等驱动，用 `useStorage('redis')` 访问

## 代码示例

```ts
// server/middleware/auth.ts：解析身份，不返回内容
export default defineEventHandler(async (event) => {
  const token = getCookie(event, 'token')
  if (token) event.context.user = await verifyToken(token) // verifyToken 放在 server/utils
})
```

```ts
// server/api/posts/[id].get.ts
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) {
    throw createError({ status: 400, statusText: 'Invalid id' })
  }
  const post = await findPost(id)
  if (!post) throw createError({ status: 404, statusText: 'Not Found' })
  return post
})
```

```ts
// server/api/stats.get.ts：缓存 10 分钟，过期后先返回旧值再后台刷新
export default defineCachedEventHandler(async () => {
  return await computeStats()
}, { maxAge: 600, swr: true })
```

## 面试官可能追问

::: details server/api 和 server/routes 怎么选？
返回 JSON 的业务接口放 `server/api`，统一带 `/api` 前缀，方便网关和缓存规则按前缀处理。不想带前缀的路径放 `server/routes`，例如 `/sitemap.xml`、`/robots.txt`、第三方回调地址。
:::

::: details 中间件里能不能直接返回 401？
文档要求中间件不返回内容。需要拒绝请求时可以抛 `createError({ status: 401 })`，但更常见的分工是：中间件只解析身份写进 `event.context`，具体接口按需检查权限。否则公开接口和静态资源也要在中间件里写一堆白名单。
:::

::: details Nitro 和 Express 有什么区别？
Express 只是 Node 的 HTTP 框架，部署目标就是 Node 进程。Nitro 是打包工具加运行时：基于文件路由，产物自包含，可以输出到 Serverless 和边缘平台，还内置缓存和存储。代价是不能随意用 Node 专有能力，要看部署目标支不支持。
:::

## 易错点

- 在 `server/` 里 import `app/` 下的组件或 composables。服务端代码和 Vue 应用是两个世界，共用逻辑放 `shared/`
- 把 Nitro v3 文档里的 `defineHandler`、`useKV` 抄进 Nuxt 4 项目。Nuxt 4 用的是 `defineEventHandler`、`useStorage`
- 缓存带用户信息的接口时没区分用户。缓存默认不把 Cookie、Authorization 放进缓存键，所有人会拿到同一份结果
- 在中间件里返回内容，导致所有请求都被截断
