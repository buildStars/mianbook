---
title: 手写数组的 map、filter、reduce
---

## 要求

实现 `myMap`、`myFilter`、`myReduce`，行为和原生的 `map`、`filter`、`reduce` 一致。测试会像题目里一样，用 `Object.defineProperty` 把这三个函数挂到 `Array.prototype` 上，再用 `[1, 2, 3].myMap(fn)` 的方式调用，所以函数里通过 `this` 拿到调用它的数组。

- 回调的参数是 `(value, index, array)`，`array` 是原数组；`myReduce` 的回调是 `(acc, value, index, array)`
- `myMap(callback, thisArg)` 返回由回调结果组成的新数组；`myFilter(callback, thisArg)` 返回回调结果为真值的那些元素组成的新数组；`thisArg` 作为回调里的 `this`
- 稀疏数组的空位（比如 `[1, , 3]` 的下标 1）跳过，不调用回调；`myMap` 的结果在同一位置也是空位。显式写的 `undefined` 不是空位，照常遍历
- 开始遍历前就确定长度，回调里往数组追加的元素不会被遍历到
- `myReduce(callback, initialValue)`：传了初始值（显式传 `undefined` 也算传了）就从下标 0 开始；没传就用第一个存在的元素作初始值，从它的下一个元素开始；数组为空（或全是空位）又没传初始值时抛出 `TypeError`

## 提示

- 用普通函数而不是箭头函数，`this` 才是调用它的数组；遍历前先把 `this.length` 存到变量里
- 用 `i in arr` 判断空位；`myMap` 的结果用 `new Array(len)` 创建，跳过的位置自然就是空位
- 用 `callback.call(thisArg, value, i, arr)` 调用回调，`thisArg` 就成了回调里的 `this`
- `myReduce` 用 `arguments.length` 判断有没有传初始值；没传时先往后找第一个存在的元素，找不到就抛错

## 起始代码

```js
function myMap(callback, thisArg) {
  // this 是调用它的数组，返回新数组
}

function myFilter(callback, thisArg) {
  // 返回回调结果为真值的元素组成的新数组
}

function myReduce(callback, initialValue) {
  // 返回累计的结果
}
```

## 测试

