---
difficulty: 2
tags: [高频, 安全]
---

# Cookie、Session、Token、JWT 有什么区别？

::: tip 一句话回答
HTTP 是无状态的，需要额外的机制记住"谁登录了"。**Cookie** 是浏览器保存、并自动随请求携带的数据，是一种载体；**Session** 把会话数据存在服务端，只通过 Cookie 交给浏览器一个 sessionId；**Token** 是服务端签发、客户端保存的令牌，请求时放在 `Authorization` 请求头里；**JWT** 是一种自包含的 Token 格式，服务端验证签名就能识别用户，不需要保存会话，代价是签发后很难主动让它失效。
:::

## 详细解析

### 四个概念不在同一个层面

| 概念 | 是什么 | 说明 |
| --- | --- | --- |
| Cookie | 浏览器的存储和传输机制 | 服务端用 `Set-Cookie` 写入，之后浏览器访问该域名时自动带上 |
| Session | 服务端的会话机制 | 状态存在服务端，客户端只持有 sessionId，通常放在 Cookie 里 |
| Token | 服务端签发的令牌 | 客户端保存，请求时显式带上；可以是随机字符串，也可以是 JWT |
| JWT | 一种 Token 格式 | 用户信息和签名都在令牌里，服务端不用保存 |

Cookie 的 `HttpOnly`、`SameSite` 等属性，以及它和其他存储方式的对比，见[浏览器存储](/basics/browser/07-storage)。

### Session

```text
1. 用户登录，服务端校验通过，创建会话：sid=abc123 → { userId: 42 }
2. 响应头：Set-Cookie: sid=abc123; HttpOnly; Secure; SameSite=Lax
3. 之后的请求，浏览器自动带上：Cookie: sid=abc123
4. 服务端用 sid 查到会话，就知道是谁
```

有多台服务器时，Session 如果只存在某一台的内存里，请求落到其他机器上就会丢失登录态。常见做法是把 Session 集中存到 Redis；也可以让负载均衡做会话保持（见[反向代理和负载均衡](/basics/network/20-reverse-proxy)），但不如共享存储可靠。

### Token 和 JWT

Token 由客户端（浏览器、App）自己保存，请求时放在请求头里：`Authorization: Bearer <token>`。它不依赖 Cookie，跨域调用和移动端使用都方便。如果 Token 只是一个随机字符串，服务端仍然要查存储，本质上和 Session 差不多；JWT 则把信息直接放在令牌里。

JWT 由 Header、Payload、Signature 三部分组成，各自经过 Base64URL 编码后用 `.` 连接：

```text
Header（签名算法和类型）
{"alg":"HS256","typ":"JWT"}

Payload（声明：用户 ID、角色、签发时间、过期时间等）
{"sub":"123","role":"user","iat":1760000000,"exp":1760000900}

Signature（用服务端密钥对前两部分签名）
HMAC-SHA256(base64url(Header) + "." + base64url(Payload), 密钥)

拼起来就是：
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJyb2xlIjoidXNlciIsImlhdCI6MTc2MDAwMDAwMCwiZXhwIjoxNzYwMDAwOTAwfQ.sXNbzV73WCCUiui70nqvWmxRMDnbxUkoxd_WWHzKF9I
```

- 签名保证内容**不被篡改**：改了 Payload，签名就对不上
- Payload **只是编码，不是加密**，任何人都能解码看到，不能放密码、手机号等敏感信息
- `HS256` 用同一个密钥签名和验证；`RS256` 等非对称算法用私钥签名、公钥验证，其他服务只拿公钥就能验证，适合跨服务
- 服务端校验时要检查签名和 `exp`，并限定允许的算法（比如只允许 `HS256`），防止攻击者篡改 Header 里的 `alg` 绕过校验

### Session 和 JWT 对比

