---
difficulty: 2
tags: [安全, 场景题]
---

# 登录的 Token 存在哪里更安全？localStorage 还是 Cookie？

::: tip 一句话回答
没有绝对安全的位置，要看防的是什么。**localStorage** 对页面上能执行的任何脚本都可读，一旦有 XSS，Token 会被直接偷走，拿到别的机器上一直用到过期。**HttpOnly Cookie** 脚本读不到，但浏览器会自动携带，要用 `SameSite`、CSRF Token 防 CSRF，再加 `Secure` 保证只走 HTTPS。常见的折中方案是**短期的 Access Token 放内存，Refresh Token 放 HttpOnly Cookie**。无论放在哪里，XSS 都能借用户的身份在页面里发请求，**防 XSS 才是根本**。
:::

## 详细解析

### 先分清两种威胁

- **XSS**：恶意脚本在你的页面里执行，能读页面能读到的一切存储，也能以用户身份发请求
- **CSRF**：别的网站诱导浏览器向你的接口发请求，靠的是浏览器**自动携带**的凭证

存储位置决定了 XSS 能不能**把 Token 偷走**。偷走和在页面里滥用的差别很大：偷走后攻击者可以在自己的机器上长期使用，用户关掉页面也没用；而只能在页面里滥用时，攻击只在用户开着页面的这段时间里有效，范围小得多。两种攻击的原理见 [XSS 和 CSRF](/basics/browser/06-xss-csrf)。

### 各位置对比

| 存储位置 | XSS 能直接读走吗 | 会自动携带（有 CSRF 风险）吗 | 刷新页面后 | 说明 |
| --- | --- | --- | --- | --- |
| localStorage | 能 | 不会 | 还在 | 实现最简单，调跨域接口方便 |
| sessionStorage | 能 | 不会 | 还在，新标签页里没有 | XSS 风险和 localStorage 一样 |
| 普通 Cookie | 能 | 会 | 还在 | 两种风险都有，最差 |
| HttpOnly Cookie | 不能 | 会 | 还在 | 要配合 SameSite 和 CSRF 防护 |
| 内存（JS 变量） | 不能直接读，但 XSS 可以改写 `fetch` 等方式截获后续请求 | 不会 | 丢失 | 要配合刷新机制重新换取 |

### HttpOnly Cookie 怎么配

```text
Set-Cookie: __Host-sid=8f3a...; Path=/; Secure; HttpOnly; SameSite=Lax
```

- `HttpOnly`：`document.cookie` 读不到它
- `Secure`：只在 HTTPS 请求中发送（多数浏览器对 localhost 例外），防止在明文链路上被截获
- `SameSite=Lax`：跨站的 POST、iframe、图片等子请求都不带它，只有跨站的顶层 GET 导航（比如从别的网站点链接跳过来）会带。`Strict` 更严格，但用户从外站链接点进来时也不带，看起来就像没登录
- 不设置 SameSite 时，Chrome、Edge 等 Chromium 内核的浏览器默认按 Lax 处理（刚设置两分钟内的 Cookie 还允许跨站的顶层 POST 携带），Firefox、Safari 目前默认不这样做，所以要显式写上
- `__Host-` 前缀：浏览器要求这个 Cookie 必须有 `Secure`、`Path=/`，并且不能设置 `Domain`。这样子域名就没法写入一个同名 Cookie 来覆盖它

SameSite 只管跨站请求，同一站点下的其他子域名不受限制，所以重要接口还要加 CSRF Token 或校验 `Origin`。

### 折中方案：内存 + HttpOnly 的 Refresh Token

```text
登录      响应体返回 Access Token（有效期 15 分钟），前端只放在内存变量里
          Set-Cookie: __Host-refresh=...; HttpOnly; Secure; SameSite=Strict; Path=/
请求接口  Authorization: Bearer <Access Token>，不依赖 Cookie，没有 CSRF 问题
过期      调用 POST /api/auth/refresh，浏览器自动带上 refresh Cookie，换回新的 Access Token
刷新页面  内存清空，同样先调用一次刷新接口
退出      服务端作废 Refresh Token，并清除 Cookie
```

