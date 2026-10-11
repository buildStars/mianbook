---
difficulty: 2
tags: [高频, 安全]
---

# XSS 和 CSRF 是什么？怎么防御？

::: tip 一句话回答
**XSS**（跨站脚本攻击）是攻击者设法让恶意脚本在用户访问的页面里执行，从而窃取 Token、冒充用户操作，防御的核心是**对输出做转义**，再配合 CSP 和 HttpOnly。**CSRF**（跨站请求伪造）是攻击者诱导已登录的用户打开恶意页面，利用浏览器自动携带 Cookie 的特性，以用户的身份向目标站点发请求，防御靠 **SameSite Cookie**、CSRF Token 和校验请求来源。
:::

## 详细解析

### XSS 的三种类型

| 类型 | 过程 | 典型场景 |
| --- | --- | --- |
| 存储型 | 恶意内容被存进数据库，其他用户访问时被输出到页面 | 评论、昵称、私信 |
| 反射型 | 恶意内容放在 URL 参数里，服务端把它原样拼进返回的页面，用户点开链接就中招 | 搜索结果页回显搜索词 |
| DOM 型 | 前端 JS 把不可信的数据直接写进 DOM，不经过服务端 | 把 `location.hash` 写进 `innerHTML` |

XSS 的危害：窃取 Cookie 或 Token；以用户身份发请求、执行操作；篡改页面，比如伪造登录框骗取密码。

### XSS 的防御

- **按输出位置转义**：输出到 HTML 内容中，转义 `<`、`>`、`&` 等字符；输出到 HTML 属性中，还要转义引号；放进 JS 代码或 URL 中的数据，按各自的规则编码（如 URL 参数用 `encodeURIComponent`）
- **不用 HTML 方式渲染不可信内容**：避免 `innerHTML`、`v-html`、`dangerouslySetInnerHTML`；确实要渲染富文本时，先用 DOMPurify 等库过滤
- **校验 URL 协议**：用户提供的链接只允许 `http:`、`https:`，防止 `javascript:` 链接
- **CSP**：通过 `Content-Security-Policy` 响应头限制脚本来源。例如 `script-src 'self'` 只允许加载同源脚本，内联脚本和 `eval` 都会被禁止，注入的内联脚本也就无法执行
- **HttpOnly**：敏感 Cookie 设置 HttpOnly，脚本读不到

```js
const el = document.getElementById('greeting')
const userName = new URLSearchParams(location.search).get('name')

// ❌ 当作 HTML 插入：?name=<img src=x onerror=alert(1)> 会执行脚本
el.innerHTML = `你好，${userName}`

// ✅ 当作纯文本插入，标签会原样显示出来
el.textContent = `你好，${userName}`

// ✅ 用户提供的链接只允许 http 和 https 协议
function safeUrl(input) {
  try {
    const url = new URL(input, location.origin)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : 'about:blank'
  } catch {
    return 'about:blank'
  }
}
```

### CSRF 的过程

1. 用户登录了 `bank.com`，浏览器保存了它的 Cookie
2. 用户被诱导打开 `evil.com`，页面里藏着一个自动提交的表单，目标是 `bank.com` 的转账接口
3. 如果 Cookie 没有 SameSite 限制，浏览器向 `bank.com` 发请求时会自动带上它，服务端以为是用户本人在操作

```html
<!-- evil.com 上的页面：一打开就自动提交 -->
<form action="https://bank.com/transfer" method="POST">
  <input type="hidden" name="to" value="attacker">
  <input type="hidden" name="amount" value="10000">
</form>
<script>document.forms[0].submit()</script>
```

攻击者全程拿不到 Cookie，也看不到响应，只是"借用"了用户的身份。

### CSRF 的防御

- **SameSite Cookie**：
  - `Strict`：跨站请求一律不带 Cookie
  - `Lax`：只在跨站的顶级导航 GET 请求中携带，比如从其他网站点链接跳过来
  - `None`：允许跨站携带，但必须同时设置 `Secure`
  - Chrome 对没有设置 SameSite 的 Cookie 默认按 Lax 处理
- **CSRF Token**：服务端生成随机 Token 下发给页面，提交时放在表单字段或请求头里带回，由服务端校验。攻击者的页面受同源策略限制，读不到这个 Token
- **校验来源**：服务端检查 `Origin` 或 `Referer` 请求头，拒绝来自其他站点的请求
- **关键操作二次确认**：转账、改密码等操作要求输入密码或验证码
- **有副作用的操作不用 GET**：Lax 仍然允许跨站的 GET 跳转携带 Cookie，一个链接就能触发攻击

### 对比

| | XSS | CSRF |
| --- | --- | --- |
| 原理 | 恶意脚本在目标站点的页面里执行 | 在其他站点诱导浏览器向目标站点发请求 |
| 利用了什么 | 用户对网站的信任：网站输出了未经处理的内容 | 网站对浏览器的信任：只凭自动携带的 Cookie 就认定是用户本人 |
| 能否读取数据 | 能，脚本就运行在目标页面里 | 不能，只能发请求，看不到响应 |
| 防御重点 | 转义输出、过滤 HTML、CSP、HttpOnly | SameSite、CSRF Token、校验来源 |

## 面试官可能追问

::: details Vue / React 能防住 XSS 吗？
能防住大部分。Vue 的插值表达式和 React 的 JSX 默认把内容当作文本转义后输出。但下面这些写法会绕过框架的保护：
- `v-html`、`dangerouslySetInnerHTML` 会原样渲染 HTML
- 把用户输入绑定到 `href`、`src` 上：Vue 不会拦截 `javascript:` 协议，需要自己校验
- 通过 ref 拿到 DOM 元素后，直接设置 `innerHTML`
:::

::: details Token 放在请求头里，还需要防 CSRF 吗？
一般不需要。CSRF 依赖浏览器**自动**携带凭证，而攻击者没法让浏览器自动带上 `Authorization` 这样的请求头，也读不到目标站点存储里的 Token。但这类 Token 通常存在 localStorage 里，一旦有 XSS 就会被直接读走，所以更要重视防 XSS。两种方案的取舍见 [Cookie、Session、Token、JWT 的区别](/basics/network/13-auth)。
:::

::: details 点击劫持是什么？怎么防？
攻击者把目标网站放进一个透明的 iframe，叠在诱饵页面上。用户以为点的是诱饵页面的按钮，实际点中了目标网站上的按钮。防御方法是禁止自己的页面被其他站点嵌入：响应头设置 `X-Frame-Options: DENY`（或 `SAMEORIGIN`），或者使用 CSP 的 `frame-ancestors 'self'`。后者是更新的标准，还能指定多个允许嵌入的源。
:::

## 易错点

- HttpOnly 只能防止 Cookie 被脚本读走，挡不住 XSS 脚本直接在页面里以用户身份发请求
- SameSite 防的是跨站请求，同一站点下的不同子域名之间不受限制；如果某个子域名存在 XSS，SameSite 挡不住
- 页面存在 XSS 时，CSRF Token 也会失效，因为脚本可以直接从页面里读到 Token
