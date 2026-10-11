---
difficulty: 2
tags: [原理, 实践]
---

# AsyncLocalStorage 是什么？怎么在请求链路里传递 traceId？

::: tip 一句话回答
Node.js 同时处理很多请求，回调和 `await` 之后的代码已经不在原来的调用栈里，全局变量也会被并发的请求互相覆盖，所以"当前是哪个请求"这个信息很难拿到，只能层层传参。`AsyncLocalStorage`（`node:async_hooks` 模块）解决的就是这个问题：`als.run(store, fn)` 为 `fn` 及它发起的**所有异步操作**绑定一个上下文对象，链路上任何地方调用 `als.getStore()` 都能拿到它。典型用法是在请求入口的中间件里生成 traceId 放进去，日志函数自己去取，业务代码不用传参。
:::

## 详细解析

### 为什么会"丢上下文"

```js
let currentTraceId // ❌ 全局变量：请求 A 还在 await，请求 B 进来就把它改了

async function handle(req) {
  currentTraceId = req.headers['x-request-id']
  await db.query('...')          // 让出主线程，期间别的请求会修改 currentTraceId
  log(currentTraceId, '查询完成') // 可能打印的是别的请求的 ID
}
```

不想用全局变量，就只能把 `traceId`（或整个 `ctx`）一路作为参数传给每个函数，侵入性很强，第三方库的回调里也传不进去。Java 里类似的需求用 ThreadLocal 解决，但 Node.js 的请求不和线程绑定，需要"跟着异步调用链走"的存储。

### 用法

| API | 作用 |
| --- | --- |
| `new AsyncLocalStorage()` | 创建一个实例，一般在模块里创建一个、全局共用 |
| `als.run(store, fn, ...args)` | 在新的上下文中同步执行 `fn`，`fn` 里发起的定时器、Promise、I/O 回调都继承这个上下文 |
| `als.getStore()` | 返回当前上下文的 store，不在任何 `run` 里时返回 `undefined` |
| `als.enterWith(store)` | 让当前同步执行的剩余部分及之后的异步操作进入上下文；实验性 API，官方建议优先用 `run` |
| `AsyncLocalStorage.bind(fn)`、`AsyncLocalStorage.snapshot()` | 把函数绑定到当前上下文，用于修复个别库导致的上下文丢失 |

几条规则：

- 每次 `run` 都是独立的上下文，并发请求之间互不影响；嵌套的 `run` 在内层覆盖外层，退出后恢复
- store 是普通对象，传进去的是引用：在下游修改它的属性（比如鉴权后补上 `userId`），整条链路都能看到
- 上下文跟着**异步资源的创建**传播：在 `run` 里注册的 `setTimeout`、发起的 Promise 会带上上下文；`run` 外面早就创建好的东西（比如启动时建立的连接池内部回调）则不一定

### 和 OpenTelemetry 的关系

链路追踪需要知道"当前的 span 是哪个"，原理完全一样。OpenTelemetry 的 Node.js 实现通过 `@opentelemetry/context-async-hooks` 包里的 `AsyncLocalStorageContextManager` 管理上下文，底层就是 `AsyncLocalStorage`。接入 OpenTelemetry 后，日志库可以直接从当前上下文中取出 trace ID 和 span ID 写进日志，不必自己再存一份，见 [日志和监控](/basics/node/19-logging-observability)。

JS 语言层面也有对应的 TC39 提案 `AsyncContext`，目标是把这种能力变成标准，浏览器中也能使用，目前还在提案阶段。

### 使用注意

- **store 只放小而必要的数据**：traceId、userId、租户 ID 这类。不要把整个 `req`、大对象或数据库连接放进去，它们的生命周期会被延长到链路上最后一个异步操作结束
- **不要当成通用的依赖注入**：业务需要的参数还是显式传递，隐式上下文多了，代码很难测试和推理
- **上游传来的 ID 要校验**：`x-request-id` 来自客户端，要限制长度和字符集，否则可能被用来注入日志
- **上下文丢失时的排查**：通常是某个库用了自己的回调队列或自定义 thenable。官方建议把回调 API 用 `util.promisify` 包成 Promise，或用 `AsyncLocalStorage.bind` / `AsyncResource` 把回调绑回正确的上下文

## 代码示例

```js
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'

const als = new AsyncLocalStorage()

// 日志函数自己从上下文里取 traceId，调用方不用传
function log(msg) {
  const ctx = als.getStore()
  console.log(JSON.stringify({ traceId: ctx?.traceId, userId: ctx?.userId, msg }))
}

async function queryOrders() {
  await sleep(Math.random() * 50) // 模拟数据库查询
  log('查询订单完成')              // 隔了几层异步调用，仍能拿到同一个上下文
  return []
}

http.createServer((req, res) => {
  // 优先沿用上游传来的 ID（生产中要校验格式），没有就新生成一个
  const traceId = req.headers['x-request-id'] ?? randomUUID()
  res.setHeader('x-request-id', traceId)
  als.run({ traceId }, async () => {
    als.getStore().userId = 'u1' // 鉴权后补充字段：改的是同一个对象
    log('收到请求')
    res.end(JSON.stringify(await queryOrders()))
  })
}).listen(3000)
```

并发发两个请求，每条日志都带着各自的 traceId，不会串。在 Express 里可以写成中间件：`app.use((req, res, next) => als.run({ traceId: randomUUID() }, next))`，后续的中间件和路由都在 `next` 里执行，自然处在这个上下文中。

## 面试官可能追问

::: details AsyncLocalStorage 有性能开销吗？
有，它需要在每个异步资源创建时记录上下文。它的实现经过了多轮优化，官方文档称它是"高性能且内存安全"的实现。一般的 Web 服务里，它带来的开销远小于一次数据库查询；在意的话，用压测对比开启前后的吞吐。不要因为担心性能而改用已不推荐的 `async_hooks` 底层 API 自己实现。
:::

::: details 为什么要用 run，而不是 enterWith？
`enterWith` 修改的是"当前同步执行的剩余部分"，影响范围不好控制：比如在一个事件监听器里调用它，同一轮同步执行中后面触发的其他监听器也会进入这个上下文。`run` 的范围是明确的一个函数，执行完自动退出。`enterWith` 目前仍是实验性 API，官方文档也建议优先使用 `run`。
:::

::: details 怎么把 traceId 传给下游服务？
在发出 HTTP 请求的统一封装里，从 `getStore()` 取出 traceId 写到请求头里（如 `x-request-id`，或者 W3C Trace Context 规定的 `traceparent`），下游服务的入口中间件读出来再 `run`，整条调用链就串起来了。接入 OpenTelemetry 后，它的 HTTP 插桩会自动注入和提取 `traceparent`。
:::

## 易错点

- 在 `run` 外面调用 `getStore()` 返回 `undefined`，日志代码要能处理没有上下文的情况
- 把 `req`、大对象或连接放进 store，延长了它们的生命周期
- 在模块里给每个请求 `new AsyncLocalStorage()`：实例应该全局共用一个，每个请求只是调用一次 `run`
- 以为 store 是复制的：它是引用，下游修改属性，上游也能看到
