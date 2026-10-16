---
difficulty: 2
tags: [场景题, 实践]
---

# SSR 应用里怎么处理登录态？服务端请求怎么带上用户的 Cookie？

::: tip 一句话回答
浏览器请求页面时带上了 Cookie，但它只发给了 SSR 服务器；SSR 服务器渲染时再去调后端接口，是**服务器自己发起的新请求**，不会自动带上用户的 Cookie，后端就会当成未登录。要**手动把请求头里的 Cookie 转发**过去：Nuxt 的 useFetch 请求相对路径时会自动转发，自己用 $fetch 时配合 `useRequestHeaders(['cookie'])` 或 `useRequestFetch()`；Next.js 在服务端组件里用 `cookies()` 读出来再放进请求头。反过来，后端返回的 **Set-Cookie** 也要转发给浏览器。登录态最适合放在 **HttpOnly Cookie** 里，服务端每次都能读到、脚本读不到；登录判断放在**服务端中间件**里，未登录直接重定向；带登录态的页面**不能被 CDN 缓存**。
:::

## 详细解析

### 为什么服务端请求没有带 Cookie

```text
浏览器 ──(Cookie: sid=abc)──▶ SSR 服务器 ──(没有 Cookie)──▶ 后端 API → 401
                               └─ 渲染出"未登录"的页面，水合后客户端再请求一次才变成已登录
```

在浏览器里，同源请求的 Cookie 由浏览器自动携带。SSR 服务器同时处理着很多用户的请求，没有"当前用户的 Cookie"这个概念，必须由代码按请求显式传递。框架也不会默认把所有请求头原样转发：`host`、`content-length` 这类头转过去会出错，把用户的 Cookie 发给第三方域名更是在泄露凭证。

### Nuxt：useFetch 自动转发，$fetch 要手动

```vue
<script setup lang="ts">
// 请求相对路径时，服务端渲染阶段会自动转发用户的 Cookie 等请求头
const { data: me } = await useFetch('/api/me')

// 自己用 $fetch：只取需要的 cookie 头（浏览器端返回空对象，浏览器会自己带 Cookie）
const headers = useRequestHeaders(['cookie'])
const { data: orders } = await useAsyncData('orders', () => $fetch('/api/orders', { headers }))

// 或者用 useRequestFetch 得到一个会自动转发请求上下文的 fetch
const requestFetch = useRequestFetch()
const { data: cart } = await useAsyncData('cart', () => requestFetch('/api/cart'))
</script>
```

后端在另一个域名时，自动转发不会生效，也不应该把所有 Cookie 都转过去。更稳妥的做法是浏览器只和自己的服务通信：由 Nuxt 的 server 路由（相当于 [BFF](/basics/node/17-bff)）读取会话，再用服务间的凭证去调后端。

Next.js 的服务端组件里，用 `next/headers` 的 `cookies()` 读取（它是异步的，要 `await`），把需要的值拼进 fetch 的 `Cookie` 或 `Authorization` 请求头。

### Set-Cookie 也要转回浏览器

后端可能在这次请求里续期了会话，或者轮换了刷新令牌，返回了新的 Set-Cookie。SSR 服务器收到后如果不转发，浏览器手里还是旧的凭证，下一次请求就会失败，用户莫名其妙被登出。用 Node 原生 http 写一个最小的例子：

```js
import http from 'node:http'

const API = process.env.API_URL // 后端接口地址
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// 只转发需要的请求头，不要把 host、content-length 等原样转过去
async function apiFetch(req, res, path) {
  const apiRes = await fetch(API + path, {
    headers: { cookie: req.headers.cookie ?? '' },
  })
  // 后端续期了会话：每一条 Set-Cookie 都要转给浏览器，而且要在发送响应头之前
  for (const c of apiRes.headers.getSetCookie()) res.appendHeader('set-cookie', c)
  return apiRes
}

http.createServer(async (req, res) => {
  const apiRes = await apiFetch(req, res, '/me')
  if (apiRes.status === 401) {
    // 未登录直接重定向，不渲染受保护的页面
    res.writeHead(302, { location: `/login?redirect=${encodeURIComponent(req.url)}` }).end()
    return
  }
  const user = await apiRes.json()
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store', // 带登录态的页面不能被 CDN 缓存
  })
  res.end(`<h1>你好，${escapeHtml(user.name)}</h1>`)
}).listen(3000)
```

