---
difficulty: 2
tags: [高频, 实践]
---

# Node.js 服务怎么处理异常？进程崩溃了怎么办？

::: tip 一句话回答
按错误的传递方式分别处理：同步代码用 try/catch；错误优先回调先检查第一个参数；Promise 用 `.catch()`，或在 async 函数里用 try/catch 配合 await；EventEmitter（流、socket、server）要监听 `error` 事件，否则错误会直接抛出、让进程退出。`uncaughtException` 和 `unhandledRejection` 是最后一道防线，只用来**记录日志，然后退出**：这时程序可能停在某个操作的中间，状态已经不可信。进程退出后由 PM2、systemd 或容器的重启策略重新拉起；发布和停机时要**优雅退出**，收到 SIGTERM 后停止接收新请求，等正在处理的请求完成再退出。
:::

## 详细解析

### 四种错误传递方式

| 方式 | 怎么捕获 | 常见遗漏 |
| --- | --- | --- |
| 同步 throw | try/catch | try/catch 包不住回调和定时器里抛出的错误 |
| 错误优先回调 `(err, data) => {}` | 先检查 `err` | 忘了判断；在回调里 throw，调用方捕获不到 |
| Promise、async 函数 | `.catch()`，或 try/catch + await | 调用 async 函数时既没有 await 也没有 catch |
| EventEmitter 的 `error` 事件 | 监听 `error` | 流、socket、server 没有监听，出错时直接抛出 |

```js
try {
  setTimeout(() => {
    throw new Error('boom') // 捕获不到：回调执行时，外面的 try 早就结束了
  }, 0)
} catch {}

async function handler() {
  try {
    saveLog()               // 少了 await：它的 Promise 被拒绝时，这里的 catch 捕获不到
    return await loadUser() // 有 await，错误才会在这里被捕获
  } catch (err) {
    // ...
  }
}
```

Node.js 15 起，没有被处理的 Promise 拒绝默认会让进程退出，漏掉一个 catch 就是一次崩溃。请求里的错误最好统一交给框架处理，Express 和 Koa 的做法见 [中间件的区别](/basics/node/05-middleware)。

### 全局兜底和优雅退出

部署新版本、缩容时，Kubernetes、Docker、systemd 会先发 SIGTERM（PM2 默认发 SIGINT），等一段时间还没退出再发 SIGKILL 强制结束（Kubernetes 默认等 30 秒，`docker stop` 默认 10 秒）。收到信号后：

1. 停止接收新连接：`server.close()`
2. 等正在处理的请求完成
3. 关闭数据库连接池等资源，把日志写完
4. 退出进程；超过时间还没完成就强制退出

全局兜底的异常处理也走同一个退出流程：

```js
import http from 'node:http'

let shuttingDown = false
const server = http.createServer((req, res) => {
  // 退出期间让客户端不要再复用这个连接
  if (shuttingDown) res.setHeader('Connection', 'close')
  res.end('ok\n')
})
server.listen(3000)

async function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  // 兜底：10 秒后强制退出；unref 让这个定时器不阻止进程退出
  setTimeout(() => process.exit(code || 1), 10_000).unref()

  await new Promise((resolve) => server.close(resolve)) // 所有连接都关闭后才回调
  // await db.end() 关闭连接池等资源
  process.exit(code)
}

process.on('SIGTERM', () => shutdown(0))
process.on('SIGINT', () => shutdown(0))

// 最后一道防线：记录日志，然后退出
process.on('uncaughtException', (err, origin) => {
  console.error('未捕获的异常', origin, err)
  shutdown(1)
})
process.on('unhandledRejection', (reason) => {
  console.error('未处理的 Promise 拒绝', reason)
  shutdown(1)
})
```

`server.close()` 只会关闭调用那一刻空闲的 keep-alive 连接，正在处理请求的连接在响应结束后还可能被客户端复用，`close` 的回调要等这些连接也空闲超时才执行，所以退出期间给响应加上 `Connection: close`。WebSocket 这类升级后的长连接不会自己结束，`server.closeAllConnections()` 也关不掉它们，要自己记录这些连接，主动通知客户端断开，超时后再销毁。

因为未捕获的异常而退出时，程序状态已经不可信，等待的时间应该设得更短；对一致性要求高的服务，也可以记录日志后直接 `process.exit(1)`。

### 进程守护

| 方式 | 做法 |
| --- | --- |
| PM2 | 进程退出后自动重启；可以按内存上限重启（`max_memory_restart`），用 cluster 模式运行多个实例 |
| systemd | 服务配置里写 `Restart=on-failure`，用 `RestartSec` 设置重启间隔 |
| Docker | 运行时加 `--restart=on-failure` 或 `--restart=unless-stopped` |
| Kubernetes | 容器退出后按 `restartPolicy` 重启；存活探针发现进程卡死时重启，就绪探针失败时不再转发流量 |

重启只是止血。频繁重启说明有没修好的 bug，要配上日志和告警，根据崩溃时的记录定位原因。

## 面试官可能追问

::: details 为什么捕获了 uncaughtException 之后，不能让进程继续运行？
异常打断了正在执行的代码，后面本该执行的清理逻辑都被跳过了：锁没有释放、事务没有回滚、连接停在异常状态。程序处在未知状态，继续处理请求可能写出错误的数据，问题还会滞后暴露，更难排查。Node.js 官方文档也说明，`uncaughtException` 之后恢复正常运行是不安全的，它只适合做同步的资源清理，然后退出。
:::

::: details 哪些错误可以恢复，哪些应该让进程退出？
**运行时错误**是预期内会发生的：网络超时、参数不合法、文件不存在、下游服务返回 500。它们要在代码里处理，比如重试、降级、返回合适的状态码。**程序错误**是代码的 bug：读取 undefined 的属性、传错参数类型。它们没法在运行时可靠地恢复，应该让进程退出、留下日志，再去修复代码。
:::

::: details 一个请求出错，会不会让整个服务崩溃？
在请求的 Promise 链里抛出的错误，Express 5、Koa 这类框架会捕获并返回 500，不影响其他请求。危险的是脱离请求链的错误：定时器回调里的 throw、没有 await 的 Promise、没有监听 `error` 的流。它们会变成未捕获的异常让进程退出，这个进程上的所有请求都会失败。所以要避免"悬空"的 Promise（可以用 typescript-eslint 的 `no-floating-promises` 规则检查），并且部署多个实例。
:::

::: details 在 Docker 里，为什么 Node.js 有时收不到 SIGTERM？
常见原因有两个。一是 Node.js 作为容器的 1 号进程运行时，内核不会对它执行 SIGTERM 的默认动作（终止进程），代码里没有监听 SIGTERM 并主动退出的话，进程就一直不退出，只能等超时后被 SIGKILL 杀掉。二是用 `npm start` 或 shell 脚本启动，信号发给了 npm 或 shell，不一定会转发给 Node.js 进程。解决办法：代码里显式处理 SIGTERM；启动命令直接写成 `CMD ["node", "server.js"]`；或者用 `docker run --init`，由一个轻量的 init 进程负责转发信号。
:::

## 易错点

- try/catch 包不住回调、定时器和没有 await 的 Promise 里的错误
- 监听了 `uncaughtException`，打个日志就让进程继续运行
- 流、socket、server 没有监听 `error` 事件；串联多个流时用 `pipeline` 统一处理错误，见 [Stream 和背压](/basics/node/03-stream)
- 优雅退出不设超时，一条不断开的长连接就能让进程迟迟退不出去
