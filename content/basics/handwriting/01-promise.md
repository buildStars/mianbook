---
difficulty: 3
tags: [手写题, 高频]
---

# 手写 Promise：状态、then 链式调用和异步执行怎么实现？

::: tip 一句话回答
核心是三块：**状态机**，pending 只能变成 fulfilled 或 rejected 一次，之后的调用都被忽略；**回调队列**，pending 时 then 把回调存起来，落定后用 `queueMicrotask` 异步执行；**then 返回新 Promise**，回调的返回值经过 `resolvePromise` 决定它的结果：普通值直接成功，thenable 等它落定，返回自身以 TypeError 拒绝，回调抛错则拒绝。没传回调时结果原样往下传（值穿透），`catch` 和 `finally` 都基于 then 实现。
:::

## 详细解析

### 要满足的规则

1. **状态只能改变一次**：resolve / reject 只有第一次调用有效；执行器同步抛错等同于 reject
2. **回调异步执行**：即使已经落定，then 的回调也要放进微任务队列，等当前同步代码跑完再执行（见 [事件循环](/basics/javascript/01-event-loop)）
3. **then 返回新 Promise**：回调返回普通值，新 Promise 以它成功；抛错，以错误拒绝；返回 thenable（带 then 方法的对象，Promise 也是），跟随它的最终状态
4. **循环引用**：回调返回的恰好是 then 返回的那个 Promise 自己，它要等自己落定，永远不会结束，所以直接以 TypeError 拒绝
5. **值穿透**：then 没传回调（或传的不是函数），成功值和失败原因都原样传给下一个 Promise，失败会一直传到 catch

这些规则来自 **Promises/A+** 规范。它只规定 then 的行为和处理返回值的过程（Promise Resolution Procedure），不管构造函数、catch、finally 和静态方法；原生 Promise 遵循 ECMAScript 规范，then 的行为兼容 A+。基本用法和静态方法见 [Promise 的状态和静态方法](/basics/javascript/11-promise)。

面试时先写能跑的核心：状态、回调队列、then 返回新 Promise，返回值先只处理普通值和 Promise；再补边界：值穿透、thenable、读取 then 时抛错、循环引用；最后基于 then 补上 catch、finally 和 `Promise.resolve`，用测试跑一遍执行顺序。

## 代码示例：手写 Promise

