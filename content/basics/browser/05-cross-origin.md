---
difficulty: 2
tags: [高频]
---

# 什么是同源策略？跨域有哪些解决方案？

::: tip 一句话回答
**同源**指协议、域名、端口三者都相同。同源策略限制的是 JS **读取**跨源数据，比如读取 fetch 的响应、访问跨源 iframe 的 DOM，而 `<img>`、`<script>` 等资源嵌入不受限制。主流的解决方案是 **CORS**：服务端返回 `Access-Control-Allow-Origin` 等响应头，声明允许哪些源读取；也可以用开发服务器代理或 Nginx 反向代理，把请求变成同源。
:::

## 详细解析

### 什么算同源

以 `https://www.example.com` 为例：

| 地址 | 是否同源 | 原因 |
| --- | --- | --- |
| `https://www.example.com/api/user` | 同源 | 只有路径不同 |
| `http://www.example.com` | 不同源 | 协议不同 |
| `https://api.example.com` | 不同源 | 域名不同，子域名也算不同 |
| `https://www.example.com:8443` | 不同源 | 端口不同（HTTPS 默认端口是 443） |

### 同源策略限制什么

- **限制**：读取跨源请求的响应（fetch、XHR）；访问跨源窗口或 iframe 的 DOM；读取其他源的 localStorage、IndexedDB 等存储（Cookie 不完全按源隔离，由 `Domain`、`Path` 决定能否读取）
- **不限制**：资源嵌入，`<img>`、`<script>`、`<link>`、`<video>` 等都可以加载跨源资源；表单提交、页面跳转也不受限制

跨域请求被拦截，不代表请求没发出去。简单请求通常已经到达服务器并被处理了，是浏览器发现响应里没有允许的 CORS 头，才不把结果交给 JS。所以不能指望同源策略来防御 CSRF（见 [XSS 和 CSRF](/basics/browser/06-xss-csrf)）。

### CORS：简单请求和预检请求

**简单请求**要同时满足下面几个主要条件，浏览器会直接发送，并在请求头里带上 `Origin`：

- 方法是 `GET`、`HEAD`、`POST` 之一
- 只使用 CORS 安全列表中的请求头，比如 `Accept`、`Accept-Language`、`Content-Language`、`Content-Type`；带了 `Authorization` 或自定义请求头就不算
- `Content-Type` 只能是 `text/plain`、`multipart/form-data`、`application/x-www-form-urlencoded` 之一

不满足时，浏览器会先发一个 `OPTIONS` **预检请求**，用 `Access-Control-Request-Method`、`Access-Control-Request-Headers` 询问服务器是否允许。预检通过才发送真正的请求，不通过就不发。

| 响应头 | 作用 |
| --- | --- |
| `Access-Control-Allow-Origin` | 允许哪个源读取响应，只能是一个具体的源或 `*` |
| `Access-Control-Allow-Methods` | 允许的请求方法，用于预检响应 |
| `Access-Control-Allow-Headers` | 允许的请求头，用于预检响应 |
| `Access-Control-Allow-Credentials` | 是否允许携带 Cookie 等凭证 |
| `Access-Control-Max-Age` | 预检结果可以缓存多少秒 |
| `Access-Control-Expose-Headers` | 允许 JS 读取哪些额外的响应头，默认只能读到 `Content-Type` 等少数几个 |

### 跨域携带 Cookie

要让跨域请求带上 Cookie，并且 JS 能读到响应，需要同时满足：

- 前端：fetch 设置 `credentials: 'include'`，XHR 设置 `withCredentials = true`
- 后端：返回 `Access-Control-Allow-Credentials: true`
- 后端：`Access-Control-Allow-Origin` 必须是具体的源，不能是 `*`

```js
// Express 中间件：按白名单返回 CORS 响应头
const allowList = ['https://www.example.com', 'http://localhost:5173']

app.use((req, res, next) => {
  const { origin } = req.headers
  // 响应头随请求的 Origin 变化，告诉缓存要按 Origin 区分
  res.vary('Origin')
  if (allowList.includes(origin)) {
    // 要携带 Cookie，就必须返回具体的源，不能用 *
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  if (req.method === 'OPTIONS') {
    // 预检请求：声明允许的方法和请求头，预检结果缓存 10 分钟
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Max-Age', '600')
    return res.sendStatus(204)
  }
  next()
})
```

### 其他方案

- **开发环境代理**：Vite 的 `server.proxy`、webpack devServer 的 `proxy`。浏览器请求的是同源的开发服务器，再由它转发给后端；服务器之间的请求不受同源策略限制
- **Nginx 反向代理**：生产环境把前端页面和接口放到同一个源下，比如把 `/api/` 开头的请求转发给后端服务，从根本上避免跨域（见[反向代理和负载均衡](/basics/network/20-reverse-proxy)）
- **postMessage**：窗口或 iframe 之间跨源通信，接收方要校验 `event.origin`（见[标签页通信](/basics/browser/17-cross-tab)）
- **WebSocket**：不受同源策略限制，但握手请求会带上 `Origin`，服务端应该校验。否则任何网站的页面都能连上来，如果靠 Cookie 鉴权，还可能被冒用身份
- **JSONP**：利用 `<script>` 可以跨源加载的特点，只支持 GET，而且要无条件信任对方返回的脚本，有安全风险，已经过时

## 面试官可能追问

::: details 为什么发送 JSON 的 POST 请求会触发预检？
`Content-Type: application/json` 不在简单请求允许的三种类型里。简单请求大致对应 HTML 表单本来就能发出的请求，服务器早就需要防范这类请求；超出这个范围的请求（JSON 请求体、自定义请求头、PUT、DELETE 等），老的服务器可能没有预料到，所以浏览器要先问一下服务器是否允许。
:::

::: details 预检请求的结果能缓存吗？
可以。服务端返回 `Access-Control-Max-Age: 600`，浏览器在 600 秒内对同一个 URL 的同类请求不再重复预检。不设置时默认只缓存 5 秒；各浏览器对这个值都有上限（Chrome 是 2 小时，Firefox 是 24 小时），设置得再大也会被截断。缓存按完整 URL 区分，换一个接口地址、甚至只是查询参数不同，都要重新预检。
:::

::: details 跨域请求为什么没有带上 Cookie？
按顺序排查：
- 前端有没有设置 `credentials: 'include'`。fetch 默认是 `same-origin`，跨源请求不带 Cookie
- 后端 CORS 头是否正确：需要预检的请求，如果预检响应里没有 `Access-Control-Allow-Credentials: true` 和具体的源，真正的请求根本不会发出
- Cookie 的 `SameSite`：页面和接口跨站时，Cookie 必须设置 `SameSite=None; Secure`；只是跨源但同站（如 `www.example.com` 和 `api.example.com`），默认的 Lax 也能携带
- Cookie 的 `Domain`、`Path` 是否覆盖了接口地址，以及是否被浏览器的第三方 Cookie 限制拦截

Cookie 各个属性的含义见[浏览器存储](/basics/browser/07-storage)。
:::

## 易错点

- CORS 是浏览器的限制，服务器之间的调用、Postman、curl 都不受影响
- 跨域报错不等于请求没到服务器：简单请求已经被服务器处理了，只是 JS 拿不到响应
- `Access-Control-Allow-Origin` 不能写多个源，要支持多个源，只能由服务端按白名单动态返回，并加上 `Vary: Origin`
