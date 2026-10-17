---
difficulty: 2
tags: [手写题, 对比]
---

# 手写 Promise.race、allSettled 和 any：三者有什么区别？

::: tip 一句话回答
**race** 看第一个落定的，不管成功失败；**allSettled** 等所有都落定，永远成功，结果是 `{ status, value/reason }` 数组；**any** 取第一个成功的，全部失败才拒绝，原因是 `AggregateError`。手写的共同套路：遍历输入，每项用 `Promise.resolve` 包装，挂上 then，用计数器判断"全部完成"，结果按下标存保证顺序。空数组是常考边界：race 永远 pending，allSettled 立即得到 `[]`，any 立即以 AggregateError 拒绝。
:::

## 详细解析

### 语义对比

| 方法 | 何时成功 | 何时失败 | 空数组 |
| --- | --- | --- | --- |
| `Promise.all` | 全部成功 | 任一失败 | 立即成功，`[]` |
| `Promise.race` | 第一个落定的是成功 | 第一个落定的是失败 | 永远 pending |
| `Promise.allSettled` | 全部落定 | 不会失败 | 立即成功，`[]` |
| `Promise.any` | 任一成功 | 全部失败 | 立即失败，AggregateError |

all 的手写和基本用法见 [Promise 的状态和静态方法](/basics/javascript/11-promise)，这里补其余三个。any 和 all 正好对称：all 是"一败即败"，any 是"一成即成"。

### 共同的实现套路

1. 输入是可迭代对象，不一定是数组，先用 `[...iterable]` 转成数组拿到长度
2. 每一项用 `Promise.resolve(item)` 包装，普通值和 thenable 都能统一处理
3. 需要收集结果的，按下标 `results[i] = ...` 存，不能 push，否则顺序取决于谁先完成
4. 用 pending 计数器，减到 0 才落定外层 Promise
5. 空数组要单独处理，否则计数器永远不会减到 0

race 不需要计数器：外层 resolve 和 reject 只有第一次调用生效，直接把它们交给每一项的 then 就行。

## 代码示例：手写三个方法

```js
function race(iterable) {
  return new Promise((resolve, reject) => {
    // 谁先落定就用谁；之后的 resolve/reject 调用会被忽略
    for (const item of iterable) Promise.resolve(item).then(resolve, reject)
  })
}

function allSettled(iterable) {
  return new Promise((resolve) => {
    const items = [...iterable]
    const results = new Array(items.length)
    let pending = items.length
    if (pending === 0) return resolve(results)
    items.forEach((item, i) => {
      Promise.resolve(item).then(
        (value) => { results[i] = { status: 'fulfilled', value } },
        (reason) => { results[i] = { status: 'rejected', reason } }
      ).then(() => { if (--pending === 0) resolve(results) })
    })
  })
}

function any(iterable) {
  return new Promise((resolve, reject) => {
    const items = [...iterable]
    const errors = new Array(items.length)
    let pending = items.length
    if (pending === 0) return reject(new AggregateError([], 'All promises were rejected'))
    items.forEach((item, i) => {
      Promise.resolve(item).then(resolve, (reason) => {
        errors[i] = reason // 按输入顺序记录失败原因
        if (--pending === 0) reject(new AggregateError(errors, 'All promises were rejected'))
      })
    })
  })
}

// 测试
const delay = (ms, v, fail) => new Promise((res, rej) => setTimeout(() => (fail ? rej(new Error(v)) : res(v)), ms))

race([delay(30, 'slow'), delay(10, 'fast')]).then(console.log) // fast
allSettled([delay(20, 'a'), delay(10, 'b', true), 42]).then(console.log)
// [{ status: 'fulfilled', value: 'a' }, { status: 'rejected', reason: Error: b }, { status: 'fulfilled', value: 42 }]
any([delay(10, 'x', true), delay(20, 'y')]).then(console.log) // y
any([delay(20, 'e1', true), delay(10, 'e2', true)])
  .catch((e) => console.log(e instanceof AggregateError, e.errors.map((x) => x.message))) // true [ 'e1', 'e2' ]
```

注意 any 的 `errors` 按输入顺序排列：e2 先失败，但它排在第二位。

## 面试官可能追问

::: details 这三个方法各用在什么场景？
race 常用于超时控制：把请求和一个定时拒绝的 Promise 一起比赛，见 [超时和重试](/basics/handwriting/07-retry-timeout)。allSettled 用于批量请求要容错的场景，比如首页同时拉多个模块，某个失败只隐藏那一块，不影响其他。any 用于多源取最快的成功结果，比如同一个资源有多个 CDN 地址，哪个先成功用哪个，单个源挂了不影响。
:::

::: details race 做超时，输掉的请求会被取消吗？
不会。race 只是不再关心其他 Promise 的结果，它们照常执行。真正要取消请求，需要配合 AbortController，在超时时调用 `abort()`。
:::

::: details allSettled 的结果怎么筛出成功和失败？
按 status 过滤：`results.filter((r) => r.status === 'fulfilled').map((r) => r.value)` 拿成功的值，`'rejected'` 那一组取 `reason`。用 TypeScript 时可以写类型守卫，把结果收窄成 `PromiseFulfilledResult`。
:::

## 易错点

- 结果用 push 收集，顺序变成了完成顺序，而不是输入顺序
- 忘了处理空数组，allSettled 和 any 永远不落定
- 不用 `Promise.resolve` 包装，输入里有普通值时直接调用 `.then` 报错
- 以为 race 会取第一个成功的；取第一个成功的是 any
