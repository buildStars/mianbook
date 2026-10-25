---
title: 手写 Promise.race、allSettled 和 any
---

## 要求

实现三个函数 `race(iterable)`、`allSettled(iterable)`、`any(iterable)`，行为和 `Promise.race`、`Promise.allSettled`、`Promise.any` 一样，都返回一个新的 Promise。

- `race`：跟随最先落定的那一项，它成功就成功，它失败就失败
- `allSettled`：等所有项都落定，永远成功；结果数组和输入顺序一致（不是完成顺序），每一项是 `{ status: 'fulfilled', value }` 或 `{ status: 'rejected', reason }`
- `any`：取最先成功的那一项的值；全部失败时以 `AggregateError` 失败，它的 `errors` 是按**输入顺序**排列的失败原因
- 输入是任意可迭代对象（数组、Set 等），里面可以有普通值，普通值当作已经成功的 Promise
- 空输入：`allSettled` 立即得到 `[]`，`any` 立即以 `AggregateError` 失败（`race` 的空输入永远不落定，不用特别处理）

## 提示

- 三个函数都 `return new Promise(...)`，在里面遍历输入；每一项先用 `Promise.resolve(item)` 包一层，普通值和 Promise 就能统一用 `.then` 处理
- race 不需要计数：外层的 resolve、reject 只有第一次调用生效，直接把它们交给每一项的 then
- allSettled 和 any 先用 `[...iterable]` 转成数组拿到长度，用一个计数器记还剩几项没落定，减到 0 时落定外层 Promise；结果按下标 `results[i] = ...` 存，不能 push
- 空数组时计数器不会减到 0，要提前处理；失败原因用 `new AggregateError(errors, 'All promises were rejected')` 包起来

## 起始代码

```js
function race(iterable) {
  // 返回 Promise，跟随最先落定的一项
}

function allSettled(iterable) {
  // 返回 Promise，结果是每一项的 { status, value } 或 { status, reason }
}

function any(iterable) {
  // 返回 Promise，取最先成功的一项
}
```

## 测试

```js
test('race 跟随最先落定的一项：先成功就成功', async () => {
  await expect(race([delay(60, 'slow'), delay(10, 'fast')])).resolves.toBe('fast')
})

test('race 最先落定的一项失败了就失败', async () => {
  await expect(race([delay(60, 'ok'), delay(10, '出错了', true)])).rejects.toThrow('出错了')
})

test('allSettled 按输入顺序给出每一项的结果，普通值也算成功', async () => {
  const error = new Error('b 失败了')
  const results = await allSettled([delay(40, 'a'), delay(10).then(() => { throw error }), 42])
  expect(results).toEqual([
    { status: 'fulfilled', value: 'a' },
    { status: 'rejected', reason: error },
    { status: 'fulfilled', value: 42 },
  ])
})

test('allSettled 空数组立即得到 []', async () => {
  await expect(allSettled([])).resolves.toEqual([])
}, 1000)

test('any 取最先成功的一项，前面的失败不影响', async () => {
  await expect(any([delay(10, 'x', true), delay(40, 'y'), delay(70, 'z')])).resolves.toBe('y')
})

test('any 全部失败时以 AggregateError 失败，errors 按输入顺序排列', async () => {
  const p = any([delay(40, 'e1', true), delay(10, 'e2', true)])
  await expect(p).rejects.toBeInstanceOf(AggregateError)
  const error = await p.catch((e) => e)
  expect(error.errors.map((e) => e.message)).toEqual(['e1', 'e2'])
})

test('any 空数组立即以 AggregateError 失败', async () => {
  await expect(any([])).rejects.toBeInstanceOf(AggregateError)
}, 1000)

test('输入可以是 Set 这样的可迭代对象，里面可以有普通值', async () => {
  await expect(race(new Set([delay(30, 'slow'), 'now']))).resolves.toBe('now')
  await expect(allSettled(new Set([delay(20, 'a'), 'b']))).resolves.toEqual([
    { status: 'fulfilled', value: 'a' },
    { status: 'fulfilled', value: 'b' },
  ])
  await expect(any(new Set([delay(20, 'e1', true), delay(10, 'e2', true)]))).rejects.toBeInstanceOf(AggregateError)
}, 1000)
```

## 参考答案

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
        (reason) => { results[i] = { status: 'rejected', reason } },
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
```
