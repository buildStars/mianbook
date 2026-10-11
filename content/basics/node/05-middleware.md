---
difficulty: 2
tags: [高频, 手写题]
---

# Express 和 Koa 的中间件有什么区别？手写洋葱模型

::: tip 一句话回答
Express 的中间件是回调式的：`next()` 只是同步地调用下一个中间件，**不等待**下游的异步操作完成，流程基本是线性的，响应通常在某个中间件里直接发出。Koa 的中间件是 async 函数，`await next()` 会等**下游全部执行完**再继续，每个中间件都有"进入"和"返回"两个阶段，这就是**洋葱模型**，很适合做耗时统计和统一错误处理。错误处理上，Koa 在外层用 try/catch 包住 `await next()` 就能捕获下游的所有错误；Express 要通过 `next(err)` 交给四个参数的错误处理中间件。
:::

## 详细解析

### 执行模型

```text
请求 ──> A 的前半段 ──> B 的前半段 ──> C（路由处理）
                                          │
响应 <── A 的后半段 <── B 的后半段 <───────┘
         （await next() 之后的代码，在下游全部完成后才执行）
```

Express 中 `next()` 之后的代码也会执行，但时机不同：下游中间件一遇到 `await` 就会返回，这时数据库查询可能还没结束，响应也还没发出。所以 Express 统计耗时要监听 `res.on('finish')`，而不能写在 `next()` 后面。

### 对比

| | Express | Koa |
| --- | --- | --- |
| 中间件签名 | `(req, res, next)` | `(ctx, next)` |
| `next()` | 同步调用下一个中间件，没有返回 Promise | 返回 Promise，`await next()` 等下游全部完成 |
| 发送响应 | `res.send()`、`res.json()` 立即发送 | 给 `ctx.body` 赋值，所有中间件执行完后统一发送 |
| 错误处理 | `next(err)` 交给 `(err, req, res, next)`；Express 5 起 async 函数抛出的错误会自动交过去 | 上游的 try/catch 包住 `await next()`；`app.on('error')` 记录日志 |
| 内置功能 | 路由、静态文件、JSON 解析 | 核心很小，路由、请求体解析都靠中间件，如 @koa/router |

## 代码示例：手写 koa-compose

Koa 的核心是把中间件数组组合成一个函数（koa-compose 这个包），思路如下：

```js
function compose(middleware) {
  return function (ctx, next) {
    let index = -1 // 已经执行到的中间件下标
    function dispatch(i) {
      // 同一个中间件里第二次调用 next 时，i 不会大于 index
      if (i <= index) return Promise.reject(new Error('next() called multiple times'))
      index = i
      // 所有中间件都执行完后，执行外部传入的 next（可以没有）
      const fn = i === middleware.length ? next : middleware[i]
      if (!fn) return Promise.resolve()
      try {
        // 把"执行下一个中间件"作为 next 传进去，返回值统一包装成 Promise
        return Promise.resolve(fn(ctx, () => dispatch(i + 1)))
      } catch (err) {
        // 同步抛出的错误也转成 rejected Promise，上游的 try/catch 才能捕获
        return Promise.reject(err)
      }
    }
    return dispatch(0)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const log = []
await compose([
  async (ctx, next) => { log.push(1); await next(); log.push(6) },
  async (ctx, next) => { log.push(2); await next(); log.push(5) },
  async (ctx, next) => { log.push(3); await sleep(10); log.push(4) },
])({})
console.log(log.join(' ')) // 1 2 3 4 5 6
```

**为什么要防止多次调用 next**：每个中间件拿到的 `next` 都对应固定的下标 `i + 1`，第一次调用后 `index` 至少是 `i + 1`。同一个中间件再调用一次时，`i + 1 <= index` 成立，直接返回 rejected Promise。没有这个保护，下游的中间件会被执行两遍，可能重复写库、重复设置响应。

### 用洋葱模型统计耗时

```js
import Koa from 'koa'

const app = new Koa()

// 放在最外层：耗时统计 + 兜底的错误处理
app.use(async (ctx, next) => {
  const start = performance.now()
  try {
    await next()
  } catch (err) {
    ctx.status = err.status ?? 500
    // 4xx 的错误信息可以返回给客户端，5xx 只返回通用提示
    ctx.body = { message: err.expose ? err.message : '服务器内部错误' }
    ctx.app.emit('error', err, ctx) // 交给 app.on('error') 记录日志
  } finally {
    const ms = (performance.now() - start).toFixed(1)
    ctx.set('X-Response-Time', `${ms}ms`) // 响应还没发出，仍然可以设置响应头
    console.log(`${ctx.method} ${ctx.url} ${ctx.status} ${ms}ms`)
  }
})

app.use(async (ctx) => {
  if (ctx.path === '/error') ctx.throw(400, '参数错误')
  ctx.body = { ok: true }
})

app.on('error', (err) => console.error('请求出错：', err.message))
app.listen(3000)
```

## 面试官可能追问

::: details Koa 中间件里调用 next() 时忘了 await，会怎样？
当前中间件的 Promise 会在下游完成之前就 resolve。Koa 认为所有中间件都执行完了，开始发送响应：如果下游在某个 `await` 之后才给 `ctx.body` 赋值，客户端收到的会是 404。下游抛出的错误也不会被上游的 try/catch 捕获，变成未处理的 Promise 拒绝。所以要写 `await next()` 或 `return next()`。
:::

::: details Express 中怎么统一处理 async 路由里的错误？
Express 5 起，路由处理函数和中间件返回的 Promise 被拒绝时，会自动调用 `next(err)`。Express 4 不会，异步错误会变成未处理的 Promise 拒绝，需要自己包一层：

```js
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

app.get('/users/:id', wrap(async (req, res) => {
  res.json(await findUser(req.params.id))
}))

// 错误处理中间件：必须声明 4 个参数，并且注册在所有路由之后
app.use((err, req, res, next) => {
  res.status(err.status ?? 500).json({ message: '服务器内部错误' })
})
```
:::

::: details 洋葱模型还适合做哪些事？
凡是要在请求前后各做一些事的逻辑都适合：统一包装响应格式、数据库事务（下游成功就提交，抛错就回滚）、接口缓存（命中时直接设置 `ctx.body` 而不调用 `next`，未命中时等下游返回后把结果写进缓存）。中间件不调用 `next` 就能提前结束请求，比如鉴权失败直接返回 401，这和[职责链模式](/basics/design-pattern/08-chain-of-responsibility)的思路一致。
:::

## 易错点

- Koa 中间件调用 `next()` 时忘了 `await` 或 `return`
- Express 中 `next()` 返回时，下游的异步操作可能还没完成，不能在这里统计耗时或修改响应头
- Express 的错误处理中间件必须声明 4 个参数，少一个就会被当成普通中间件
- Express 4 不会把 async 路由里的错误交给错误处理中间件，要自己 catch 后调用 `next(err)`
