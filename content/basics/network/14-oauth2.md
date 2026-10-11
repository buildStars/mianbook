---
difficulty: 2
tags: [安全]
---

# OAuth 2.0 的授权码流程是怎样的？

::: tip 一句话回答
OAuth 2.0 是一个**授权**框架，解决"第三方应用在拿不到用户密码的情况下，获得访问用户资源的有限权限"的问题，比如用 GitHub 账号登录某个网站。最常用的授权码模式分两段：用户在授权服务器上同意后，浏览器带着一次性的**授权码**（code）跳回第三方应用；应用的后端再用 code 加 `client_secret` 换取 `access_token`，令牌不经过浏览器。`state` 参数用来防 CSRF；无法保存密钥的单页应用和移动应用必须配合 **PKCE**，现在也推荐所有客户端都使用。
:::

## 详细解析

### 四个角色

| 角色 | 说明 | 以"用 GitHub 登录某网站"为例 |
| --- | --- | --- |
| 资源所有者 | 用户本人 | 你 |
| 客户端 | 想访问用户资源的第三方应用 | 某网站 |
| 授权服务器 | 验证用户身份，征得同意后发放令牌 | GitHub 的授权服务 |
| 资源服务器 | 保存用户资源，凭令牌提供访问 | GitHub 的 API |

### 授权码流程

```text
1. 用户 → 客户端：点击"第三方登录"
2. 客户端 → 浏览器：302 重定向到授权服务器
   https://auth.example.com/authorize?response_type=code&client_id=app123
     &redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&scope=profile&state=k8x2Qf
3. 用户 → 授权服务器：登录，在授权页上确认要授予的权限
4. 授权服务器 → 浏览器：302 重定向回 redirect_uri
   https://app.example.com/callback?code=Xa91bQe7&state=k8x2Qf
5. 浏览器 → 客户端后端：带着 code 和 state 访问回调地址，后端校验 state
6. 客户端后端 → 授权服务器：POST /token（服务器之间直接通信）
   grant_type=authorization_code&code=Xa91bQe7
   &redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback&client_id=app123&client_secret=***
7. 授权服务器 → 客户端后端：{ "access_token": "...", "token_type": "Bearer", "expires_in": 3600 }
   （可能还有 refresh_token）
8. 客户端后端 → 资源服务器：带上 Authorization: Bearer access_token，获取用户资源
```

关键参数：
- `redirect_uri`：回调地址，授权服务器会校验它和注册时登记的地址是否一致，防止 code 被发到攻击者的地址
- `scope`：申请的权限范围，用户在授权页上能看到
- `state`：客户端生成的随机值，存进会话，回调时比对，防止 CSRF
- `client_secret`：客户端的密钥，只能保存在后端。它也可以用 HTTP Basic 认证的方式放在请求头里（RFC 6749 更推荐这种），具体看授权服务器支持哪种

### PKCE：保护公共客户端

单页应用和移动应用的代码在用户手里，没法安全地保存 `client_secret`，属于"公共客户端"。授权码一旦被截获（比如移动端被恶意 App 注册了同样的回调地址），攻击者就能拿它换令牌。PKCE（Proof Key for Code Exchange）的做法是：

1. 客户端生成一个随机字符串 `code_verifier`，自己保存
2. 授权请求带上 `code_challenge`（`code_verifier` 做 SHA-256 后再做 Base64URL 编码）和 `code_challenge_method=S256`
3. 换令牌时带上原始的 `code_verifier`，授权服务器算一遍，和之前收到的 `code_challenge` 比对

截获 code 的人没有 `code_verifier`，换不到令牌。PKCE 最初是为公共客户端设计的，后来发现它对机密客户端同样有用（能防御授权码注入），所以 OAuth 2.1 草案要求客户端默认都使用 PKCE，只有正确实现了 OIDC `nonce` 机制的机密客户端可以例外，但仍然推荐使用。

```js
const base64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// code_verifier：32 字节随机数，编码后是 43 个字符
const codeVerifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
const codeChallenge = base64url(new Uint8Array(digest))
```

### 其他授权方式

| 模式 | 适用场景 | 现状 |
| --- | --- | --- |
| 授权码模式（+ PKCE） | 有用户参与的 Web 应用、单页应用、移动应用 | 最常用 |
| 客户端凭证模式 | 服务之间调用，没有用户参与，客户端用自己的身份换令牌 | 常用 |
| 设备码模式 | 电视、命令行工具等不方便输入的设备：设备显示一个验证码，用户在手机上打开验证地址、输入验证码并授权 | 常用 |
| 隐式模式 | 早期的单页应用使用，令牌直接放在重定向地址里返回 | 不再推荐，OAuth 2.1 草案已移除 |
| 密码模式 | 用户把账号密码直接交给客户端 | 不再推荐，OAuth 2.1 草案已移除 |

### OAuth 和 OIDC

OAuth 本身只负责**授权**，回答的是"允许这个应用访问我的哪些资源"。`access_token` 是给资源服务器用的，客户端不应该靠解析它来判断用户是谁。

OpenID Connect（OIDC）在 OAuth 2.0 之上增加了**身份认证**：`scope` 里带上 `openid`，令牌接口除了返回 `access_token`，还会返回一个 **ID Token**。它是一个 JWT（见 [JWT](/basics/network/13-auth)），包含用户标识 `sub`、签发者 `iss`、接收方 `aud`、过期时间 `exp` 等，客户端验证签名、校验 `iss`、`aud`、`exp` 后就知道"谁登录了"。

"第三方登录"通常基于 OIDC；也有的平台只提供 OAuth，网站拿到 `access_token` 后再调用平台的用户信息接口来识别用户。拿到用户标识后，网站一般会建立自己的登录态（Session 或自己签发的 JWT）。

## 面试官可能追问

::: details 为什么要先返回 code，再用 code 换 token，而不是直接返回 token？
- 重定向要经过浏览器，URL 会留在浏览器历史和服务器日志里，还可能通过 `Referer` 泄露，直接放令牌不安全
- code 只能使用一次，有效期很短（RFC 6749 建议最长 10 分钟），单独拿到也没用：换令牌还需要 `client_secret` 或 PKCE 的 `code_verifier`
- 换令牌是后端和授权服务器之间的直接通信，授权服务器可以验证客户端的身份，令牌也不经过浏览器
:::

::: details state 参数有什么作用？
防止 CSRF。攻击者可以用自己的账号走一遍授权流程，拿到 code 后不使用，而是诱导受害者访问 `/callback?code=攻击者的code`。如果客户端不做校验，受害者的账号就会绑定上攻击者的第三方账号，或者直接登录进攻击者的账号。

所以客户端发起授权时要生成随机的 `state` 存进会话，回调时比对，不一致就拒绝。
:::

::: details OAuth 和单点登录（SSO）是什么关系？
SSO 是目标：登录一次，就能访问多个系统；OAuth 是授权协议，本身不是为 SSO 设计的。实践中常用基于 OAuth 2.0 的 OIDC 实现 SSO：各个系统都把用户重定向到同一个授权服务器（认证中心），用户已经登录过的话，授权服务器直接带着 code 跳回，用户无感知。企业内部也常见 CAS、SAML 等协议。
:::

## 易错点

- OAuth 2.0 是授权协议，不是认证协议；"用 XX 登录"靠的是 OIDC 的 ID Token，或者额外调用用户信息接口
- `client_secret` 只能放在后端，不能写进前端代码或 App 安装包；公共客户端要用 PKCE
- `redirect_uri` 要精确匹配，宽松的前缀或通配符匹配可能让 code 被重定向到攻击者控制的地址
