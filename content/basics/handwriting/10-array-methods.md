---
difficulty: 1
tags: [手写题]
---

# 手写数组的 map、filter、reduce 要注意哪些细节？

::: tip 一句话回答
主体就是一个 for 循环，容易丢分的是细节：回调参数是 `(value, index, array)`，map 和 filter 支持第二个参数 **thisArg**；**稀疏数组的空位要跳过**，用 `i in arr` 判断；**长度在开始时就确定**，回调里追加的元素不会被遍历到；reduce 没有初始值时从**第一个存在的元素**开始，空数组又没有初始值要抛 TypeError。挂到原型上时不能用箭头函数，否则拿不到调用它的数组。
:::

## 详细解析

### 原生方法的几条规则

- **回调参数**：`(value, index, array)`，array 是原数组；map、filter 的第二个参数 thisArg 作为回调里的 this，reduce 没有 thisArg
- **跳过空位**：`[1, , 3]` 下标 1 是空位（不存在这个属性），回调不会被调用；map 的结果在同一位置也保留空位。显式写的 undefined 不是空位，照常遍历
- **长度只读一次**：开始前读取 `length`，回调里 push 的新元素不会被遍历；遍历到某个下标时才读取它的值，还没遍历到的元素被修改，读到的是新值，被删除就跳过
- **reduce 的初始值**：按参数个数判断有没有传，显式传 undefined 也算有初始值；没传就用第一个存在的元素作初始值，从它的下一个开始遍历；数组为空（或全是空位）又没传就抛 TypeError

### 为什么不能用箭头函数

方法通过 `arr.myMap(fn)` 调用，要靠 this 拿到 arr。箭头函数没有自己的 this，它的 this 由定义的位置决定（比如在 ES 模块顶层定义就是 undefined），和谁调用它无关，所以拿不到数组。

## 代码示例：手写 map、filter、reduce

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

// 用 defineProperty 挂上去，不可枚举，避免出现在 for...in 里
for (const [name, fn] of Object.entries({ myMap, myFilter, myReduce })) {
  Object.defineProperty(Array.prototype, name, { value: fn, writable: true, configurable: true })
}
```

测试，和原生方法对比：

```js
const sparse = [1, , 3]
console.log(sparse.myMap((x) => x * 2), sparse.map((x) => x * 2)) // 两个都是 [2, 空位, 6]
console.log(1 in sparse.myMap((x) => x * 2)) // false，空位保留
console.log([1, undefined, 3].myMap((x) => x ?? 0)) // [1, 0, 3]，undefined 不是空位

const arr = [1, 2, 3]
const seen = []
arr.myMap((x, i, a) => {
  if (i === 0) a.push(99) // 遍历中追加
  seen.push(x)
})
console.log(seen) // [1, 2, 3]，99 没有被遍历到

const ctx = { min: 2 }
console.log([1, 2, 3].myFilter(function (x) { return x >= this.min }, ctx)) // [2, 3]，thisArg 生效

console.log([, , 5, 6].myReduce((sum, x) => sum + x)) // 11，从第一个存在的元素 5 开始
console.log([].myReduce((sum, x) => sum + x, 0)) // 0
try {
  [].myReduce((sum, x) => sum + x)
} catch (err) {
  console.log(err instanceof TypeError) // true，和原生一样
}
console.log(Object.keys(Array.prototype).includes('myMap')) // false，不可枚举
```

## 面试官可能追问

::: details 为什么实际项目里不要修改内置原型？
原型是全局共享的：和其他库定义的同名方法会互相覆盖；以后标准新增了同名方法，行为不一致还会出问题。历史上 MooTools 在 `Array.prototype` 上加过自己的 flatten、contains，标准为了不弄坏用它的网站，只好把新方法改名为 flat、includes。需要工具函数时写成普通函数 `map(arr, fn)`，缺少的标准方法交给 core-js 这类成熟的 polyfill。
:::

::: details forEach 里 return 能跳出循环吗？
不能。return 只结束当前这一次回调，forEach 会继续遍历下一个元素，也无法用 break。需要提前结束时用 `for...of` 加 break，或者用 some、every、find 这类会根据回调返回值提前停止的方法。
:::

::: details 怎么用 reduce 实现 map？
初始值传一个空数组，每一步把回调的结果放进去：`arr.reduce((acc, x, i, a) => (acc.push(fn(x, i, a)), acc), [])`。这个写法会跳过空位，但结果里不会保留空位，结果的长度也可能和原数组不同；用展开写法 `[...acc, fn(x)]` 每一步都复制数组，复杂度会变成 O(n²)。
:::

## 易错点

- 用 `arr[i] !== undefined` 判断空位是错的，显式写的 undefined 也会被跳过，要用 `i in arr`
- reduce 用 `initialValue === undefined` 判断有没有传初始值，`reduce(fn, undefined)` 会被误当成没传
- 遍历条件写成 `i < arr.length`，回调里 push 元素会导致遍历次数变化，甚至死循环
