---
difficulty: 2
tags: [安全, 实践]
---

# Node.js 里怎么实现 JWT 登录？签发、校验、续期和注销分别怎么做？

::: tip 一句话回答
用 jose 这类库**签发**带 `exp`、`iss`、`aud`、`jti` 的令牌；**校验**时固定允许的算法，并校验签发方、受众和过期时间。JWT 签发后在过期前没法单独作废，所以要配合**短期 access token + 存在服务端、可撤销、每次刷新都轮换的 refresh token**，旧 refresh token 被重复使用时作废整条令牌链。需要立即失效时再加按 `jti` 的黑名单或用户版本号。多个服务验证时用私钥签发、公钥验证，公钥按 `kid` 发布，方便换密钥。
:::

## 详细解析

### 先确定要不要用 JWT

Session 和 JWT 的概念对比、双令牌的思路见 [Cookie、Session、Token、JWT 的区别](/basics/network/13-auth)。简单说：单体应用、需要随时踢人的后台，用 Cookie 加 Redis 存会话更简单（多实例共享会话见 [分布式 Session](/basics/distributed/16-distributed-session)）；网关或多个服务都要独立验证身份时，JWT 才体现价值。下面讲确定用 JWT 之后，在 Node.js 里怎么写对。

### JWT 的结构

JWT 是 `header.payload.signature` 三段 base64url 字符串。payload 里常用的注册声明：

| 声明 | 含义 |
| --- | --- |
| `iss` / `aud` / `sub` | 签发方、受众、主体（通常是用户 ID） |
| `exp` | 过期时间，到点及之后不能再接受 |
| `iat` | 签发时间 |
| `nbf` | 生效时间，之前不能接受 |
| `jti` | 令牌唯一 ID，可用于黑名单和防重放 |

payload 只是编码不是加密，谁都能解开看，不要放敏感信息。

### 签名算法

- **HS256**：签发和验证用同一个共享密钥，适合单个服务自签自验
- **RS256 / ES256**：私钥签发，公钥验证。认证中心持有私钥，其他服务只拿公钥（常通过 JWKS 地址发布），验证方泄露也没法伪造
- 验证时要**固定允许的算法**，不要让令牌头里的 `alg` 决定用什么算法验证，同时校验 `iss`、`aud`、`exp`
- **密钥管理**：HS256 的密钥用足够长的随机值，放环境变量或密钥管理服务；用公私钥时在令牌头里写 `kid`，认证中心通过 JWKS 发布公钥集合，验证方用 jose 的 `createRemoteJWKSet` 按 `kid` 取公钥。换密钥时新旧公钥并存一段时间，等旧令牌都过期再下掉旧公钥

### 注销和续期

- **access token** 有效期短（比如 15 分钟），被盗的影响窗口小，服务端只验签不查库
- **refresh token** 有效期长，存在服务端（数据库或 Redis），注销时删掉它，access token 最多再活十几分钟
- **轮换**：每次刷新都作废旧的 refresh token、发一个新的，同一条链上的令牌记成一个"家族"
- **重复使用检测**：已经用过的旧 refresh token 又被拿来刷新，说明它可能被盗，直接作废整个家族，用户要重新登录
- **立即失效**：改密码、封号这类场景，把 access token 的 jti 加进 Redis 黑名单（过期时间设成令牌剩余有效期），或者给用户记一个 `tokenVersion`，令牌里的版本小于当前值就拒绝。这两种做法都要查存储，等于部分放弃了无状态

令牌在浏览器里放哪见 [Token 存在哪里更安全](/basics/web-security/04-token-storage)。

## 代码示例

用 jose 签发和校验：

```js
import { SignJWT, jwtVerify, errors } from 'jose'

const secret = new TextEncoder().encode(process.env.JWT_SECRET)
const verifyOptions = { issuer: 'auth.example.com', audience: 'api', algorithms: ['HS256'] }

export function signAccessToken(userId) {
  return new SignJWT({ role: 'user' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setIssuer('auth.example.com')
    .setAudience('api')
    .setExpirationTime('15m')
    .sign(secret)
}

export async function verifyAccessToken(token) {
  try {
    const { payload } = await jwtVerify(token, secret, verifyOptions)
    return payload
  } catch (err) {
    // 过期：JWTExpired，code 是 ERR_JWT_EXPIRED，前端据此去刷新
    if (err instanceof errors.JWTExpired) throw new Error('TOKEN_EXPIRED')
    // 签名不对：ERR_JWS_SIGNATURE_VERIFICATION_FAILED；aud 等不符：ERR_JWT_CLAIM_VALIDATION_FAILED
    throw new Error('TOKEN_INVALID')
  }
}
```

refresh token 的轮换和重复使用检测（示意，存储换成 Redis 或数据库）：

```js
import { randomBytes } from 'node:crypto'

const store = new Map() // token -> { family, userId, used }
const revokedFamilies = new Set()

export function issueRefresh(userId, family = randomBytes(8).toString('hex')) {
  const token = randomBytes(32).toString('base64url')
  store.set(token, { family, userId, used: false })
  return token
}

export function rotate(oldToken) {
  const rec = store.get(oldToken)
  if (!rec || revokedFamilies.has(rec.family)) throw new Error('invalid')
  if (rec.used) {
    revokedFamilies.add(rec.family) // 旧令牌被再次使用，整条链作废
    throw new Error('reuse detected')
  }
  rec.used = true
  return issueRefresh(rec.userId, rec.family)
}
```

## 面试官可能追问

::: details 既然 JWT 也要查黑名单，为什么不直接用 Session？
确实，如果每个请求都要查存储，JWT 的无状态优势就没了。单体应用、需要随时踢人的后台系统，用 Session 更简单。JWT 的价值在于跨服务、跨域：网关或各个微服务拿公钥就能验证，不用都去访问同一个会话存储。黑名单只在少数需要立即失效的场景用，量很小。
:::

::: details 用户正常使用时，旧 refresh token 被"重复使用"会误伤吗？
会。比如两个标签页同时刷新，第二个拿着刚被轮换掉的旧令牌，就会被判成重复使用。常见做法是给旧令牌留几秒宽限期，宽限期内重复使用返回同一个新令牌；或者前端用 BroadcastChannel 让多个标签页只刷新一次。
:::

::: details refresh token 一定要是 JWT 吗？
不必。它只由认证服务自己校验，又要存服务端可撤销，用一个足够长的随机字符串作为 key 去查存储就够了，比 JWT 更简单。
:::

## 易错点

- 以为删掉前端存的 JWT 就算注销了，令牌本身在过期前仍然有效
- payload 里放手机号、权限明细这类敏感信息，它只是 base64url 编码
- 验证时不限定算法、不校验 `aud` 和 `iss`，别的系统签发的令牌也能通过
- access token 有效期设成几天，等于放弃了"短期令牌降低风险"的设计
