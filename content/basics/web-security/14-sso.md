---
difficulty: 2
tags: [安全, 系统设计]
---

# 单点登录（SSO）怎么实现？同域、跨域和基于 OIDC 的方案有什么区别？

::: tip 一句话回答
单点登录的目标是在**认证中心登录一次，多个系统都认这次登录**。同一主域下的子系统，可以把会话 Cookie 设在父域上共享；不同主域时 Cookie 没法共享，用**认证中心 + 一次性票据**的模式（如 CAS）：各系统未登录就跳认证中心，认证中心有会话就直接签发票据跳回，系统在服务端用票据换用户信息、建立自己的会话。基于 **OIDC** 是标准化的做法，用授权码流程拿到 id_token 识别用户。
:::

## 详细解析

### 同一主域：父域 Cookie

`a.example.com` 和 `b.example.com` 共享登录，可以把会话 Cookie 设成 `Domain=example.com`，所有子域的请求都会带上它。前提是各系统能识别这个 Cookie：要么共享同一个会话存储（如 Redis），要么 Cookie 里放的是各系统都能校验的令牌。

缺点：任何一个子域都能读到、也能覆盖这个 Cookie，一个子域被攻破就会波及全部；而且只适用于同一主域。

### 跨域：CAS 式认证中心

`a.com`、`b.com` 和认证中心 `sso.com` 三个域名，Cookie 各管各的。登录状态分两层：**认证中心的全局会话**（`sso.com` 的 Cookie）和**各系统的局部会话**（各自域名的 Cookie）。

```text
首次访问系统 A：
浏览器 → a.com/orders           A 没有局部会话
a.com  → 302 sso.com/login?service=https://a.com/callback
浏览器 → sso.com/login          sso.com 也没有全局会话，显示登录页
用户提交账号密码 → sso.com 建立全局会话（Set-Cookie 在 sso.com）
sso.com → 302 a.com/callback?ticket=ST-xxx
a.com 服务端 → sso.com/validate?ticket=ST-xxx&service=...（后端直连）
sso.com → 返回用户信息，票据作废
a.com  → 建立 A 的局部会话（Set-Cookie 在 a.com），跳回 /orders

随后访问系统 B：
浏览器 → b.com                 B 没有局部会话
b.com  → 302 sso.com/login?service=https://b.com/callback
浏览器带着 sso.com 的 Cookie，认证中心发现已有全局会话，不显示登录页
sso.com → 302 b.com/callback?ticket=ST-yyy → B 服务端换取用户信息、建立会话
```

用户访问 B 时只看到几次跳转，不需要再输密码，这就是"单点"的体验。票据要满足三点：**一次性**、**有效期很短**（秒级）、**只在服务端交换**，用户信息不经过浏览器 URL 传递。

### 基于 OIDC

OIDC 在 OAuth 2.0 上加了身份层，流程就是授权码流程（细节见 [OAuth 2.0 的授权码流程](/basics/network/14-oauth2)），各系统作为 RP 接入同一个认证服务（OP）。和 CAS 的思路一致，但协议、发现地址、令牌格式都标准化了，现成的 IdP 和客户端库很多。

| | id_token | access_token |
| --- | --- | --- |
| 给谁看 | 客户端（各业务系统） | 资源服务器（API） |
| 用途 | 说明用户是谁、怎么完成认证的 | 调用 API |
| 格式 | 一定是 JWT，必含 `iss`、`sub`、`aud`、`exp`、`iat` | 可以是 JWT，也可以是随机字符串 |

客户端用 id_token 识别用户、建立自己的会话；不应该解析 access token，也不应该把 id_token 发给 API。

### 单点退出

登录一次处处可用，退出也要处处失效：

1. 用户在任一系统点退出，跳到认证中心的退出地址
2. 认证中心销毁全局会话，并通知所有登记过的系统：服务端逐个回调（CAS 的 SLO、OIDC 的 Back-Channel Logout 就是这种思路），或者前端逐个加载各系统的退出地址
3. 各系统删除自己的局部会话

只删全局会话不通知子系统，用户在 A 的局部会话还活着，看起来"退不干净"。

### 第三方 Cookie 受限的影响

有些方案在页面里放一个隐藏的认证中心 iframe，静默检查登录状态或续期。这时认证中心的 Cookie 是第三方 Cookie，会受浏览器政策影响：目前 Safari 默认拦截所有第三方 Cookie；Firefox 默认按顶级站点分区，iframe 里拿不到用户直接访问认证中心时的那份 Cookie；Chrome 目前默认不拦截，但无痕模式和用户主动设置时会拦截。所以静默登录不能作为唯一手段，应该以整页跳转为主，需要时再看 Storage Access API、FedCM 这类方案。

## 面试官可能追问

::: details 回跳地址为什么要白名单？
`service` 或 `redirect_uri` 参数如果随便填，攻击者可以构造一个链接，让认证中心把票据或授权码发到他控制的地址上，这是开放重定向的一种。认证中心要为每个接入系统登记回调地址，精确匹配，不要用前缀或包含判断（OAuth 2.1 草案明确要求 redirect URI 精确字符串匹配，前缀匹配容易被同域下的其他路径或开放重定向绕过），详见 [开放重定向](/basics/web-security/09-open-redirect)。
:::

::: details 票据为什么不直接带用户信息？
URL 上的内容会留在浏览器历史、服务器日志和 Referer 里，带着用户信息或长期令牌就是泄露。票据本身没有意义，有效期短、只能用一次，系统必须在服务端带上自己登记的回调地址去认证中心换取（OIDC 还要带客户端凭证或 PKCE 的 code_verifier），而且换过一次就作废，被截获后能利用的窗口很小。
:::

::: details 各系统的局部会话和全局会话过期时间怎么协调？
局部会话可以比全局会话短。局部会话过期后，系统再跳一次认证中心，全局会话还在就无感拿到新票据；全局会话过期了才需要用户重新登录。这样各系统能独立控制自己的安全级别。
:::

## 易错点

- 认为 SSO 就是"共享一个 Cookie"，跨主域时 Cookie 根本共享不了
- 票据在前端交换、或者可以重复使用，被截获后就能冒用身份
- 只做单点登录，不做单点退出
- 依赖 iframe 静默登录，在默认拦截第三方 Cookie 的浏览器上失效
