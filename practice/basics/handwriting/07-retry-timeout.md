---
title: 手写失败重试 withRetry
---

## 要求

实现 `isRetryable(err)` 和 `withRetry(fn, options)`：一个异步操作失败时，按指数退避加随机抖动自动重试。运行环境不能联网，测试用假的异步函数代替请求。

HTTP 错误的格式和题目里一样：`{ name: 'HttpError', message: 'HTTP 503', status: 503, retryAfter: null }`，`retryAfter` 是服务端 Retry-After 头的值（字符串）或 `null`。

**`isRetryable(err)`**：这个错误值不值得重试，返回 `true` 或 `false`。

- `name` 是 `'AbortError'`（用户取消）：不重试
- `name` 是 `'TimeoutError'`（超时）：重试
- `name` 是 `'HttpError'`：`status` 是 5xx、429、408 时重试，其他状态码不重试
- 其他错误：是 `TypeError`（fetch 的网络错误）才重试

**`withRetry(fn, options)`**：返回 Promise。

- 调用 `fn({ attempt, signal })`，`attempt` 是第几次尝试（从 0 开始），`signal` 就是 `options.signal`；成功就返回它的结果
- `options` 都可以不传：`retries = 3`（最多重试几次，fn 最多调用 `retries + 1` 次）、`baseDelay = 300`、`maxDelay = 10000`（毫秒）、`shouldRetry = isRetryable`、`signal`、`onRetry`
- 失败时，这几种情况直接抛出这次的错误，不再重试：重试次数已经用完、`signal` 已经取消、`shouldRetry(err)` 返回 false
- 否则等待一段时间再重试，等待时间这样定：
  - 错误的 `retryAfter` 不是 `null` 时按它来：全是数字就是秒数（`'2'` 是 2000ms），否则是 HTTP 日期（等到那个时刻，已经过了就是 0）；解析不出来就当没有
  - 没有 `retryAfter` 时用全量抖动：在 0 到 `min(maxDelay, baseDelay × 2^attempt)` 之间用 `Math.random()` 随机取
  - 算出来的等待时间超过 `maxDelay`，就不等了，直接抛出这次的错误
- 开始等待前调用 `onRetry(err, 第几次重试, 等待的毫秒数)`，第几次重试从 1 开始
- 等待期间 `signal` 被取消，立刻以 `signal.reason` 失败

## 提示

- 用一个 `for (let attempt = 0; ; attempt++)` 循环，循环体里 `try { return await fn(...) } catch (err) { ... }`，catch 里决定是抛出还是等待后进入下一轮
- 先判断哪几种情况直接 `throw err`，再算等待时间；Retry-After 的结果和退避时间用 `??` 二选一，用 `||` 的话 `'0'` 算出的 0 会被当成没有
- Retry-After 是秒数时乘 1000；是日期时用 `Date.parse` 解析，再减去 `Date.now()`
- 能被取消的等待：`new Promise` 里 `setTimeout(resolve, ms)`，再监听 signal 的 `abort` 事件，触发时 `clearTimeout` 并 `reject(signal.reason)`

## 起始代码

```js
function isRetryable(err) {
  // 返回 true 表示这个错误值得重试
}

async function withRetry(fn, options = {}) {
  // 返回 fn 最终成功的结果
}
```

## 测试

