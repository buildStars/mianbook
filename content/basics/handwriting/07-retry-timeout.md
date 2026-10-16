---
difficulty: 2
tags: [手写题, 场景题, 实践]
---

# 怎么给请求加上超时和失败重试？

::: tip 一句话回答
超时不要只用 `Promise.race`，它只是"不等了"，原请求还在跑；应该用 **AbortController**（或 `AbortSignal.timeout`）把请求真正中止。重试用**指数退避加随机抖动**，等待时间逐次翻倍并随机打散，避免大量客户端同时重试；只重试网络错误、超时、5xx 和 429（429 按 `Retry-After` 等待），其他 4xx 不重试。下单这类非幂等请求，要带上**幂等键**才能放心重试。
:::

## 详细解析

### 超时：Promise.race 不会取消请求

`Promise.race([fetch(url), 定时 reject 的 Promise])` 到时间后确实会返回，但 Promise 本身没有取消能力，fetch 仍在进行，连接被占着，服务端也照样把活干完。要用 signal 真正中止：

```js
async function fetchWithTimeout(url, { timeout = 5000, signal, ...init } = {}) {
  const timeoutSignal = AbortSignal.timeout(timeout)
  const finalSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  const res = await fetch(url, { ...init, signal: finalSignal })
  // fetch 遇到 404、500 不会 reject，要自己检查状态码
  if (!res.ok) throw httpError(res.status, res.headers.get('Retry-After'))
  return res
}
```

- `AbortSignal.timeout(ms)` 到时自动中止，fetch 以名为 `TimeoutError` 的 DOMException 失败；`controller.abort()` 得到的是 `AbortError`，据此区分超时和用户取消
- `AbortSignal.any([...])` 合并多个信号（这里是超时和调用方传入的取消信号），任意一个中止就中止；signal 对读取响应体（`res.json()`）同样有效。老环境可以用 `AbortController` 加 `setTimeout` 调用 `abort()`，请求结束后 `clearTimeout`；这时超时和用户取消得到的都是 `AbortError`，要自己记一个标记来区分

### 哪些错误该重试

| 情况 | 是否重试 | 原因 |
| --- | --- | --- |
| 网络错误（fetch 抛 TypeError）、超时、408 | 重试 | 多是临时性的网络抖动 |
| 5xx，尤其是 502、503、504 | 重试 | 服务端临时故障或过载 |
| 429 Too Many Requests | 重试，按 `Retry-After` 等待 | 被限流了；这个头可能是秒数，也可能是 HTTP 日期，跨域时服务端要用 `Access-Control-Expose-Headers` 暴露它，前端才读得到 |
| 其他 4xx，如 400、401、403、404 | 不重试 | 请求本身有问题，重试结果一样 |
| 用户主动取消（AbortError） | 不重试 | 用户已经不需要这个结果 |

### 指数退避和随机抖动

等待时间按 `baseDelay * 2^n` 增长（300、600、1200ms……）并设上限，给服务端恢复的时间。只翻倍还不够：一次故障会让大量客户端同时失败，等待时间又完全一样的话，它们会在同一时刻一起重试，形成一波波的流量尖峰。在 0 到当前上限之间随机取值（全量抖动），能把重试打散。服务端那一侧还要有限流和熔断兜底，见 [熔断、降级、限流](/basics/distributed/09-circuit-breaker)。

## 代码示例：withRetry

