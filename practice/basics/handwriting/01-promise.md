---
title: 手写 Promise
---

## 要求

实现 `MyPromise` 类，包括构造函数、`then` 和 `catch`（不需要 `finally` 和静态方法）。

**构造函数 `new MyPromise(executor)`**

- 同步执行 `executor(resolve, reject)`
- 状态从 pending 变成 fulfilled 或 rejected 只能一次：resolve、reject 只有第一次调用有效，之后的调用都被忽略
- 执行器同步抛错，等同于用这个错误调用 reject
- `resolve(x)` 的 x 是 Promise 或 thenable 时，等它落定，跟随它的结果（规则和下面 then 回调的返回值一样）

**`then(onFulfilled, onRejected)`**

- 回调总是异步执行，放进微任务队列：即使 Promise 已经落定，也要等当前同步代码跑完才执行，并且要早于 `setTimeout`
- pending 时可以多次调用 then，落定后按注册顺序依次执行
- 返回一个新的 MyPromise，它的结果由回调决定：
  - 回调返回普通值，以这个值成功
  - 回调抛错，以这个错误失败
  - 回调返回 Promise 或 thenable（带 then 方法的对象或函数），等它落定，跟随它的结果
  - 回调返回的恰好是 then 返回的这个 Promise 自己，以 `TypeError` 失败
- 参数不是函数时（没传、传了 null 等），成功值和失败原因都原样传给返回的 Promise（值穿透）

**`catch(onRejected)`** 等同于 `then(undefined, onRejected)`。

## 提示

- 用私有字段存状态、值和一个回调数组：pending 时 then 把回调存进数组，落定时依次执行；resolve 和 reject 共用一个"已经调用过"的标记，只认第一次
- then 里 `return new MyPromise((resolve, reject) => { ... })`，用 `queueMicrotask` 执行回调，用 try/catch 把返回值交给 resolve、把错误交给 reject
- 把"用 x 去 resolve"写成一个单独的函数：x 是 then 返回的 Promise 自己就拒绝；x 是对象或函数并且 `x.then` 是函数，就用 `then.call(x, 成功回调, 失败回调)` 等它，成功拿到的值可能还是 thenable，要递归处理；其余情况直接成功
- 值穿透的失败分支要继续 reject，写成 `(r) => r` 会把失败变成成功

## 起始代码

```js
class MyPromise {
  constructor(executor) {
    // 同步执行 executor(resolve, reject)
  }

  then(onFulfilled, onRejected) {
    // 返回一个新的 MyPromise
  }

  catch(onRejected) {}
}
```

## 测试

```js
// 把 MyPromise 的结果转成原生 Promise，方便 await；200ms 内还没落定就算失败，不用一直等
const settled = (p) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('200ms 内没有落定：then 的回调没有被调用？')), 200)
  p.then(
    (value) => { clearTimeout(timer); resolve(value) },
    (reason) => { clearTimeout(timer); reject(reason) },
  )
})

test('执行器同步执行，resolve 的值传给 then 的回调', async () => {
  let ran = false
  const p = new MyPromise((resolve) => {
    ran = true
    resolve(42)
  })
  expect(ran).toBe(true)
  await expect(settled(p)).resolves.toBe(42)
})

test('状态只能改变一次，之后的 resolve、reject 和抛错都被忽略', async () => {
  const p = new MyPromise((resolve, reject) => {
    resolve(1)
    reject(new Error('无效'))
    resolve(2)
    throw new Error('也无效')
  })
  await expect(settled(p)).resolves.toBe(1)
  const q = new MyPromise((resolve, reject) => {
    reject(new Error('失败'))
    resolve(3)
  })
  await expect(settled(q)).rejects.toThrow('失败')
})

test('then 的回调异步执行：晚于同步代码，早于 setTimeout', async () => {
  const log = []
  setTimeout(() => log.push('setTimeout'))
  const p = new MyPromise((resolve) => resolve('ok')) // 已经落定
  p.then((v) => log.push('then ' + v))
  log.push('同步代码')
  await delay(20)
  expect(log).toEqual(['同步代码', 'then ok', 'setTimeout'])
})

test('pending 时注册的多个回调，落定后按注册顺序执行', async () => {
  const log = []
  const p = new MyPromise((resolve) => setTimeout(() => resolve('done'), 10))
  p.then((v) => log.push('第一个 ' + v))
  p.then((v) => log.push('第二个 ' + v))
  expect(log).toEqual([])
  await settled(p)
  expect(log).toEqual(['第一个 done', '第二个 done'])
})

test('链式调用：回调的返回值传给下一个 then，Promise 和 thenable 等它落定', async () => {
  const p = new MyPromise((resolve) => resolve(delay(10, 1))) // resolve 一个原生 Promise
    .then((v) => v + 1) // 普通值
    .then((v) => new MyPromise((resolve) => setTimeout(() => resolve(v * 10), 10))) // MyPromise
    .then((v) => ({ then: (onFulfilled) => onFulfilled(v + 5) })) // thenable
  await expect(settled(p)).resolves.toBe(25)
})

test('执行器或回调抛错时变成失败，catch 能接住', async () => {
  const p = new MyPromise(() => {
    throw new Error('执行器出错')
  })
  await expect(settled(p)).rejects.toThrow('执行器出错')
  const q = new MyPromise((resolve) => resolve(1))
    .then(() => {
      throw new Error('回调出错')
    })
    .catch((err) => '接住了：' + err.message)
  await expect(settled(q)).resolves.toBe('接住了：回调出错')
})

test('没传回调时，成功值和失败原因都原样往下传', async () => {
  const ok = new MyPromise((resolve) => resolve('值')).then().then(null, undefined)
  await expect(settled(ok)).resolves.toBe('值')
  const bad = new MyPromise((_, reject) => reject(new Error('原因')))
    .then((v) => '不该走到这里')
    .then(undefined)
  await expect(settled(bad)).rejects.toThrow('原因')
})

test('回调返回 then 返回的那个 Promise 自己时，以 TypeError 失败', async () => {
  const self = new MyPromise((resolve) => resolve(1)).then(() => self)
  const result = await Promise.race([
    new Promise((resolve) => self.then(() => resolve('成功了'), (err) => resolve(err))),
    delay(100, '100ms 内一直没有落定'),
  ])
  expect(result).toBeInstanceOf(TypeError)
})
```

## 参考答案

```js
// 返回一个包装器：被它包装的几个函数共享同一个标记，总共只有第一次调用生效
function onlyOnce() {
  let called = false
  return (fn) => (arg) => {
    if (called) return
    called = true
    fn(arg)
  }
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
    try {
      executor(resolve, reject)
    } catch (err) {
      reject(err)
    }
  }

  then(onFulfilled, onRejected) {
    return new MyPromise((resolve, reject) => {
      const run = () => queueMicrotask(() => {
        const ok = this.#state === 'fulfilled'
        const cb = ok ? onFulfilled : onRejected
        // 值穿透：没传回调，就把结果原样交给下一个 Promise
        if (typeof cb !== 'function') return ok ? resolve(this.#value) : reject(this.#value)
        // 回调的返回值交给 resolve，由它处理 thenable 和循环引用
        try {
          resolve(cb(this.#value))
        } catch (err) {
          reject(err)
        }
      })
      this.#state === 'pending' ? this.#handlers.push(run) : run() // 没落定就先存起来，由 settle 触发
    })
  }

  catch(onRejected) {
    return this.then(undefined, onRejected)
  }
}
```
