---
difficulty: 2
tags: [场景题, 安全]
---

# 扫码登录是怎么实现的？有哪些安全风险？

::: tip 一句话回答
PC 端向服务端申请一个**一次性 ticket**，编进二维码展示；服务端为 ticket 维护**状态机**：待扫描 → 已扫描 → 已确认 / 已过期。PC 端通过轮询或长连接查询状态；手机 App 用**已登录的身份**扫码并确认，服务端在确认后为 PC 签发自己的登录凭证。主要风险是二维码被转发给受害者扫（钓鱼）、ticket 被重放，以及确认页信息不足让用户糊里糊涂点了确认。
:::

## 详细解析

### 整体流程

```text
PC 浏览器                     服务端                       手机 App（已登录）
   │── 1. 申请 ticket ──────────>│ 生成随机 ticket，状态 pending，TTL 约两分钟
   │<─ 返回 ticket，渲染二维码 ───│
   │── 2. 轮询 / 长连接查状态 ───>│
   │                              │<── 3. 扫码，带 App 的登录态上报 ticket ──│
   │<─ 状态 scanned（显示头像）──│     状态 → scanned，记录扫码用户
   │                              │──── 返回 PC 的设备、IP 地点 ──────────>│ 展示确认页
   │                              │<── 4. 用户点击"确认登录" ───────────────│
   │<─ 状态 confirmed + PC token ─│     状态 → confirmed，签发 PC 端凭证，删除 ticket
```

几个关键点：

- 二维码里只放 ticket（或带 ticket 的 URL），**不放任何用户信息**
- ticket 用足够长的安全随机数生成，不可猜测
- 手机端的身份来自 App 本身的登录态，扫码只是把"这个 ticket"和"这个用户"关联起来
- PC 端拿到的是**新签发的凭证**，不是手机端 token 的拷贝，两端可以分别管理和吊销。凭证形式（Session 还是 JWT）参见 [登录鉴权方案](/basics/network/13-auth)

### 状态怎么推给 PC

- **短轮询**：每隔一两秒请求一次，最简单，二维码页面通常停留不久，成本可以接受
- **长轮询**：请求挂在服务端，状态变化或超时才返回，延迟更低
- **WebSocket / SSE**：适合本来就有长连接的产品，见 [WebSocket](/basics/network/15-websocket)

ticket 状态一般放 Redis，设置过期时间，状态变更用原子操作，避免并发确认。

### 服务端状态机

```js
const NEXT = { pending: 'scanned', scanned: 'confirmed' } // 只能按固定方向前进

function transit(id, to, userId) {
  const t = tickets.get(id)
  if (!t || Date.now() > t.expiresAt) return { ok: false, reason: 'expired' }
  if (NEXT[t.status] !== to) return { ok: false, reason: 'bad_state' }
  if (to === 'scanned') t.userId = userId
  // 确认的人必须是扫码的人
  if (to === 'confirmed' && t.userId !== userId) return { ok: false, reason: 'user_mismatch' }
  t.status = to
  return { ok: true, pcInfo: t.pcInfo }
}

// PC 端查询：确认后签发凭证并立即删除 ticket，保证只能兑换一次
function poll(id) {
  const t = tickets.get(id)
  if (!t || Date.now() > t.expiresAt) return { status: 'expired' }
  if (t.status !== 'confirmed') return { status: t.status }
  tickets.delete(id)
  return { status: 'confirmed', token: issueToken(t.userId) }
}
```

### 风险和防御

| 风险 | 说明 | 防御 |
| --- | --- | --- |
| 二维码钓鱼 | 攻击者在自己电脑上生成二维码，伪装成"领奖""验证身份"发给受害者扫，受害者确认后攻击者的 PC 就登进了受害者账号 | 确认页醒目展示登录设备、IP 归属地、时间；异地或新设备额外提醒；ticket 有效期短 |
| ticket 重放 | 同一个 ticket 被多次兑换出凭证 | 兑换后立即删除，状态变更原子化 |
| ticket 被猜到 | 可预测的 ID 让人抢先绑定 | 安全随机数，长度足够 |
| 查询接口被盗用 | 别人拿着 ticket 也来轮询，抢走凭证 | ticket 和申请它的 PC 会话绑定（比如同时校验一个只存在 PC Cookie 里的值） |
| 误确认 | 扫完直接登录，用户来不及判断 | 必须有显式的确认步骤，不能扫码即登录 |

二维码钓鱼是扫码登录最主要的风险，因为整个流程从技术上看完全合法。能做的就是让用户在确认那一步看清楚"你正在让哪台设备登录"。

## 面试官可能追问

::: details 和小程序登录、OAuth 扫码授权有什么区别？
扫码登录是同一个产品的两个端之间传递登录态，由 App 担保 PC。[小程序登录](/basics/cross-platform/03-miniprogram-login) 是用平台的 code 换取平台身份，再换成自家登录态。用微信扫码登录第三方网站本质上是 OAuth 授权，见 [OAuth 2.0](/basics/network/14-oauth2)。
:::

::: details 二维码过期了怎么处理？
服务端 ticket 到期后返回 expired，PC 页面显示"二维码已失效，点击刷新"，重新申请新 ticket。页面不可见时（切走标签页）可以暂停轮询，回来时直接刷新，减少无效请求。
:::

::: details 怎么让 PC 端知道是谁扫了码？
扫码成功、状态变为 scanned 时，服务端可以把扫码用户的头像和脱敏昵称返回给 PC，提示"请在手机上确认"。这只用于展示，不能作为登录依据，确认之前 PC 端不应拿到任何凭证。
:::

## 易错点

- 二维码里直接放用户 token 或长期有效的 ID，截图即可复用
- 确认后不删除 ticket，同一个 ticket 能多次换出凭证
- 只有扫码没有确认，扫一下就登录，二维码钓鱼的成功率大大提高
- 把手机端的 token 原样下发给 PC，两端无法分别吊销，PC 被盗会连累手机