```js
const httpError = (status, retryAfter = null) => Object.assign(new Error(`HTTP ${status}`), { name: 'HttpError', status, retryAfter })

function isRetryable(err) {
  if (err.name === 'AbortError') return false // 用户取消
  if (err.name === 'TimeoutError') return true
  if (err.name === 'HttpError') return err.status >= 500 || err.status === 429 || err.status === 408
  return err instanceof TypeError // fetch 的网络错误是 TypeError
}

// Retry-After 可能是秒数，也可能是 HTTP 日期
function parseRetryAfter(value) {
  if (value == null) return null
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : Math.max(0, time - Date.now())
}

// 可以被 signal 打断的等待
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true })
  })
}

async function withRetry(fn, options = {}) {
  const { retries = 3, baseDelay = 300, maxDelay = 10_000, shouldRetry = isRetryable, signal, onRetry } = options
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn({ attempt, signal })
    } catch (err) {
      if (attempt >= retries || signal?.aborted || !shouldRetry(err)) throw err // 整体已取消就不再重试
      const backoff = Math.random() * Math.min(maxDelay, baseDelay * 2 ** attempt) // 全量抖动
      const delay = parseRetryAfter(err.retryAfter) ?? backoff
      if (delay > maxDelay) throw err // 服务端要求等太久，不如直接报错
      onRetry?.(err, attempt + 1, delay)
      await sleep(delay, signal)
    }
  }
}
```

用模拟接口测试（在 ESM 或浏览器控制台里运行，等待时间是随机的）：

```js
// 按顺序返回预设的结果，遇到 Error 就抛出
const mockApi = (results, i = 0) => async () => {
  const r = results[i++]
  if (r instanceof Error) throw r
  return r
}
const onRetry = (err, n, delay) => console.log(`第 ${n} 次重试：${err.message}，等待 ${Math.round(delay)}ms`)

console.log(await withRetry(mockApi([httpError(503), new TypeError('fetch failed'), 'ok']), { baseDelay: 50, onRetry }))
// 第 1 次重试：HTTP 503，等待 0～50ms
// 第 2 次重试：fetch failed，等待 0～100ms
// ok
await withRetry(mockApi([httpError(404), 'ok'])).catch((err) => console.log('不重试：', err.message))
// 不重试： HTTP 404
console.log(await withRetry(mockApi([httpError(429, '1'), 'ok']), { onRetry }))
// 第 1 次重试：HTTP 429，等待 1000ms
// ok
```

和超时组合时，每次尝试单独计时，整个过程再加一个总时限。总时限到了 `signal.aborted` 为 true，就不会再重试：

```js
const controller = new AbortController() // 用户点"取消"时调用 controller.abort()
const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
const res = await withRetry(() => fetchWithTimeout('/api/list', { timeout: 3000, signal }), { signal })
```

## 面试官可能追问

::: details 下单、支付这类请求能重试吗？
不能直接重试。超时不代表失败，服务端可能已经下单成功，只是响应没回来，重试就会重复下单。做法是在**第一次请求前**生成一个幂等键（如 `crypto.randomUUID()`），每次重试都带上同一个值，常见约定是放在 `Idempotency-Key` 请求头里（IETF 有过这个头的草案，但还不是正式标准，具体写法以服务端的接口约定为准）；服务端按这个键去重，重复的请求直接返回第一次的结果。服务端的去重思路见 [怎么实现幂等](/basics/distributed/06-mq-idempotent)。
:::

::: details 怎么和 axios 这类请求库结合？
放在响应拦截器里：出错时判断是否可重试，把已重试次数记在请求的 config 上，等待后用同一个 config 重新发起请求，次数用完再 reject。也有现成的重试插件，ky 这类库直接内置了 retry 和 timeout 选项。业务代码因此不用关心重试，但要允许单个接口关掉重试，比如非幂等的写接口。
:::

::: details 超时时间设多少合适？
按接口的实际耗时定，参考监控里的 P99 再留些余量，不要全站一个值；上传、导出这类长任务单独设置。还要算上重试：单次 3 秒、最多重试 3 次，用户最坏要等十几秒，所以要有总时限，并配合加载状态和取消按钮。
:::

## 易错点

- `Promise.race` 实现的超时不会中止请求，只是不再等待结果
- fetch 只在网络错误时 reject，HTTP 404、500 也会正常 resolve，要检查 `res.ok`
- 等待时间不加随机抖动，大量客户端会同步重试；重试 POST 前要确认接口幂等