```js
const httpError = (status, retryAfter = null) => Object.assign(new Error(`HTTP ${status}`), { name: 'HttpError', status, retryAfter })
// 假的接口：按顺序返回预设的结果，遇到 Error 就抛出；api.calls 记下每次调用的参数
const mockApi = (results) =>
  fn(async () => {
    const r = results.shift()
    if (r instanceof Error) throw r
    return r
  })

test('失败后重试，直到成功', async () => {
  const api = mockApi([httpError(503), new TypeError('fetch failed'), 'ok'])
  await expect(withRetry(api, { baseDelay: 10 })).resolves.toBe('ok')
  expect(api).toHaveBeenCalledTimes(3)
  expect(api.calls.map((args) => args[0] && args[0].attempt)).toEqual([0, 1, 2])
})

test('重试次数用完后抛出最后一次的错误', async () => {
  const api = mockApi([httpError(500), httpError(502), httpError(503), 'ok'])
  await expect(withRetry(api, { retries: 2, baseDelay: 10 })).rejects.toThrow('HTTP 503')
  expect(api).toHaveBeenCalledTimes(3)
})

test('isRetryable：只重试网络错误、超时、5xx、429 和 408', () => {
  expect(isRetryable(new TypeError('fetch failed'))).toBe(true)
  expect(isRetryable(new DOMException('超时了', 'TimeoutError'))).toBe(true)
  expect(isRetryable(httpError(500))).toBe(true)
  expect(isRetryable(httpError(503))).toBe(true)
  expect(isRetryable(httpError(429))).toBe(true)
  expect(isRetryable(httpError(408))).toBe(true)
  expect(isRetryable(httpError(400))).toBe(false)
  expect(isRetryable(httpError(404))).toBe(false)
  expect(isRetryable(new DOMException('用户取消', 'AbortError'))).toBe(false)
  expect(isRetryable(new Error('普通错误'))).toBe(false)
})

test('不该重试的错误直接抛出，只调用一次', async () => {
  const notFound = mockApi([httpError(404), 'ok'])
  await expect(withRetry(notFound, { baseDelay: 10 })).rejects.toThrow('HTTP 404')
  expect(notFound).toHaveBeenCalledTimes(1)
  // 传了 shouldRetry 就用它判断
  const custom = mockApi([httpError(503), 'ok'])
  await expect(withRetry(custom, { baseDelay: 10, shouldRetry: () => false })).rejects.toThrow('HTTP 503')
  expect(custom).toHaveBeenCalledTimes(1)
})

test('等待时间：指数退避加全量抖动，不超过 maxDelay', async () => {
  const random = Math.random
  Math.random = () => 0.5 // 固定随机数，等待时间就是上限的一半
  try {
    const failing = async () => {
      throw httpError(503)
    }
    const waits = []
    const onRetry = (err, n, ms) => waits.push([err.message, n, ms])
    await withRetry(failing, { baseDelay: 10, onRetry }).catch(() => {})
    expect(waits).toEqual([['HTTP 503', 1, 5], ['HTTP 503', 2, 10], ['HTTP 503', 3, 20]])
    waits.length = 0
    await withRetry(failing, { baseDelay: 10, maxDelay: 15, onRetry }).catch(() => {})
    expect(waits).toEqual([['HTTP 503', 1, 5], ['HTTP 503', 2, 7.5], ['HTTP 503', 3, 7.5]])
  } finally {
    Math.random = random
  }
})

test('有 Retry-After 时按它等待，要等太久就直接抛错', async () => {
  const waits = []
  const api = mockApi([httpError(429, '0'), 'ok'])
  await expect(withRetry(api, { baseDelay: 10, onRetry: (err, n, ms) => waits.push(ms) })).resolves.toBe('ok')
  expect(waits).toEqual([0])
  // 要等 1000ms，超过了 maxDelay
  const tooLong = mockApi([httpError(429, '1'), 'ok'])
  await expect(withRetry(tooLong, { baseDelay: 10, maxDelay: 100 })).rejects.toThrow('HTTP 429')
  expect(tooLong).toHaveBeenCalledTimes(1)
  // HTTP 日期：一分钟以后，超过了默认的 maxDelay
  const later = mockApi([httpError(503, new Date(Date.now() + 60000).toUTCString()), 'ok'])
  await expect(withRetry(later, { baseDelay: 10 })).rejects.toThrow('HTTP 503')
  expect(later).toHaveBeenCalledTimes(1)
})

test('signal 已经取消时不再重试，抛出这次的错误', async () => {
  const controller = new AbortController()
  controller.abort(new Error('已取消'))
  const api = mockApi([httpError(503), 'ok'])
  await expect(withRetry(api, { baseDelay: 10, signal: controller.signal })).rejects.toThrow('HTTP 503')
  expect(api).toHaveBeenCalledTimes(1)
  expect(api.calls[0][0] && api.calls[0][0].signal).toBe(controller.signal)
})

test('等待期间取消，立刻以取消的原因失败', async () => {
  const controller = new AbortController()
  const api = mockApi([httpError(503, '1'), 'ok']) // Retry-After 1 秒
  const start = Date.now()
  setTimeout(() => controller.abort(new Error('用户取消')), 30)
  await expect(withRetry(api, { signal: controller.signal })).rejects.toThrow('用户取消')
  expect(Date.now() - start).toBeLessThan(500)
  expect(api).toHaveBeenCalledTimes(1)
})
```

## 参考答案

```js
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
