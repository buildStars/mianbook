---
difficulty: 2
tags: [安全, 场景题]
---

# 开放重定向是什么？登录后跳转的 redirect 参数怎么校验？

::: tip 一句话回答
**开放重定向**是指网站把用户可控的参数（如 `?redirect=`）直接当作跳转地址，攻击者就能借正规域名把用户带到任意网站。危害主要是**钓鱼**，以及在 OAuth 流程里把授权码或 token 带到攻击者手里。校验的正确做法是**只允许站内相对路径或白名单域名**，并且用 `URL` **解析之后比较 origin**，不要做字符串前缀匹配；前后端都要校验。
:::

## 详细解析

### 为什么会出问题

登录页常见这种设计：未登录访问 `/orders`，被带到 `/login?redirect=/orders`，登录成功后跳回去。如果服务端或前端拿到参数就直接 `location.href = redirect` 或返回 302，任何人都能构造一个以你的域名开头、实际跳到别处的链接。

危害有两类：

- **钓鱼**：链接开头是可信域名，用户和一些安全网关会放松警惕，登录后被带到仿冒页面，比如"会话过期，请重新输入密码"
- **窃取凭据**：OAuth 授权回调如果带开放重定向，授权码或 hash 里的 token 可能随着跳转落到攻击者页面，或者通过 Referer 泄露。OAuth 本身的流程见 [OAuth 2.0](/basics/network/14-oauth2)

### 字符串匹配为什么防不住

很多实现写成 `startsWith('/')` 或 `includes('example.com')`，这类判断都能被绕过，常见的几类原因：

| 写法 | 问题 |
| --- | --- |
| 以 `/` 开头就放行 | `//` 开头是**协议相对 URL**，浏览器会把后面当成主机名 |
| 包含自家域名就放行 | 目标可以把你的域名放在路径、参数或子域名前缀里 |
| `endsWith('example.com')` | 别人可以注册以这串字符结尾的另一个域名，要按 `.example.com` 带点匹配 |
| 只看前缀 `https://example.com` | URL 里 `@` 前面是用户信息，后面才是真正的主机 |
| 不处理反斜杠和编码 | 浏览器会把 `\` 当 `/` 处理，编码后的字符解码后含义也会变 |

根本原因是**校验逻辑和浏览器的 URL 解析逻辑不一致**。所以要用和浏览器同一套规则的解析器（WHATWG URL）先解析，再比较解析结果。

### 正确的校验方式

1. 能不用完整 URL 就不用：参数只接受**站内路径**，或者只传一个 key（如 `?next=orders`），服务端映射成地址
2. 必须支持跨域跳转时，维护**白名单 origin**，精确比较，不做模糊匹配
3. 用 `new URL(raw, 本站 origin)` 解析，检查 `protocol` 和 `origin`；解析失败就回到默认页
4. 拒绝 `javascript:`、`data:` 这类协议，它们在前端跳转时会变成 XSS
5. 不合法时跳到首页，而不是报错页把参数回显出来

## 代码示例

```js
const SITE_ORIGIN = 'https://app.example.com'
const ALLOWED_ORIGINS = new Set([SITE_ORIGIN, 'https://help.example.com'])

function safeRedirect(raw, fallback = '/') {
  if (typeof raw !== 'string' || raw === '') return fallback
  // 控制字符和反斜杠直接拒绝，避免各端解析不一致
  if (/[\u0000-\u001f\\]/.test(raw)) return fallback
  let url
  try {
    url = new URL(raw, SITE_ORIGIN)
  } catch {
    return fallback
  }
  if (url.protocol !== 'https:') return fallback
  if (!ALLOWED_ORIGINS.has(url.origin)) return fallback
  // 同站返回相对路径，跨站白名单返回完整地址
  return url.origin === SITE_ORIGIN ? url.pathname + url.search + url.hash : url.href
}

safeRedirect('/orders?id=1') // '/orders?id=1'
safeRedirect('//other.test/x') // '/'，协议相对 URL 被解析成别的 origin
safeRedirect('https://app.example.com.other.test/') // '/'
```

服务端返回 302 前要用同样的逻辑校验一遍。前端校验只能保护前端跳转，服务端的跳转接口照样可能被直接利用。

## 面试官可能追问

::: details 只在前端校验够吗？
不够。服务端如果有 `/logout?next=`、`/sso/callback?target=` 这类直接返回 302 的接口，攻击者根本不经过前端代码。前端跳转和后端跳转是两个入口，两边都要校验，最好共用一份白名单配置。
:::

::: details OAuth 里的 redirect_uri 怎么防开放重定向？
授权服务器要对 `redirect_uri` 做**精确匹配**（预先注册的完整地址），不要允许前缀或通配。同时，回调页本身也不能再有开放重定向，否则授权码可以经过回调页二次跳转泄露出去。配合 PKCE 和 state 参数，能进一步降低授权码被盗用的风险。
:::

::: details 真的需要跳到第三方网站时怎么办？
做一个中间提示页："你即将离开本站，前往 xxx"，展示完整的目标域名，让用户确认后再跳。很多社区和邮件系统的外链都是这么处理的。中间页同样要校验协议，只允许 http 和 https。
:::

## 易错点

- 用 `startsWith`、`includes`、正则去匹配原始字符串，而不是先解析成 URL 再比较 origin
- 子域名白名单写成 `endsWith('example.com')`，少了前面的点
- 只校验了登录跳转，忘了登出、SSO 回调、短链等其他接受跳转参数的接口
- 前端用 `location.href = redirect` 时没拦 `javascript:` 协议，开放重定向直接升级成 XSS