- Access Token 不落盘，XSS 偷走的也只是一个很快过期的令牌
- Refresh Token 脚本读不到，`SameSite=Strict` 让跨站请求带不上它。刷新接口只返回新令牌，跨站的页面受同源策略限制读不到响应，再校验一下 `Origin` 更稳妥
- 每次刷新都轮换 Refresh Token、发现旧令牌被重复使用就全部作废，这些服务端的做法见 [Cookie、Session、Token、JWT](/basics/network/13-auth)
- 前提是页面和接口同站，否则 SameSite 为 Lax、Strict 的 Cookie 带不过去

## 代码示例

前端的令牌管理：Access Token 只存在内存里，多个请求同时遇到 401 时只刷新一次：

```js
let accessToken = null // 只存在内存里，刷新页面后通过 refresh 接口重新换取
let refreshing = null // 正在进行的刷新：多个请求同时过期时共用这一次

function refreshAccessToken() {
  // 同源请求默认会带上 Cookie，Refresh Token 就在 HttpOnly Cookie 里
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST' })
    .then((res) => {
      if (!res.ok) throw new Error('登录已失效')
      return res.json()
    })
    .then((data) => (accessToken = data.accessToken))
    .finally(() => (refreshing = null))
  return refreshing
}

export async function apiFetch(url, options = {}) {
  if (!accessToken) await refreshAccessToken()
  const send = () =>
    fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${accessToken}` } })
  let res = await send()
  if (res.status === 401) {
    await refreshAccessToken()
    res = await send()
  }
  return res
}
```

## 面试官可能追问

::: details Token 放进 HttpOnly Cookie 后，XSS 是不是就没事了？
不是。XSS 脚本读不到 Cookie，但可以直接在页面里调用接口，浏览器照样带上 Cookie，用户能做的操作它都能做，页面上显示的数据它也都能读。HttpOnly 的价值是让攻击者没法把凭证带走长期使用。要防住 XSS 本身，还是靠转义输出、CSP 这些手段，见 [CSP](/basics/web-security/01-csp)。
:::

::: details 前端和接口不在同一个站点，还能用 Cookie 吗？
可以，但麻烦越来越多：Cookie 要设成 `SameSite=None; Secure`，请求要加 `credentials: 'include'`，CORS 要返回具体的源和 `Access-Control-Allow-Credentials: true`。而且不少浏览器默认就限制第三方 Cookie，跨站的 Cookie 可能直接被拦截。更稳妥的做法是用反向代理把接口挂到页面的同一个域名下，或者引入 BFF。
:::

::: details 有没有让前端完全接触不到 Token 的方案？
有，就是 BFF 模式：浏览器和 BFF 之间只用一个 HttpOnly 的会话 Cookie，调用后端服务或第三方 API 用的 Access Token 保存在 BFF 服务端，由 BFF 代为转发请求。前端代码里没有任何令牌，XSS 也就偷不走它。代价是多了一层服务要维护，见 [BFF](/basics/node/17-bff)。
:::

::: details 退出登录时要做哪些事？
服务端作废 Session 或 Refresh Token，这是最关键的一步，只在前端删掉令牌，旧令牌在过期前依然可用。然后用 `Max-Age=0` 清除 Cookie，`Path` 和 `Domain` 要和设置时一致，否则删不掉。最后清空内存里的令牌和本地缓存的用户数据，并通知其他标签页一起退出，见[标签页通信](/basics/browser/17-cross-tab)。
:::

## 易错点

- 以为 Token 放 localStorage 就"没有 CSRF、更安全"：它只是把 CSRF 的风险换成了被 XSS 偷走的风险
- sessionStorage 和 localStorage 一样，页面里的脚本都能读到
- `SameSite=Lax` 仍然允许跨站的 GET 导航携带 Cookie，有副作用的操作不能用 GET
- 清除 Cookie 时 `Path`、`Domain` 和设置时不一致，浏览器会当成另一个 Cookie，原来的删不掉
