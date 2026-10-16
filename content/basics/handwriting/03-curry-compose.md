---
difficulty: 2
tags: [手写题]
---

# 函数柯里化和 compose 怎么实现？有什么实际用途？

::: tip 一句话回答
**柯里化**把一个多参数函数变成可以分多次传参的函数：用闭包把已经传入的参数存起来，凑够 `fn.length` 个就执行原函数，不够就返回一个继续收集参数的函数。`fn.length` 不统计剩余参数和默认参数（以及它之后的参数），这类函数要手动指定参数个数。**compose** 把多个函数组合成一个，从右到左依次执行，前一个的返回值作为后一个的参数；**pipe** 方向相反，从左到右，两者都用 reduce 实现。异步版本的 compose 就是 Koa 的洋葱模型。用途是参数复用、把小函数组合成数据处理流程，以及中间件。
:::

## 详细解析

### 柯里化：凑够参数再执行

```js
function curry(fn, arity = fn.length) {
  return function curried(...args) {
    // 参数够了就执行原函数，不够就返回一个新函数，把之前的参数和新参数合在一起再判断
    if (args.length >= arity) return fn.apply(this, args)
    return (...rest) => curried.apply(this, [...args, ...rest])
  }
}

const add = curry((a, b, c) => a + b + c)
console.log(add(1)(2)(3), add(1, 2)(3), add(1)(2, 3), add(1, 2, 3)) // 6 6 6 6
```

### fn.length 的限制

`fn.length` 只统计第一个带默认值的参数**之前**的参数，剩余参数也不算。对这类函数，curry 判断"参数够了"的依据就不对，要手动传入参数个数：

```js
console.log(((a, b = 2, c) => {}).length) // 1：b 有默认值，b 和它后面的 c 都不算
console.log(((a, ...rest) => {}).length) // 1：剩余参数不算

const sum = (...nums) => nums.reduce((total, n) => total + n, 0)
console.log(curry(sum)(1)) // 1：length 是 0，第一次调用就直接执行了
console.log(curry(sum, 3)(1)(2)(3)) // 6：手动指定凑够 3 个参数再执行
```

### compose 和 pipe

```js
const compose = (...fns) => (x) => fns.reduceRight((acc, fn) => fn(acc), x) // 从右到左
const pipe = (...fns) => (x) => fns.reduce((acc, fn) => fn(acc), x) // 从左到右

const trim = (s) => s.trim()
const lower = (s) => s.toLowerCase()
const dash = (s) => s.replace(/\s+/g, '-')
console.log(pipe(trim, lower, dash)('  Hello World  ')) // hello-world
console.log(compose(dash, lower, trim)('  Hello World  ')) // hello-world，和数学上的 f(g(x)) 顺序一致
```

柯里化和组合经常一起用：把数据参数放在最后，先传入配置，得到的单参数函数正好可以交给 pipe 串起来。

```js
const map = curry((fn, arr) => arr.map(fn))
const filter = curry((fn, arr) => arr.filter(fn))
const oddTimesTen = pipe(filter((n) => n % 2 === 1), map((n) => n * 10))
console.log(oddTimesTen([1, 2, 3, 4, 5])) // [ 10, 30, 50 ]
```

### 异步中间件 compose（洋葱模型）

每个中间件拿到 `next`，`await next()` 会等后面所有中间件执行完再继续，所以每个中间件都有"进去"和"出来"两段，像洋葱一样层层包裹：

```js
function composeMiddleware(middlewares) {
  return (ctx) => {
    // dispatch(i) 执行第 i 个中间件，把"执行下一个"作为 next 传给它；async 让同步抛错也变成 rejected
    const dispatch = async (i) => {
      const fn = middlewares[i]
      if (fn) await fn(ctx, () => dispatch(i + 1))
    }
    return dispatch(0)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const logs = []
const app = composeMiddleware([
  async (ctx, next) => { logs.push('a 进'); await next(); logs.push('a 出') },
  async (ctx, next) => { logs.push('b 进'); await sleep(10); await next(); logs.push('b 出') },
  async (ctx) => { logs.push('c 处理'); ctx.body = 'ok' },
])
const ctx = {}
await app(ctx)
console.log(logs.join(' → '), ctx.body) // a 进 → b 进 → c 处理 → b 出 → a 出 ok
```

这是精简版，Koa 实际用的 koa-compose 还会检查同一个中间件里 `next` 被调用了多次，完整写法见 [Express 和 Koa 的中间件](/basics/node/05-middleware)。

### 实际用途

- **参数复用**：固定前几个参数，得到更具体的函数，见下面的例子
- **组合小函数**：每个函数只做一件事，用 pipe 串成数据处理流程，比层层嵌套调用好读
- **中间件**：Koa、Redux 的中间件机制本质上都是函数组合

```js
const log = curry((level, module, msg) => console.log(`[${level}] [${module}] ${msg}`))
const authWarn = log('WARN')('auth') // 固定级别和模块，之后只传消息
authWarn('token 即将过期') // [WARN] [auth] token 即将过期
```

## 面试官可能追问

::: details 支持占位符的柯里化怎么实现？
lodash 的 curry 支持占位符，可以先跳过某个参数：`fn(_, 2)(1)`。思路是每次收到新参数时，先依次填进之前占位符的位置，剩下的追加到末尾；前 arity 个参数里没有占位符时才执行。

```js
const _ = Symbol('placeholder')
function curryWithPlaceholder(fn, arity = fn.length) {
  return function curried(...args) {
    if (args.length >= arity && !args.slice(0, arity).includes(_)) return fn.apply(this, args)
    return (...rest) => curried.apply(this, [...args.map((a) => (a === _ && rest.length ? rest.shift() : a)), ...rest])
  }
}
const list = curryWithPlaceholder((a, b, c) => [a, b, c])
console.log(list(_, 2)(1, 3), list(_, _, 3)(1)(2)) // [ 1, 2, 3 ] [ 1, 2, 3 ]
```
:::

::: details Redux 的 compose 为什么写成 `fns.reduce((f, g) => (...args) => f(g(...args)))`？
这种写法先把函数两两嵌套成一个新函数，最右边的函数可以接收多个参数，上面的 reduceRight 版本只能传一个。它还单独处理了边界：没有函数时返回一个原样返回参数的函数，只有一个函数时直接返回它。
:::

::: details 柯里化有什么缺点？
多了一层层闭包和函数调用，有一点性能开销，在热点代码里要注意；调用栈更深，调试不直观；`add(1)(2)` 这种写法对不熟悉的同事不友好。TypeScript 里给通用的 curry 写准确的类型也比较复杂。所以业务代码里一般只在参数复用的场景用，或者直接用箭头函数手动固定参数：`const authWarn = (msg) => log('WARN', 'auth', msg)`。
:::

## 易错点

- 依赖 `fn.length` 判断参数个数，遇到默认参数、剩余参数、`arguments` 写法的函数会提前执行，要手动指定参数个数
- curry 返回的函数如果复用同一个参数数组（比如用 push 收集参数），多次调用会互相污染，每次都要创建新数组
- compose 是从右到左执行，pipe 是从左到右，组合顺序写反了结果就错了
