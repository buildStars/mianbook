---
difficulty: 2
tags: [高频, 手写题]
---

# Promise 有哪些状态和静态方法？手写 Promise.all

::: tip 一句话回答
Promise 有三种状态：**pending**（进行中）、**fulfilled**（已成功）、**rejected**（已失败），状态只能从 pending 变成另外两种之一，一旦改变就不会再变。`new Promise` 传入的执行器是同步执行的，`then` / `catch` / `finally` 的回调是微任务。常用的静态方法有 `all`、`allSettled`、`race`、`any`、`resolve`、`reject`，以及 ES2024 新增的 `withResolvers`。
:::

## 详细解析

### 状态和执行时机

```js
const p = new Promise((resolve, reject) => {
  console.log(1) // 执行器同步执行
  resolve('ok')
  reject(new Error('fail')) // 无效：状态已经变成 fulfilled
  console.log(2) // resolve 不会中断执行器，后面的代码照常执行
})
p.then((value) => console.log(value)) // 回调作为微任务执行
console.log(3)
// 输出：1 2 3 ok
```

微任务的执行时机见 [事件循环](/basics/javascript/01-event-loop)。另外，`resolve` 的参数如果是另一个 Promise（或带 `then` 方法的对象），当前 Promise 会跟随它的最终状态，所以调用 `resolve` 不一定代表成功。

### then 的链式调用

`then` 总是返回一个**新的** Promise，所以可以链式调用：

- 回调返回普通值，下一个 `then` 收到这个值；返回 Promise，下一个 `then` 会等它落定再拿到结果
- 回调抛出错误（或返回失败的 Promise），后面的成功回调都会被跳过，直到被 `catch` 捕获；`catch` 同样返回新的 Promise，处理完后链条恢复正常

### 静态方法

| 方法 | 行为 | 典型场景 |
| --- | --- | --- |
| `Promise.all` | 全部成功才成功，结果按输入顺序排列；任何一个失败就立即失败 | 并行请求，缺一不可 |
| `Promise.allSettled` | 等所有 Promise 都落定（成功或失败），返回每一项的状态和结果，不会因为某一项失败而失败 | 批量操作，需要知道每一项的成败 |
| `Promise.race` | 采用第一个落定的结果，无论成功还是失败 | 给请求加超时 |
| `Promise.any` | 采用第一个成功的结果；全部失败时以 `AggregateError` 拒绝 | 多个备用源，取最快可用的一个 |
| `Promise.resolve` / `Promise.reject` | `resolve` 把值包装成 Promise（传入原生 Promise 时原样返回）；`reject` 返回一个已失败的 Promise | 统一成 Promise 处理 |
| `Promise.withResolvers`（ES2024） | 返回 `{ promise, resolve, reject }` | 在执行器外部控制 Promise 的状态 |

## 代码示例：手写 Promise.all

```js
function promiseAll(iterable) {
  return new Promise((resolve, reject) => {
    // 原生实现可以接收任意可迭代对象，这里先展开成数组；不可迭代时会抛错，Promise 随之 reject
    const items = [...iterable]
    const results = new Array(items.length)
    let count = 0
    // 空数组立即 resolve 空数组
    if (items.length === 0) return resolve(results)

    items.forEach((item, index) => {
      // 用 Promise.resolve 包装，兼容非 Promise 的值
      Promise.resolve(item).then((value) => {
        results[index] = value // 按输入顺序存放，而不是完成顺序
        count++
        if (count === items.length) resolve(results)
      }, reject) // 任何一个失败就整体失败，之后再调用 resolve / reject 都无效
    })
  })
}

const delay = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms))
promiseAll([delay(200, 'a'), 'b', delay(100, 'c')]).then(console.log) // ['a', 'b', 'c']
promiseAll([]).then(console.log) // []
promiseAll([delay(100, 'a'), Promise.reject(new Error('fail'))]).catch((err) => console.log(err.message)) // fail
```

## 代码示例：限制并发数的请求调度

```js
// tasks 是返回 Promise 的函数数组，例如 () => fetch(url)
async function runWithLimit(tasks, limit = 3) {
  const results = new Array(tasks.length)
  let next = 0 // 下一个要领取的任务下标
  // 每个 worker 完成一个任务后立刻领取下一个，所以同时最多有 limit 个任务在执行
  async function worker() {
    while (next < tasks.length) {
      const index = next++
      results[index] = await tasks[index]()
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker())
  await Promise.all(workers)
  return results
}

const tasks = ['/api/1', '/api/2', '/api/3', '/api/4', '/api/5'].map((url) => () => fetch(url))
runWithLimit(tasks, 3).then((list) => console.log(list)) // 5 个 Response，顺序与 tasks 一致
```

- 传入的必须是**函数**而不是 Promise：Promise 一创建就开始执行，无法再控制并发
- `next++` 是同步执行的，JS 又是单线程，两个 worker 不会领到同一个任务；结果按下标写入，所以顺序与输入一致
- 和 `Promise.all` 一样，任何一个任务失败，整体就会失败，但其他 worker 仍会继续执行剩下的任务。如果需要每个任务的成败，可以在 worker 里 `try...catch`，按 `allSettled` 的格式记录结果

## 面试官可能追问

::: details 手写 Promise.allSettled 和 Promise.race？
```js
function promiseAllSettled(iterable) {
  const wrapped = [...iterable].map((item) =>
    Promise.resolve(item).then(
      (value) => ({ status: 'fulfilled', value }),
      (reason) => ({ status: 'rejected', reason }),
    ),
  )
  // 每一项都被转换成了成功的 Promise，所以 Promise.all 不会失败
  return Promise.all(wrapped)
}
```

`race` 更简单：在 `new Promise` 的执行器里遍历输入，对每一项执行 `Promise.resolve(item).then(resolve, reject)`，谁先落定就采用谁的结果，之后的调用都无效。传入空数组时，`race` 返回的 Promise 会一直处于 pending 状态。
:::

::: details Promise.all 中一个失败后，其他请求会被取消吗？
不会。Promise 本身没有取消机制，`Promise.all` 只是在第一个失败时就以它的原因 reject，其他请求仍在继续，只是结果被忽略。要真正取消，可以给这些请求传入同一个 `AbortController` 的 `signal`，捕获到错误时调用 `controller.abort()`。
:::

::: details then 的第二个参数和 catch 有什么区别？
`catch(fn)` 相当于 `then(undefined, fn)`。区别在于捕获范围：`then` 的第二个参数捕获不到同一个 `then` 里第一个回调抛出的错误；写在后面的 `catch` 能捕获前面整条链上的错误，包括成功回调里抛出的。所以一般在链的末尾统一用 `catch`。
:::

## 易错点

- 执行器是同步执行的，只有 `then` / `catch` / `finally` 的回调是异步的
- `Promise.all` 结果的顺序和输入顺序一致，与完成的先后无关；判断是否全部完成要用计数器，不能用 `results.length`：用 `[]` 存结果时，先给 `results[2]` 赋值，长度就已经是 3 了
- `resolve` / `reject` 不会结束执行器，后面的代码照常执行，需要时加 `return`