- Set-Cookie 有多条时不能合并成一个字符串，要用 `getSetCookie()` 逐条取出、逐条追加
- 必须在响应头发出之前完成，[流式 SSR](/basics/ssr/03-streaming-ssr) 开始输出后就来不及了，所以续期、刷新令牌要放在渲染之前做
- Nuxt 里用 `useRequestEvent()` 拿到当前请求的事件对象，把 Set-Cookie 追加到页面响应上，官方文档有现成的 `fetchWithCookie` 示例；Next.js 只能在 Server Action、Route Handler 或 Proxy 里设置 Cookie，服务端组件渲染时不能设置

### 为什么 HttpOnly Cookie 适合 SSR

- Token 存在 localStorage：服务端读不到，SSR 只能渲染未登录状态，等客户端拿到 Token 再请求，页面会闪一下，还会造成[水合不匹配](/basics/ssr/02-hydration-mismatch)
- 存在 HttpOnly Cookie：浏览器请求页面时自动带上，服务端渲染时就知道是谁；脚本读不到，XSS 偷不走。同时设置 `Secure`、`SameSite=Lax` 防 CSRF，见 [XSS 和 CSRF](/basics/browser/06-xss-csrf) 和 [Cookie、Session、Token、JWT](/basics/network/13-auth)

### 登录判断放在服务端中间件

只在客户端做路由守卫时，服务端已经把页面 HTML 发出去了，用户会先看到页面或白屏，再跳到登录页。放在服务端判断，未登录直接返回 302，浏览器根本拿不到受保护页面的内容：

```ts
// app/middleware/auth.ts：Nuxt 的路由中间件
export default defineNuxtRouteMiddleware(async (to) => {
  const { data: me } = await useFetch('/api/me', { key: 'me' }) // 服务端会自动带上 Cookie
  if (!me.value) {
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`) // 服务端执行时返回 302
  }
})
```

Nuxt 的路由中间件在首次访问时由服务端执行（水合时客户端还会再执行一次），之后的页面跳转在客户端执行。Next.js 可以在 Proxy（以前叫 Middleware）里读取 Cookie 做提前跳转。中间件里的判断只是第一道关，接口、Server Action、数据访问层里还要再校验权限。

### 带登录态的页面不能被共享缓存

同一个 URL 不同用户看到的内容不同，而 CDN 的缓存键默认不包含 Cookie：用户 A 的页面一旦被缓存，用户 B 打开看到的就是 A 的信息。带登录态的响应要设置 `Cache-Control: private, no-store`；公共页面要缓存时，让带登录 Cookie 的请求绕过 CDN 缓存，或者页面主体缓存、用户信息在客户端单独请求。服务端的数据缓存同理，带用户 Cookie 的请求结果不能放进共享缓存，缓存策略见 [SSR 的性能和稳定性](/basics/ssr/09-ssr-performance)。

## 面试官可能追问

::: details 为什么不把浏览器的请求头全部转发给后端？
有些头转过去会出错：`host` 不对会被后端或网关拒绝，`content-length` 和实际请求体对不上，`accept` 可能让后端返回 HTML 而不是 JSON。更重要的是安全：Cookie、Authorization 是用户凭证，转发给第三方接口就是泄露。应该按白名单只转发需要的头，并且只发给自己的后端。
:::

::: details 登录后跳回原页面，redirect 参数要注意什么？
要防**开放重定向**：攻击者构造 `/login?redirect=https://evil.com` 的链接，用户登录后被带到钓鱼网站。只接受以单个 `/` 开头的站内路径，拒绝 `//evil.com` 这种协议相对地址、以 `/\` 开头的地址（浏览器解析 URL 时会把反斜杠当成斜杠）和完整 URL，不合法时跳到首页。
:::

::: details SSR 页面怎么把用户信息交给客户端？
服务端查到用户后，把**界面需要的最少字段**（昵称、头像、角色）放进框架的状态里随页面下发，如 Nuxt 的 useState 或 payload、Next.js 服务端组件传给客户端组件的 props。不要把 Token、Session ID 写进 HTML，它们应该只存在于 HttpOnly Cookie 里。
:::

::: details 多个接口同时发现 Token 过期，都去刷新会怎样？
如果刷新令牌是一次性的（每次刷新都轮换），并发刷新时只有第一个成功，其他的会拿着已作废的令牌失败，甚至触发"疑似被盗用"而让会话失效。应该在请求入口（中间件）统一检查并刷新一次，把新的 Cookie 同时用于本次渲染的后续请求和返回给浏览器的 Set-Cookie。
:::

## 易错点

- 以为服务端的 fetch 会像浏览器一样自动带上 Cookie
- 只在客户端路由守卫里判断登录，受保护页面的 HTML 在首屏已经发给了浏览器
- 在客户端用 `useCookie`、`document.cookie` 读 HttpOnly Cookie 来判断登录，永远读不到
- 带登录态的页面设置了公共缓存，或者用全局变量保存"当前用户"，造成用户之间串号
