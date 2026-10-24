---
difficulty: 2
tags: [实践, 原理]
---

# Node.js 里怎么取消一个异步操作？AbortController 能用在哪些地方？

::: tip 一句话回答
用 **AbortController**：controller 负责发信号（`abort(reason)`），它的 `signal` 传给任何支持取消的 API，API 收到 abort 事件后自己停止并抛错。Node 里 `fetch`、`timers/promises`、`events.once`、`fs.readFile`、`child_process`、`stream.pipeline` 等都接受 `signal`。`AbortSignal.timeout()` 做超时，`AbortSignal.any()` 组合"超时或用户取消"。注意**不同 API 超时抛的错误名不一样**，判断原因最稳的是看 `signal.reason`。
:::

## 详细解析

### 模型

```text
AbortController ──abort(reason)──> signal.aborted = true
                                    signal.reason = reason
                                    触发 'abort' 事件（只触发一次）
                                         │
              ┌──────────────┬───────────┴─────────┐
            fetch      timers/promises      你自己的函数
           中止请求      拒绝 Promise         清理资源并 reject
```

controller 和 signal 是分开的：发起方拿着 controller 决定什么时候取消，执行方只拿到 signal，只能"听"不能"发"。一个 signal 可以同时传给多个操作，一次 `abort()` 全部取消。

### Node 里接受 signal 的 API

| 类别 | API |
| --- | --- |
| 网络 | `fetch(url, { signal })`、`http.request({ signal })` |
| 定时器 | `timers/promises` 的 `setTimeout`、`setImmediate`、`setInterval` |
| 事件 | `events.once(emitter, name, { signal })`、`events.on(...)` |
| 文件 | `fs.readFile`、`fs.writeFile`（尽力而为，可能已写入一部分）、`fs.watch` |
| 子进程 | `spawn`、`exec`、`execFile`、`fork`，效果类似 `kill()` |
| 流 | `stream/promises` 的 `pipeline(..., { signal })`、`stream.addAbortSignal` |
| 其他 | `readline.createInterface({ signal })` |

`fs.readFile` 的取消只停止内部的分块读取，不会中断已经发给操作系统的单次请求。取消一般都是"尽力而为"，不保证副作用没发生。

### 几个 API

- `AbortSignal.timeout(ms)`：返回一个 ms 毫秒后自动中止的 signal，reason 是 `TimeoutError`
- `AbortSignal.any([a, b])`：任意一个中止就中止，reason 取自先触发的那个
- `signal.reason`：中止原因，`abort()` 不传参数时默认是 `AbortError` 的 DOMException
- `signal.throwIfAborted()`：已经中止就抛出 `signal.reason`，适合在长循环里或函数开头检查

### 错误名不统一

本机实测（以所用版本为准）：

| 场景 | 抛出的错误 |
| --- | --- |
| `fetch` + `AbortSignal.timeout` | `name` 为 `TimeoutError`（DOMException） |
| `fetch` + 手动 `abort()` | `name` 为 `AbortError` |
| `timers/promises` + `AbortSignal.timeout` | `name` 为 `AbortError`，`cause.name` 为 `TimeoutError` |
| `events.once` 被取消 | `name` 为 `AbortError` |

Web 标准的 API 直接抛 `signal.reason`，Node 专有 API 统一包成 `AbortError`（`code` 为 `ABORT_ERR`），把原因放进 `cause`。所以只写 `err.name === 'AbortError'` 会漏掉 fetch 的超时。要区分"超时"还是"被取消"，直接看 `signal.reason`，或者同时检查 `err.name` 和 `err.cause?.name`。

### 典型场景：客户端断开后取消下游

用户关掉页面，服务端还在查数据库、调下游，白白占用资源。在请求入口建一个 controller，响应还没写完连接就关闭了，说明客户端走了，调用 `abort()`，把 signal 一路传给下游调用和支持取消的数据库驱动。MCP 协议层的取消通知是另一回事，见 [MCP 的进度和取消](/ai/tools/19-mcp-progress-cancel)。

## 代码示例

```js
import http from 'node:http'

// 自己写的异步函数支持 signal
function delay(ms, { signal } = {}) {
  signal?.throwIfAborted() // 已经取消了就直接抛
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer) // 清理自己占用的资源
      reject(signal.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// "用户取消或超时"组合
const user = new AbortController()
const signal = AbortSignal.any([user.signal, AbortSignal.timeout(5000)])
setTimeout(() => user.abort(new Error('用户取消')), 20)
try {
  await delay(1000, { signal })
} catch (err) {
  console.log(err.message, signal.reason === err) // 用户取消 true
}

// 客户端断开时取消下游调用
http.createServer(async (req, res) => {
  const ac = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) ac.abort() // 没写完响应就断了，说明客户端走了
  })
  try {
    await delay(1000, { signal: AbortSignal.any([ac.signal, AbortSignal.timeout(3000)]) })
    res.end('done')
  } catch (err) {
    console.log('下游已取消:', err.name) // AbortError
  }
}).listen(3002)
```

## 面试官可能追问

::: details 取消了 Promise，底层的操作就停了吗？
不一定。Promise 本身没有取消语义，`abort` 只是通知，真正停不停取决于 API 有没有响应 signal。自己封装时，abort 回调里要真的清理：清定时器、销毁请求、关闭游标。只 reject 不清理，就只是"不等结果了"，底层还在跑。
:::

::: details 为什么监听 abort 要加 once，用完还要移除？
同一个 signal 可能被很多操作复用，比如整个请求生命周期共用一个。每次调用都加监听器又不移除，监听器会越积越多，闭包里的资源也释放不掉。`{ once: true }` 保证触发后自动移除，正常完成时手动 `removeEventListener`。
:::

::: details AbortSignal.timeout 和 setTimeout 加 abort() 有什么区别？
效果相近，但 `AbortSignal.timeout` 不用自己管理定时器，reason 自动是 `TimeoutError`，方便和手动取消区分。自己写 `setTimeout(() => ac.abort(), ms)` 时，操作提前完成后要记得 `clearTimeout`，否则定时器会让进程多等一段时间才退出。
:::

## 易错点

- 只判断 `err.name === 'AbortError'`，漏掉 fetch 超时抛的 `TimeoutError`
- 在已经中止的 signal 上注册监听器，abort 事件不会再触发，函数一直挂着；开头要先 `throwIfAborted()`
- 以为取消能回滚副作用：`writeFile`、已发出的 POST 可能已经生效
- 用 signal 销毁长期存在的资源（如 `server.listen({ signal })`），官方已不推荐，资源清理用 `close()` 或 `await using`
