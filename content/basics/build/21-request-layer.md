---
difficulty: 2
tags: [实践, 高频]
---

# 前端项目的请求层怎么封装？拦截器、取消重复请求和无感刷新 Token 怎么做？

::: tip 一句话回答
请求层就是在业务和 HTTP 库之间加一层，**统一基础地址、超时、鉴权头、错误提示和日志**。以 axios 为例：请求拦截器加 Token，响应拦截器统一处理业务错误码；重复请求按"方法 + URL + 参数"生成 key，用 `AbortController` 取消旧的；Token 过期返回 401 时，用一个**共享的刷新 Promise** 保证只刷新一次，其他请求排队等它，成功后重放，失败统一跳登录。
:::

## 详细解析

### 为什么要封装

直接在页面里写 `axios.get` 或 `fetch`，每个地方都要处理 baseURL、超时、Token、错误弹窗。封装后业务只关心"调哪个接口、拿到什么数据"：

- 一个实例统一 `baseURL`、`timeout`（axios 的 timeout 默认是 0，即不超时，要自己设）
- 请求拦截器：加 `Authorization`、加请求 ID、打日志
- 响应拦截器：HTTP 状态码不在 2xx 时统一处理；后端约定的业务码（如 `code !== 0`）也在这里转成异常
- 对外导出 `get`、`post` 这类方法，返回类型带上泛型，业务拿到的直接是 `data`

### axios 拦截器的执行顺序

请求拦截器**后添加的先执行**，响应拦截器按添加顺序执行。依次添加请求拦截器 1、2、3，实际顺序是 3 → 2 → 1 → 发请求 → 响应 1 → 2 → 3。每个拦截器拿到上一个的返回值，所以请求拦截器必须 `return config`。`use()` 返回一个 id，可以用 `eject(id)` 移除。

### 取消重复请求

- 取消用 `AbortController`：配置里传 `signal`，调 `controller.abort()` 取消。被取消的请求以 `CanceledError` reject，错误码 `ERR_CANCELED`，用 `axios.isCancel(err)` 判断后静默忽略
- 老的 `CancelToken` 已经弃用，新代码不要再用
- 重复的判断：`method + url + 序列化后的 params/data` 生成 key，放进一个 Map。有两种策略：搜索这类"以最新为准"的，**取消旧请求**；字典、配置这类"结果都一样"的，**复用同一个 Promise**
- 页面切换时，把当前页面登记的 controller 全部 abort，避免旧页面的响应回来后改状态

### 无感刷新 Token

关键是"只刷新一次"：第一个遇到 401 的请求发起刷新，把这个 Promise 存在模块变量里；后来的请求看到已经有刷新在进行，就 `await` 同一个 Promise，等它完成后用新 Token 重放自己。

1. 请求返回 401，且这个请求没重试过
2. 没有进行中的刷新就发起一次，有就等待已有的
3. 刷新成功：用新 Token 重放原请求
4. 刷新失败：所有等待的请求一起失败，**只跳一次**登录页
5. 刷新接口本身返回 401 不能再触发刷新，否则会死循环

## 代码示例

下面是不依赖具体 HTTP 库的核心逻辑，axios 的响应拦截器或 ofetch 的 `onResponseError` 里都可以套用。

```js
let accessToken = ''
let refreshing = null // 进行中的刷新，所有请求共享
let redirecting = false

function refreshToken() {
  if (!refreshing) {
    refreshing = fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('refresh failed')
        accessToken = (await res.json()).accessToken
      })
      .finally(() => { refreshing = null }) // 结束后清空，下次过期能再刷新
  }
  return refreshing
}

export async function request(url, init = {}, retried = false) {
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
  })
  if (res.status !== 401 || retried) return res
  try {
    await refreshToken() // 并发的 401 都在这里等同一个 Promise
  } catch (err) {
    if (!redirecting) {
      redirecting = true
      location.href = '/login'
    }
    throw err
  }
  return request(url, init, true) // 用新 Token 重放，只重放一次
}
```

用本地 http 服务模拟 5 个并发请求同时拿到 401：刷新接口只被调用 1 次，5 个请求都在刷新后成功返回；让刷新接口返回 401 时，5 个请求都失败，跳登录只执行 1 次。

### Nuxt 里的写法

Nuxt 的 `$fetch` 是 ofetch 的实例，实例上也有 `create` 方法，可以 `$fetch.create({ baseURL, onRequest, onResponseError })` 派生出项目自己的请求函数（Nuxt 文档没有专门介绍 `$fetch.create`，这是 ofetch 实例自带的方法，ofetch 文档里的写法是 `ofetch.create`）。钩子名是 `onRequest`、`onRequestError`、`onResponse`、`onResponseError`。服务端渲染时 Cookie 怎么转发见 [SSR 应用里怎么处理登录态](/basics/ssr/10-ssr-auth)，页面级的登录拦截见 [Nuxt 的路由中间件](/basics/nuxt/09-middleware)，这里只管请求本身。

## 面试官可能追问

::: details 失败重试应该放在请求层吗？
可以放，但只对**幂等请求**（GET、PUT、DELETE 等）和网络错误、5xx、429 这类可恢复的错误重试，并配合指数退避加随机抖动，详见 [超时和失败重试](/basics/handwriting/07-retry-timeout)。POST 下单这类请求重试可能重复提交。ofetch 默认对 GET 重试 1 次，POST、PUT、PATCH、DELETE 默认不重试。
:::

::: details 刷新期间又有新请求发出来怎么办？
新请求还会带着旧 Token 发出去，拿到 401 后同样进入 `refreshToken()`，此时 `refreshing` 不为空，直接等待同一个 Promise。也可以在发请求前检查 `refreshing`，有刷新在进行就先 `await` 它再发，少一次无效请求。
:::

::: details 能不能在请求前判断 Token 快过期了就提前刷新？
可以，前端解出 access token 的 exp，剩余时间少于一定阈值就先刷新。前提是令牌是自家后端签发的 JWT，而且只用来决定刷新时机；如果对接的是第三方授权服务，access token 应当当作不透明的字符串，用登录接口返回的过期时间（如 expires_in）来算。但不能只靠它：客户端时钟可能不准，服务端也可能提前作废 Token，所以 401 兜底的逻辑仍然要有。
:::

## 易错点

- axios 的请求拦截器是倒序执行的，依赖顺序的逻辑（比如先加签名再加时间戳）要注意添加顺序
- 刷新失败后每个排队请求都去跳登录，会导致多次跳转或重复弹窗，要有"只跳一次"的标记
- 重放的请求没打标记，刷新后仍然 401 就会无限循环
- 被取消的请求进入了统一的错误弹窗，用户看到莫名其妙的"请求失败"