```js
// 返回一个包装器：被它包装的几个函数共享同一个标记，总共只有第一次调用生效
function onlyOnce() {
  let called = false
  return (fn) => (arg) => { if (!called) { called = true; fn(arg) } }
}

// 用 x 去 resolve promise：x 可能是普通值、thenable，甚至是 promise 自己
function resolvePromise(promise, x, fulfill, reject) {
  if (x === promise) return reject(new TypeError('Chaining cycle detected for promise'))
  if (x === null || (typeof x !== 'object' && typeof x !== 'function')) return fulfill(x)
  const once = onlyOnce() // thenable 可能多次调用回调，或者调用之后又抛错，只认第一次
  try {
    const then = x.then // 只读一次：then 可能是会抛错的 getter
    if (typeof then !== 'function') return fulfill(x)
    then.call(x, once((y) => resolvePromise(promise, y, fulfill, reject)), once(reject)) // y 可能还是 thenable，递归展开
  } catch (err) {
    once(reject)(err)
  }
}

class MyPromise {
  #state = 'pending'
  #value
  #handlers = [] // pending 期间 then 注册的回调
  constructor(executor) {
    const settle = (state, value) => {
      this.#state = state
      this.#value = value
      this.#handlers.forEach((run) => run())
    }
    const once = onlyOnce() // resolve 和 reject 共用一个标记；x 是 thenable 时要等它落定，不能直接成功
    const resolve = once((x) => resolvePromise(this, x, (v) => settle('fulfilled', v), (r) => settle('rejected', r)))
    const reject = once((reason) => settle('rejected', reason))
    try { executor(resolve, reject) } catch (err) { reject(err) }
  }

  then(onFulfilled, onRejected) {
    return new MyPromise((resolve, reject) => {
      const run = () => queueMicrotask(() => {
        const ok = this.#state === 'fulfilled'
        const cb = ok ? onFulfilled : onRejected
        // 值穿透：没传回调，就把结果原样交给下一个 Promise
        if (typeof cb !== 'function') return ok ? resolve(this.#value) : reject(this.#value)
        // 回调的返回值交给 resolve，由它处理 thenable 和循环引用
        try { resolve(cb(this.#value)) } catch (err) { reject(err) }
      })
      this.#state === 'pending' ? this.#handlers.push(run) : run() // 没落定就先存起来，由 settle 触发
    })
  }

  catch(onRejected) { return this.then(undefined, onRejected) }
  finally(onFinally) {
    if (typeof onFinally !== 'function') return this.then(onFinally, onFinally)
    // 回调不接收参数，也不改变结果；除非它抛错或返回失败的 Promise
    return this.then(
      (value) => MyPromise.resolve(onFinally()).then(() => value),
      (reason) => MyPromise.resolve(onFinally()).then(() => { throw reason }),
    )
  }
  static resolve(value) { return value instanceof MyPromise ? value : new MyPromise((r) => r(value)) }
}

// ===== 测试：按 1 到 8 的顺序输出；把 MyPromise 换成原生 Promise，输出完全一样 =====
console.log('1 同步代码')
new MyPromise((resolve, reject) => {
  console.log('2 执行器同步执行')
  resolve('ok')
  reject(new Error('无效')) // 状态已经改变，这次调用被忽略
}).then((v) => console.log('4 then:', v))
console.log('3 同步代码结束')

setTimeout(() => {
  MyPromise.resolve(1)
    .then() // 值穿透
    .then((v) => ({ then: (resolve) => resolve(v + 1) })) // 返回 thenable，会被展开
    .then((v) => new MyPromise((resolve) => setTimeout(resolve, 10, v * 10))) // 等它落定
    .finally(() => console.log('5 finally'))
    .then((v) => console.log('6 链式结果:', v)) // 6 链式结果: 20
})

setTimeout(() => {
  new MyPromise(() => { throw new Error('出错了') }).catch((err) => console.log('7', err.message))
  const self = MyPromise.resolve().then(() => self) // 返回自己
  self.catch((err) => console.log('8', err.constructor.name)) // 8 TypeError
}, 50)
```

## 面试官可能追问

::: details 手写版和原生 Promise 的执行顺序完全一样吗？
不完全一样。ECMAScript 规范要求用 thenable 去 resolve 时，在一个新的微任务里才调用它的 then，then 注册的回调又要再等一个微任务，所以原生比返回普通值多等两轮；手写版同步调用 then，只多等一轮，A+ 对此没有要求。下面这道经典输出题，原生输出 `0 1 2 3 4 5 6`，手写版输出 `0 1 2 4 3 5 6`；想对齐原生，`x.then` 照样同步读取，把 `then.call(...)` 放进 `queueMicrotask` 里执行，并在微任务里再包一层 try/catch：外层的 catch 捕获不到微任务里抛出的错误。

```js
Promise.resolve().then(() => { console.log(0); return Promise.resolve(4) }).then((v) => console.log(v))
Promise.resolve().then(() => console.log(1)).then(() => console.log(2)).then(() => console.log(3)).then(() => console.log(5)).then(() => console.log(6))
```
:::

::: details 为什么要保证只认第一次，还要先把 x.then 存到变量里？
thenable 可能来自别的 Promise 库，甚至是写得有问题的对象：它可能先后调用成功和失败回调，或者调用回调之后又抛错，所以只采用第一次的结果。`x.then` 可能是 getter，每次读取都可能返回不同的值或抛错，所以只读一次，读取时抛错就拒绝。
:::

::: details 怎么确认自己的实现符合规范？
Promises/A+ 有官方测试集 promises-aplus-tests。写一个适配器文件，导出 `deferred()`，返回 `{ promise, resolve, reject }`，再用命令行指定这个文件运行，几百个用例覆盖了 then 和 resolvePromise 的各种边界。`Promise.all`、`race` 等静态方法也都基于 then 实现，写法见上面链接的那道题。
:::

## 易错点

- 用 setTimeout 模拟异步：它是宏任务，和其他微任务交错时，执行顺序会和原生不一致
- Promise 已经落定时，then 的回调也要异步执行，不能因为状态已知就同步调用
- 值穿透的失败分支要继续拒绝，常见写法 `onRejected = (r) => { throw r }`；写成 `(r) => r` 会把失败变成成功
