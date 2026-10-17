---
difficulty: 1
tags: [手写题, 高频]
---

# 手写 promisify：怎么把回调风格的函数转成 Promise？

::: tip 一句话回答
promisify 依赖 Node 的 **error-first 回调约定**：回调总在最后一个参数，第一个参数是错误，后面是结果。实现就是返回一个新函数，里面 `new Promise`，调用原函数时**用 `call` 保留 this**、**透传参数**，再在末尾补一个回调：有错误就 reject，否则 resolve。Node 的 `util.promisify` 还支持 `util.promisify.custom`，函数自带 Promise 版本时直接用它；反方向的转换是 `util.callbackify`。
:::

## 详细解析

### error-first 回调约定

Node 早期的异步 API 都长这样：

```js
fs.readFile('a.txt', 'utf8', (err, data) => {
  if (err) return console.error(err)
  console.log(data)
})
```

约定有三条：回调是**最后一个参数**；回调的**第一个参数是错误**，成功时为 `null`；结果从第二个参数开始。promisify 能通用，全靠这个约定。不符合约定的函数，比如 `setTimeout`（回调在前）或者只回调结果不回调错误的函数，不能直接套。

### 实现要点

1. 返回一个普通函数（不是箭头函数），这样调用时的 this 能传给原函数，作为对象方法使用时才不丢 this
2. 收集调用参数，在最后追加自己的回调
3. 回调里 `err` 为真就 reject，否则 resolve
4. 原函数同步抛错时，因为是在 Promise 执行器里调用的，会自动变成 reject

### 多个结果怎么办

有的回调会给出多个结果，比如 `(err, a, b)`。`util.promisify` 默认只取第一个结果；少数内置函数（例如 `dns.lookup`）在内部做了特殊处理，把多个结果组装成对象。手写时可以约定：多于一个结果时打包成数组，面试时说清自己的取舍就行。

### util.promisify.custom

有些函数的 Promise 版本不能机械转换，比如参数顺序特殊。Node 允许在函数上挂 `fn[util.promisify.custom] = 自定义的 Promise 版本`，promisify 遇到它就直接返回。这个 Symbol 等于 `Symbol.for('nodejs.util.promisify.custom')`，所以不引入 util 也能设置。

## 代码示例：手写 promisify 和 callbackify

```js
const custom = Symbol.for('nodejs.util.promisify.custom')

function promisify(fn) {
  if (typeof fn[custom] === 'function') return fn[custom] // 函数自带 Promise 版本，直接用
  return function (...args) {
    return new Promise((resolve, reject) => {
      // 用 call 保留 this，把我们的回调接在参数最后
      fn.call(this, ...args, (err, ...values) => {
        if (err) return reject(err)
        resolve(values.length > 1 ? values : values[0]) // 多个结果打包成数组
      })
    })
  }
}

function callbackify(fn) {
  return function (...args) {
    const cb = args.pop()
    fn.apply(this, args).then(
      (value) => process.nextTick(cb, null, value),
      (err) => process.nextTick(cb, err || new Error('Promise rejected with falsy reason'))
    )
  }
}

// 测试
const divide = (a, b, cb) => setTimeout(() => (b === 0 ? cb(new Error('除数不能为 0')) : cb(null, a / b)))
const pDivide = promisify(divide)
pDivide(6, 3).then((v) => console.log('结果', v)) // 结果 2
pDivide(1, 0).catch((e) => console.log('出错', e.message)) // 出错 除数不能为 0

const counter = {
  base: 10,
  add(n, cb) { setTimeout(() => cb(null, this.base + n)) },
}
counter.pAdd = promisify(counter.add)
counter.pAdd(5).then((v) => console.log('this 保留', v)) // this 保留 15

const both = (cb) => setTimeout(() => cb(null, 'a', 'b'))
promisify(both)().then((v) => console.log(v)) // [ 'a', 'b' ]

callbackify(async (x) => x * 2)(21, (err, v) => console.log(err, v)) // null 42
```

callbackify 用 `process.nextTick` 调用回调，是为了让回调里抛出的错误不被 Promise 吞掉，而是变成未捕获异常。Promise 以 `null`、`undefined` 这类假值拒绝时，回调的第一个参数会被误判为"成功"，所以要包成一个真正的 Error，Node 内置版本也是这么处理的。

## 面试官可能追问

::: details 现在还需要自己 promisify 吗？
大部分场景不用了。Node 的很多模块都提供了 Promise 版本，例如 `fs/promises`、`timers/promises`、`dns/promises`。promisify 主要用在老的第三方库和自己维护的回调风格代码上。手写它考的是对 this、参数透传和回调约定的理解，和 [适配器模式](/basics/design-pattern/07-adapter) 是同一个思路。
:::

::: details 为什么返回的函数不能写成箭头函数？
箭头函数没有自己的 this，会拿到定义 promisify 时外层的 this。把转换后的函数挂到对象上调用，例如 `counter.pAdd(5)`，就拿不到 counter，原函数里的 `this.base` 会出错。
:::

::: details 回调被调用了两次会怎样？
Promise 的状态只能落定一次，后续的 resolve 或 reject 会被忽略，不会报错。这同时也意味着问题被悄悄掩盖了，排查时要知道这一点。
:::

## 易错点

- 忘了把回调放在参数最后，或者对回调在前的函数（如 `setTimeout`）直接套用
- 用 `fn(...args, cb)` 直接调用，丢了 this，转换对象方法时出错
- 以为 `util.promisify` 会把多个结果都返回，实际默认只取第一个
- callbackify 遇到假值拒绝原因时，回调收到 `null` 被当成成功
