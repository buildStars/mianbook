---
difficulty: 2
tags: [高频, 原理]
---

# CORS 的预检请求是什么？什么情况下会触发？

::: tip 一句话回答
预检请求是浏览器在发送"非简单"的跨源请求之前，自动先发的一个 **OPTIONS** 请求，用 `Access-Control-Request-Method`、`Access-Control-Request-Headers` 询问服务器是否允许；服务器用 `Access-Control-Allow-Methods`、`Access-Control-Allow-Headers` 等响应头回答，通过了浏览器才发真正的请求。只要**方法不是 GET、HEAD、POST**，带了 `Authorization` 或**自定义请求头**，或者 `Content-Type` 是 `application/json` 这类**非表单类型**，就会触发预检。预检结果可以用 `Access-Control-Max-Age` 缓存。CORS 只决定浏览器让不让 JS 读到响应，**不能代替服务端鉴权**。
:::

## 详细解析

### 为什么要预检

同源策略和 CORS 的基础见[同源策略和跨域](/basics/browser/05-cross-origin)，这里只讲预检。

简单请求大致就是 HTML 表单本来就能发出的请求，服务器早就要防范它们。而 PUT、DELETE、JSON 请求体、自定义请求头，在 CORS 出现之前，别的网站根本发不出来，老的服务器可能完全没有防范。预检让服务器先明确表态"我允许"，再让可能有副作用的请求到达服务器。所以预检保护的是服务器，不是浏览器。

### 什么情况下触发

同时满足下面所有条件才是简单请求，否则就要预检：

- 方法是 `GET`、`HEAD`、`POST` 之一
- 手动设置的请求头只有 CORS 安全列表里的：`Accept`、`Accept-Language`、`Content-Language`、`Content-Type`，以及只含单个范围的 `Range`
- `Content-Type` 只能是 `text/plain`、`multipart/form-data`、`application/x-www-form-urlencoded`
- 请求体没有用 `ReadableStream`；用 XHR 时没有监听 `xhr.upload` 上的事件

| 跨源请求 | 是否预检 | 原因 |
| --- | --- | --- |
| `fetch(url)` | 否 | 普通 GET |
| POST 一个 `FormData` | 否 | 浏览器自动设为 `multipart/form-data` |
| POST JSON，`Content-Type: application/json` | 是 | 不在三种类型里 |
| GET 带 `Authorization: Bearer ...` | 是 | `Authorization` 不在安全列表里 |
| GET 带 `X-Request-Id` | 是 | 自定义请求头 |
| `DELETE`、`PUT`、`PATCH` | 是 | 方法不在允许的三种里 |
| GET 加 `credentials: 'include'` | 否 | 携带 Cookie 本身不会触发预检 |

### 一次完整的预检

```text
1. 预检请求：浏览器自动发出，不带 Cookie
OPTIONS /orders/42
Origin: https://app.example.com
Access-Control-Request-Method: PUT
Access-Control-Request-Headers: authorization, content-type

2. 预检响应：状态码必须是 2xx
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 600
Vary: Origin

3. 预检通过，发出真正的 PUT 请求
   它的响应里同样要有 Access-Control-Allow-Origin（带凭证时还要有 Allow-Credentials）
```

- 预检不通过，真正的请求**根本不会发出**；简单请求则是先发出去，再根据响应头决定 JS 能不能读
- 预检请求**从不携带 Cookie**，所以服务端的登录校验不能拦截 OPTIONS，否则返回 401，预检直接失败
- `Access-Control-Max-Age` 让浏览器在有效期内不再重复预检，默认值和各浏览器的上限见[同源策略和跨域](/basics/browser/05-cross-origin)

### 带凭证时的额外限制

请求设置了 `credentials: 'include'` 时：

- `Access-Control-Allow-Origin` 必须是具体的源，不能是 `*`
- 预检响应和真正请求的响应都要有 `Access-Control-Allow-Credentials: true`
- `Access-Control-Allow-Headers`、`Allow-Methods`、`Expose-Headers` 写 `*` 时只会被当成普通字符，必须逐个列出
- 即使不带凭证，`Access-Control-Allow-Headers: *` 也不包括 `Authorization`，它必须显式写出

### Expose-Headers