| | Session | JWT |
| --- | --- | --- |
| 状态存在哪 | 服务端（内存、Redis） | 令牌本身，服务端不保存 |
| 横向扩展、跨服务 | 需要共享存储 | 各服务用密钥或公钥验签即可 |
| 主动失效（踢人、改密码） | 删掉会话即可 | 难，过期前一直有效，要靠黑名单或很短的有效期 |
| 体积 | sessionId 很短 | 包含 Payload 和签名，每次请求都要带上 |
| 每次请求的开销 | 查一次存储 | 验一次签名 |

### 双令牌：Access Token + Refresh Token

- **Access Token** 有效期短（比如 15 分钟），每次请求都带上，泄露了损失也有限
- **Refresh Token** 有效期长（比如 7 天），只用来换取新的 Access Token；服务端通常会记录它，可以随时作废
- Access Token 过期后，接口返回 401，前端用 Refresh Token 调刷新接口换取新的 Access Token，再重试原请求；多个请求同时遇到 401 时，只刷新一次

### 令牌存在哪里

| 位置 | 风险 | 防护 |
| --- | --- | --- |
| localStorage | XSS 脚本可以直接读走 | 严格防 XSS（转义输出、CSP） |
| HttpOnly Cookie | 脚本读不到，但浏览器会自动携带，有 CSRF 风险 | `SameSite`、CSRF Token、校验 `Origin` |
| 内存（JS 变量） | 刷新页面就没了 | 常和 HttpOnly Cookie 里的 Refresh Token 配合，刷新页面后重新换取 |

XSS 和 CSRF 的原理见 [XSS 和 CSRF](/basics/browser/06-xss-csrf)。

## 面试官可能追问

::: details JWT 被盗了怎么办？
JWT 在过期前谁拿到都能用，只能降低风险、缩小影响：
- 缩短 Access Token 的有效期
- Refresh Token 轮换：每次刷新都签发新的 Refresh Token，旧的作废；如果发现旧的又被使用，说明可能被盗，把这次登录派生出的令牌全部作废
- 维护黑名单：把要作废的令牌 ID（`jti`）存进 Redis，过期时间设为令牌的剩余有效期
- 绑定设备 ID 等特征，不匹配时要求重新登录
- 全程使用 HTTPS，防止令牌在传输中被窃取
:::

::: details 怎么实现"踢人下线"？
- Session：直接删除服务端的会话
- JWT：需要引入少量服务端状态。比如给每个用户存一个令牌版本号，签发时写进 Payload，校验时比对；踢人或改密码时把版本号加 1，旧令牌就全部失效。也可以用黑名单。同时作废对应的 Refresh Token，让对方无法续期

如果要求同一账号只能在一处登录，就在登录时记录当前有效的会话或令牌 ID，新登录覆盖旧的，旧令牌校验时就会失败。
:::

::: details 单点登录（SSO）大致怎么实现？
核心是一个独立的认证中心：
1. 用户访问系统 A，未登录，被重定向到认证中心
2. 用户在认证中心登录，认证中心在自己的域名下记住登录态
3. 认证中心带着一次性的授权码重定向回 A，A 的后端用授权码向认证中心换取用户信息，建立 A 自己的会话
4. 用户再访问系统 B，同样被重定向到认证中心；认证中心发现已经登录，直接带着授权码跳回 B，用户无感知

现在常用 OIDC 实现，流程和 [OAuth 2.0 授权码流程](/basics/network/14-oauth2)一致。如果所有系统都在同一个主域名下，也可以把 Cookie 设置在主域名上（如 `Domain=example.com`），各系统共享会话存储。
:::

## 易错点

- JWT 的 Payload 只是 Base64URL 编码，不是加密，不能放敏感信息
- Cookie 和 Token 不是对立的：Cookie 是载体，Token 也可以放在 Cookie 里。"用 Token 就没有 CSRF"的前提是令牌不放在 Cookie 里，而是由前端手动加到请求头上
- HttpOnly 只能防止令牌被脚本读走，防不了 XSS 脚本直接在页面里发请求
