---
difficulty: 2
tags: [高频, 场景题]
---

# 小程序的登录流程是怎样的？

::: tip 一句话回答
小程序端调用 **`wx.login`** 拿到一次性的临时 **code**，发给自己的服务端；服务端带上 appid、**appsecret** 和 code 调用微信的 **code2Session** 接口，换回用户的 **openid** 和 **session_key**（绑定了开放平台账号时还有 unionid）；服务端据此找到或创建用户，生成自己的登录态（如 token）返回给小程序，之后的请求都带上这个 token。**session_key 和 appsecret 只能留在服务端**，绝不能下发到前端。
:::

## 详细解析

### 时序

```text
小程序                         开发者服务端                               微信服务端
  |                                |                                            |
  |-- 1. wx.login() 拿到 code      |                                            |
  |-- 2. POST /api/login {code} -->|                                            |
  |                                |-- 3. code2Session(appid, secret, code) --->|
  |                                |<-- 4. openid, session_key, unionid --------|
  |                                |-- 5. 找到或创建用户，生成 token            |
  |                                |      保存 token -> userId、session_key     |
  |<-- 6. { token } ---------------|                                            |
  |-- 7. 业务请求 + token -------->|-- 8. 校验 token，识别用户                  |
```

### 每一步的要点

1. **`wx.login` 是静默的**：不会弹窗，用户无感知。code 是临时凭证，只能用一次
2. **code2Session 必须在服务端调用**：接口需要 appsecret，官方明确要求不能在小程序、网页或 App 里直接调。appsecret 泄露后，别人可以冒用你的身份调用微信接口
3. **session_key 不下发**：它是用户数据加解密和签名校验用的会话密钥，官方要求开发者服务器既不能把它下发到小程序，也不能对外提供。前端拿到它，就能伪造或解密本该由服务端校验的数据
4. **自定义登录态**：微信只负责告诉你"这是谁"（openid），登录态由业务自己管理。常见做法是生成随机 token 存进 Redis，或者签发 JWT，有效期和续期策略都由自己决定，取舍见 [Cookie、Session、Token、JWT 的区别](/basics/network/13-auth)

### openid、unionid 和手机号

- **openid**：用户在**这个小程序**里的唯一标识，同一个用户在不同小程序里的 openid 不同
- **unionid**：用户在同一个**微信开放平台账号**下的统一标识。公司有公众号、App、多个小程序时，靠它识别是同一个人。只有小程序绑定了开放平台账号，code2Session 才会返回 unionid
- **手机号**：必须由用户主动点击 `open-type="getPhoneNumber"` 的按钮并同意，事件里拿到一个**手机号专用的 code**（和 `wx.login` 的 code 不是一回事，有效期短、只能用一次），发给服务端，由服务端带上 access_token 调用微信的手机号接口换取。这个能力有资质要求，并且按调用收费

### 登录态过期

两种"过期"要分开：

- **业务 token 过期**：接口返回 401 时，前端静默重新走一遍 `wx.login` 拿新 token，再重试原请求
- **session_key 过期**：微信根据用户使用情况决定它何时失效，`wx.checkSession` 可以检查当前的 session_key 是否还有效。只有服务端需要用 session_key 解密数据时才需要关心它；再次调用 `wx.login` 可能会刷新 session_key，旧的随之失效，所以服务端每次登录都要用新值覆盖旧值

## 代码示例

服务端（Node.js 示意，`db`、`sessionStore` 是伪接口）：

```js
import crypto from 'node:crypto'

const { WX_APPID, WX_SECRET } = process.env // appsecret 只放在服务端

export async function loginByCode(code) {
  const qs = new URLSearchParams({ appid: WX_APPID, secret: WX_SECRET, js_code: code, grant_type: 'authorization_code' })
  const res = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${qs}`)
  const { openid, unionid, session_key, errcode, errmsg } = await res.json()
  if (errcode) throw new Error(`code2Session 失败：${errcode} ${errmsg}`)

  const user = await db.findOrCreateUser({ openid, unionid })
  const token = crypto.randomBytes(32).toString('hex')
  await sessionStore.set(token, { userId: user.id, sessionKey: session_key }, { ttl: 7 * 24 * 3600 })
  return { token } // ✅ 只返回自己的 token，session_key 留在服务端
}
```

小程序端：请求遇到 401 时重新登录并重试一次，多个请求同时过期也只登录一次。

```js
const BASE = 'https://api.example.com'
const wxLogin = () => new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject }))
const rawRequest = (opts) => new Promise((resolve, reject) => wx.request({ ...opts, success: resolve, fail: reject }))

let loginPromise = null
function login() {
  if (!loginPromise) {
    loginPromise = (async () => {
      const { code } = await wxLogin()
      const res = await rawRequest({ url: `${BASE}/api/login`, method: 'POST', data: { code } })
      wx.setStorageSync('token', res.data.token)
    })().finally(() => { loginPromise = null })
  }
  return loginPromise
}

export async function request(url, options = {}, retried = false) {
  const token = wx.getStorageSync('token')
  const res = await rawRequest({ url: BASE + url, ...options, header: { ...options.header, Authorization: `Bearer ${token}` } })
  if (res.statusCode === 401 && !retried) {
    await login()
    return request(url, options, true) // 只重试一次，避免死循环
  }
  return res.data
}
```

## 面试官可能追问

::: details 为什么不让前端直接拿 openid 当登录凭证？
openid 不是秘密，只是一个标识。如果服务端只认前端传来的 openid，任何人拿到别人的 openid 就能冒充对方。openid 必须由服务端用 code 向微信换取，换完之后由服务端发放自己的 token，前端只持有 token。
:::

::: details 每次打开小程序都要调用 wx.login 吗？
不需要。本地有 token 就直接用，接口返回 401 再重新登录。频繁调用 `wx.login` 还可能让服务端存的 session_key 失效。需要用 session_key 解密数据的场景，可以先用 `wx.checkSession` 判断它是否还有效，失效了再重新登录。
:::

::: details 同一个用户在小程序和 App 里怎么打通账号？
靠 unionid。把小程序和 App 都绑定到同一个微信开放平台账号，两边拿到的 unionid 相同，服务端用 unionid 关联到同一个用户。另一种常见做法是让用户绑定手机号，以手机号作为跨端的账号标识。
:::

## 易错点

- `wx.login` 的 code 只能用一次，重复提交同一个 code 去换 session 会失败；手机号的 code 是另一套凭证，不能混用
- session_key 不是登录态，不能拿来当 token 下发给前端，也不要用它的有效期来控制业务登录态
- 只有绑定了开放平台账号才会返回 unionid，不能默认它一定存在