跨源响应里，JS 默认只能读到 `Cache-Control`、`Content-Language`、`Content-Length`、`Content-Type`、`Expires`、`Last-Modified`、`Pragma` 这几个响应头。分页总数 `X-Total-Count`、下载文件名所在的 `Content-Disposition` 都读不到，服务端要用 `Access-Control-Expose-Headers: X-Total-Count, Content-Disposition` 声明。

### CORS 不能代替鉴权

- CORS 是浏览器保护用户的机制：防止别的网站上的脚本读取你的接口返回的数据。curl、服务端脚本根本不看这些响应头
- 简单请求在 CORS 检查之前已经到达服务器并被执行，有副作用的接口不能指望 CORS 阻止跨站调用，CSRF 的防御见 [XSS 和 CSRF](/basics/browser/06-xss-csrf)
- 接口要自己做鉴权和权限校验。`Access-Control-Allow-Origin` 的白名单要精确匹配：不要原样回显请求的 `Origin`，不要用"包含""以某域名结尾"这类宽松判断，不要放行 `null`（沙箱 iframe 和本地文件的源就是 `null`）

### 常见报错排查

| 报错里的关键信息（Chrome 控制台） | 常见原因 | 处理 |
| --- | --- | --- |
| `No 'Access-Control-Allow-Origin' header` | 服务端没返回；或者接口出错时，错误响应没带 CORS 头（如 Nginx 的 `add_header` 没加 `always`），前端只看到跨域错误，看不到真实的 4xx、5xx | 错误响应也加上 CORS 头，先查服务端日志 |
| `does not have HTTP ok status` | OPTIONS 被登录校验拦成 401，或者路由没处理返回 404、405 | 在鉴权之前统一处理 OPTIONS |
| `must not be the wildcard '*'` | 携带凭证，却返回了 `*` | 按白名单返回具体的源 |
| `is not allowed by Access-Control-Allow-Headers` | 预检响应没列出这个请求头 | 加到 `Access-Control-Allow-Headers` 里 |
| `Redirect is not allowed for a preflight request` | 预检被重定向，如 HTTP 跳 HTTPS、补末尾斜杠 | 直接请求最终地址 |

## 面试官可能追问

::: details 只是一个 GET 请求，为什么也触发了预检？
多半是请求库的拦截器给所有请求统一加了请求头：`Authorization`、`X-Request-Id`、追踪用的请求头，或者给 GET 也设置了 `Content-Type: application/json`。在开发者工具里看 OPTIONS 请求的 `Access-Control-Request-Headers`，就知道是哪个请求头导致的。
:::

::: details 怎么减少预检请求？
最彻底的是让页面和接口同源，比如用 Nginx 把 `/api` 反向代理到后端，就没有 CORS 了。做不到时，设置合理的 `Access-Control-Max-Age`，并去掉不必要的自定义请求头。不建议把 JSON 改成 `text/plain` 来"变成简单请求"：服务端要特殊解析，而且以 Cookie 鉴权的接口会重新暴露在 CSRF 之下。
:::

::: details 服务端直接把请求的 Origin 原样写进 Allow-Origin，有什么风险？
等于允许所有网站。再加上 `Access-Control-Allow-Credentials: true`，任何网站的脚本都能带着用户的 Cookie 调用你的接口并读到响应，用户资料、订单这类数据都会被读走。正确做法是和白名单精确比对，命中才返回这个源，同时加 `Vary: Origin`，避免缓存把一个源的响应头给了另一个源。
:::

::: details 预检失败时，服务器收到真正的请求了吗？
没有。服务器只收到了 OPTIONS 请求，真正的请求被浏览器拦在本地。简单请求不同：请求已经发出并被处理，只是 JS 读不到响应。所以排查"接口到底有没有执行"时，要先分清是哪种情况。
:::

## 易错点

- 以为带 Cookie 会触发预检：触发预检的是方法、请求头和 `Content-Type`，不是凭证
- 只在预检响应里加了 CORS 头，真正请求的响应没加，JS 照样读不到
- `Access-Control-Allow-Headers: *` 不包括 `Authorization`；带凭证时 `*` 还会被当成普通字符
- 把 CORS 当成接口的访问控制：它只约束浏览器里的脚本，挡不住直接发起的请求
