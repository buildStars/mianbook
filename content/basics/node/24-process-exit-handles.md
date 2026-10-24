---
difficulty: 2
tags: [场景题, 原理]
---

# Node.js 脚本执行完了却不退出，是什么原因？怎么排查？

::: tip 一句话回答
Node 进程在事件循环里**还有活跃的句柄**时不会退出：监听中的服务器、没关的 socket 和数据库连接池、`setInterval`、子进程、Worker、文件监听等。等待中的 Promise 本身**不会**让进程保持运行。排查用 `process.getActiveResourcesInfo()` 看还剩哪些资源；修复是把它们关掉，或对后台性质的句柄调用 `unref()`。不要靠 `process.exit()` 硬退。
:::

## 详细解析

### 进程什么时候退出

事件循环每一轮都会检查：还有没有处于 ref 状态的活跃句柄或待处理的请求。都没有了，触发 `beforeExit`，再没有新工作就触发 `exit`，进程结束。常见的"拦路虎"：

| 资源 | 怎么释放 |
| --- | --- |
| `server.listen()` 的服务器 | `server.close()`，或 `server.unref()` |
| 数据库、Redis 连接池，MQ 客户端 | 调用库提供的 `end()` / `close()` / `quit()` |
| `setInterval`、没触发的 `setTimeout` | `clearInterval` / `clearTimeout`，或 `timer.unref()` |
| 子进程、Worker | 等它结束、`kill()`，或 `unref()` |
| `fs.watch` | `watcher.close()`，或创建时传 `persistent: false` |
| `MessagePort`、`BroadcastChannel` | `close()` 或 `unref()` |

反过来，一个永远 pending 的 Promise 并不阻止退出。Promise 只是对象，没有句柄挂在事件循环上。CommonJS 里写 `new Promise(() => {})` 后面再没别的，进程直接退出，`then` 永远不会执行。ESM 的顶层 `await` 一个永不结束的 Promise 时，进程会打印 "unsettled top-level await" 警告，以**退出码 13** 退出。

### unref：不阻止退出的句柄

`unref()` 的意思是"这个句柄还在工作，但别因为它而不退出"。定时器、`net.Server`、`net.Socket`、子进程、Worker、MessagePort 都有这个方法。适合后台性质的任务：定时上报指标、心跳、缓存刷新。只剩这类句柄时进程正常退出；还有其他工作时它们照常运行。

### 排查

1. 在你认为"应该结束了"的地方打印 `process.getActiveResourcesInfo()`，它返回资源类型的数组，比如 `TCPServerWrap`（监听中的服务器）、`TCPSocketWrap`（socket）、`Timeout`（定时器）
2. 只告诉你类型，不告诉你是谁创建的。结合代码找对应的服务器、连接池、定时器
3. 测试框架的类似功能：Jest 的 `--detectOpenHandles` 会尝试指出没关闭的句柄，测试跑完不退出最常见的原因就是数据库连接池没在 `afterAll` 里关

### beforeExit、exit 和 process.exit()

- `beforeExit`：事件循环空了时触发，监听器里**可以**再安排异步工作，进程会继续运行。显式调用 `process.exit()` 或未捕获异常时不触发
- `exit`：进程马上要结束了，监听器里**只能**做同步操作，里面的 `setTimeout`、异步写文件都不会执行
- `process.exit()`：立即结束进程，还在排队的异步操作（包括写到 stdout 的管道输出）可能被丢掉。更推荐设置 `process.exitCode = 1`，把资源关干净让进程自然退出

服务进程收到信号时怎么优雅退出，见 [异常处理和优雅退出](/basics/node/07-error-handling)。

## 代码示例

复现：脚本逻辑跑完了，但进程挂着不退。

```js
import http from 'node:http'

const server = http.createServer((req, res) => res.end('ok')).listen(3003)
const timer = setInterval(() => {}, 60_000) // 比如定时上报指标

const res = await fetch('http://localhost:3003/')
console.log(await res.text())
console.log(process.getActiveResourcesInfo())
// 输出里有 'TCPServerWrap'、'TCPSocketWrap'、'Timeout' 等，进程不会退出
```

修复：关闭服务器，后台定时器 `unref()`，出错时设置退出码而不是 `process.exit()`。

```js
import http from 'node:http'

const server = http.createServer((req, res) => res.end('ok')).listen(3003)
const timer = setInterval(() => {}, 60_000)
timer.unref() // ✅ 后台定时器不阻止退出

try {
  const res = await fetch('http://localhost:3003/')
  console.log(await res.text())
} catch (err) {
  console.error(err)
  process.exitCode = 1 // ✅ 设置退出码，让进程自然结束
} finally {
  server.close() // ✅ 停止监听
  server.closeIdleConnections()
}
```

## 面试官可能追问

::: details 为什么不直接在最后写 process.exit()？
它能让进程退出，但掩盖了问题：没关的连接池可能有没提交的事务、日志可能还没写完。`process.exit()` 不等异步操作，管道里的输出会被截断。把资源关干净、设置 `exitCode` 自然退出，行为可预期，也能暴露真正没关的资源。
:::

::: details 一个 HTTP 服务进程为什么不会自己退出？
因为监听中的服务器是 ref 状态的句柄，只要它在 listen，事件循环就一直有活。这正是我们想要的。想在测试或脚本里退出，就调用 `server.close()`，它会等已有连接结束后真正关闭。
:::

::: details 进程卡在一个永远不 resolve 的 Promise 上，会发生什么？
看还有没有别的句柄。如果没有，CommonJS 下进程直接正常退出，后面的代码不执行，很容易误以为"执行完了"；ESM 顶层 await 的情况下会以退出码 13 退出并打印警告。如果还有句柄，进程挂着不退，Promise 也永远不会有结果。
:::

## 易错点

- 以为是"有 Promise 没完成"导致不退出，实际是某个句柄没关
- 在 `exit` 事件里写异步清理逻辑，根本不会执行
- 用 `process.exit()` 掩盖资源泄漏，日志输出被截断
- 对必须完成的任务调用 `unref()`，进程可能在它执行前就退出了