```js
// 像题目里一样挂到 Array.prototype 上（不可枚举）
for (const [name, method] of Object.entries({ myMap, myFilter, myReduce })) {
  Object.defineProperty(Array.prototype, name, { value: method, writable: true, configurable: true })
}

test('myMap 返回新数组，回调收到 (value, index, array)', () => {
  const arr = [1, 2, 3]
  const result = arr.myMap((x, i, a) => [x * 2, i, a === arr])
  expect(result).toEqual([[2, 0, true], [4, 1, true], [6, 2, true]])
  expect(result).not.toBe(arr)
  expect(arr).toEqual([1, 2, 3])
})

test('myFilter 只保留回调结果为真值的元素', () => {
  expect([0, 1, '', 'a', null, 2, false].myFilter(Boolean)).toEqual([1, 'a', 2])
  expect([5, 6, 7].myFilter((x, i) => i !== 1)).toEqual([5, 7])
  const arr = [1, 2]
  expect(arr.myFilter(() => true)).not.toBe(arr)
})

test('第二个参数 thisArg 作为回调里的 this', () => {
  const ctx = { min: 2, k: 10 }
  expect([1, 2, 3].myFilter(function (x) { return x >= this.min }, ctx)).toEqual([2, 3])
  expect([1, 2].myMap(function (x) { return x * this.k }, ctx)).toEqual([10, 20])
})

test('跳过空位，myMap 的结果保留空位，undefined 不是空位', () => {
  const double = fn((x) => x * 2)
  const result = [1, , 3].myMap(double)
  expect(double).toHaveBeenCalledTimes(2)
  expect(result).toHaveLength(3)
  expect(1 in result).toBe(false)
  expect(result[2]).toBe(6)
  expect([1, , 3].myFilter(() => true)).toEqual([1, 3])
  const sum = fn((s, x) => s + x)
  expect([1, , 3].myReduce(sum, 0)).toBe(4)
  expect(sum).toHaveBeenCalledTimes(2)
  expect([1, undefined, 3].myMap((x) => x ?? 0)).toEqual([1, 0, 3])
})

test('开始时确定长度，回调里追加的元素不会被遍历', () => {
  const seen = []
  const result = [1, 2, 3].myMap((x, i, a) => {
    if (i === 0) a.push(99)
    seen.push(x)
    return x
  })
  expect(seen).toEqual([1, 2, 3])
  expect(result).toHaveLength(3)
  expect([1, 2, 3].myFilter((x, i, a) => {
    if (i === 0) a.push(4)
    return true
  })).toEqual([1, 2, 3])
  expect([1, 2, 3].myReduce((acc, x, i, a) => {
    if (i === 0) a.push(10)
    return acc + x
  }, 0)).toBe(6)
})

test('myReduce 有初始值时从第一个元素开始，显式传 undefined 也算', () => {
  const arr = [1, 2]
  const add = fn((acc, x) => acc + x)
  expect(arr.myReduce(add, 10)).toBe(13)
  expect(add.calls).toEqual([[10, 1, 0, arr], [11, 2, 1, arr]])
  expect([1, 2].myReduce((acc, x) => String(acc) + x, undefined)).toBe('undefined12')
})

test('myReduce 没有初始值时，从第一个存在的元素开始', () => {
  expect([1, 2, 3].myReduce((s, x) => s + x)).toBe(6)
  expect([, , 5, 6].myReduce((s, x) => s + x)).toBe(11)
  const arr = [, 5, 6]
  const add = fn((s, x) => s + x)
  expect(arr.myReduce(add)).toBe(11)
  expect(add.calls).toEqual([[5, 6, 2, arr]])
  const never = fn()
  expect([7].myReduce(never)).toBe(7)
  expect(never).not.toHaveBeenCalled()
})

test('myReduce 空数组又没有初始值时抛出 TypeError', () => {
  expect(() => [].myReduce((s, x) => s + x)).toThrow(TypeError)
  expect(() => [, ,].myReduce((s, x) => s + x)).toThrow(TypeError)
  const never = fn()
  expect([].myReduce(never, 0)).toBe(0)
  expect(never).not.toHaveBeenCalled()
})
```

## 参考答案

```js
function myMap(callback, thisArg) {
  if (typeof callback !== 'function') throw new TypeError(`${callback} is not a function`)
  const arr = Object(this)
  const len = arr.length >>> 0 // 开始时确定长度，转成非负整数
  const result = new Array(len)
  for (let i = 0; i < len; i++) {
    if (i in arr) result[i] = callback.call(thisArg, arr[i], i, arr) // 空位跳过，结果里也是空位
  }
  return result
}

function myFilter(callback, thisArg) {
  if (typeof callback !== 'function') throw new TypeError(`${callback} is not a function`)
  const arr = Object(this)
  const len = arr.length >>> 0
  const result = []
  for (let i = 0; i < len; i++) {
    if (!(i in arr)) continue
    const value = arr[i] // 先取值：回调里改了 arr[i]，放进结果的仍是传给回调的值
    if (callback.call(thisArg, value, i, arr)) result.push(value)
  }
  return result
}

function myReduce(callback, initialValue) {
  if (typeof callback !== 'function') throw new TypeError(`${callback} is not a function`)
  const arr = Object(this)
  const len = arr.length >>> 0
  let i = 0
  let acc
  if (arguments.length >= 2) {
    acc = initialValue
  } else {
    while (i < len && !(i in arr)) i++ // 找第一个存在的元素
    if (i >= len) throw new TypeError('Reduce of empty array with no initial value')
    acc = arr[i++]
  }
  for (; i < len; i++) {
    if (i in arr) acc = callback(acc, arr[i], i, arr)
  }
  return acc
}
```
