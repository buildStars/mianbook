---
title: 手写 promisify
---

## 要求

实现 `promisify(fn)`：把 Node 风格的回调函数（最后一个参数是回调 `(err, ...values) => {}`）转成返回 Promise 的函数。

- 回调的 `err` 有值时 Promise 失败，原因就是这个 `err`
- 回调只有一个结果时 resolve 这个结果；有多个结果时 resolve 成数组
- 调用时的 `this` 要传给原函数（对象方法被 promisify 以后还能用 `this`）

## 提示

- 返回一个新函数 `function (...args) {}`，不要用箭头函数，否则拿不到调用时的 `this`
- 在新函数里 `return new Promise(...)`，调用原函数时把自己的回调放在参数最后
- 用 `fn.call(this, ...args, callback)` 同时传 `this` 和参数

## 起始代码

```js
function promisify(fn) {
  // 返回一个新函数，调用它得到 Promise
}
```

## 测试

```js
const divide = (a, b, cb) => setTimeout(() => (b === 0 ? cb(new Error('除数不能为 0')) : cb(null, a / b)))

test('成功时 resolve 回调的结果', async () => {
  const pDivide = promisify(divide)
  expect(typeof pDivide).toBe('function')
  await expect(pDivide(6, 3)).resolves.toBe(2)
})

test('回调的 err 有值时 Promise 失败', async () => {
  await expect(promisify(divide)(1, 0)).rejects.toThrow('除数不能为 0')
})

test('参数原样传给原函数，回调放在最后', async () => {
  const spy = fn((a, b, cb) => cb(null, a + b))
  await promisify(spy)(1, 2)
  expect(spy).toHaveBeenCalledTimes(1)
  expect(spy.calls[0].slice(0, 2)).toEqual([1, 2])
  expect(typeof spy.calls[0][2]).toBe('function')
})

test('保留调用时的 this', async () => {
  const counter = {
    base: 10,
    add(n, cb) {
      setTimeout(() => cb(null, this.base + n))
    },
  }
  counter.pAdd = promisify(counter.add)
  await expect(counter.pAdd(5)).resolves.toBe(15)
})

test('回调有多个结果时 resolve 成数组', async () => {
  const both = (cb) => setTimeout(() => cb(null, 'a', 'b'))
  await expect(promisify(both)()).resolves.toEqual(['a', 'b'])
})

test('同步调用回调也可以', async () => {
  const sync = (x, cb) => cb(null, x * 2)
  await expect(promisify(sync)(21)).resolves.toBe(42)
})
```

## 参考答案

```js
function promisify(fn) {
  return function (...args) {
    return new Promise((resolve, reject) => {
      fn.call(this, ...args, (err, ...values) => {
        if (err) return reject(err)
        resolve(values.length > 1 ? values : values[0])
      })
    })
  }
}
```
