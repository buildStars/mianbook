---
difficulty: 2
tags: [原理]
---

# 什么是迭代器协议？Generator 函数有什么用？

::: tip 一句话回答
**迭代器协议**规定：一个对象有 `next()` 方法，每次返回 `{ value, done }`，它就是迭代器；对象有 `[Symbol.iterator]()` 方法、能返回迭代器，它就是**可迭代对象**。`for...of`、展开、数组解构、`Array.from`、`Promise.all` 都靠这个协议工作。**Generator** 是写迭代器的语法糖：`function*` 里用 `yield` 暂停，外部 `next()` 恢复，适合实现**惰性序列**和可暂停的流程。
:::

## 详细解析

### 两个协议

| 协议 | 要求 | 例子 |
| --- | --- | --- |
| 可迭代协议 | 有 `[Symbol.iterator]()`，返回一个迭代器 | Array、String、Map、Set、arguments、NodeList |
| 迭代器协议 | 有 `next()`，返回 `{ value, done }` | `arr[Symbol.iterator]()` 的返回值 |

普通对象 `{}` 默认**不可迭代**，所以 `for (const x of {})` 会报错。

手写一个可迭代对象：

```js
const range = {
  from: 1,
  to: 3,
  [Symbol.iterator]() {
    let cur = this.from
    const to = this.to
    return {
      next: () => (cur <= to ? { value: cur++, done: false } : { value: undefined, done: true }),
    }
  },
}

console.log([...range]) // [1, 2, 3]
const [a, b] = range // a = 1, b = 2，解构也走迭代器
```

`for...of` 的过程：调用 `range[Symbol.iterator]()` 拿到迭代器，反复调 `next()`，直到 `done: true`。提前 `break` 时，如果迭代器有 `return()` 方法会被调用，用来做清理。

### Generator 基本用法

调用 `function*` 不会执行函数体，而是返回一个生成器对象，它**既是迭代器也是可迭代对象**。

```js
function* gen() {
  const x = yield 1 // 暂停在这里，x 是下一次 next 传入的值
  console.log('got', x)
  yield x * 2
  return 'end'
}

const g = gen()
g.next('ignored') // { value: 1, done: false }，第一次 next 的参数没人接收
g.next(10) // 打印 got 10，返回 { value: 20, done: false }
g.next() // { value: 'end', done: true }
g.next() // { value: undefined, done: true }
```

三个控制方法：

- `next(v)`：恢复执行，`v` 作为上一个 `yield` 表达式的结果
- `return(v)`：直接结束，返回 `{ value: v, done: true }`；有 `finally` 会先执行
- `throw(err)`：在暂停处抛出错误，函数内能用 `try/catch` 接住

### 用途一：惰性序列

```js
function* naturals() {
  let n = 0
  while (true) yield n++ // 无限序列，但用多少算多少
}

function* take(iter, k) {
  for (const v of iter) {
    if (k-- <= 0) return
    yield v
  }
}

console.log([...take(naturals(), 5)]) // [0, 1, 2, 3, 4]
```

值是按需计算的，不会先生成一个大数组。处理大数据、分页拉取、树的遍历（配合 `yield*` 递归委托）都很合适。

### 用途二：可暂停的流程

Generator 能"暂停-恢复"，配合一个自动调用 `next` 的执行器，就能把异步写成同步的样子，这就是 async/await 的前身，原理见 [async/await](/basics/javascript/12-async-await)。Redux-saga 也是基于 Generator 的。

## 面试官可能追问

::: details 为什么第一次调用 next 传参没用？
第一次 `next()` 是让函数从开头跑到第一个 `yield`，此时还没有"上一个 yield"来接收值。想给初始值，直接作为 Generator 函数的参数传进去。
:::

::: details 怎么让普通对象支持 for...of？
给它加 `[Symbol.iterator]` 方法。最省事的写法是用 Generator：`*[Symbol.iterator]() { yield* Object.entries(this) }`。也可以不改对象，直接 `for (const [k, v] of Object.entries(obj))`。
:::

::: details 异步迭代器是什么？
协议换成 `[Symbol.asyncIterator]()`，`next()` 返回 Promise。用 `for await...of` 消费，用 `async function*` 生成。Node.js 的可读流、分页接口的逐页读取都适合这样写。
:::

## 易错点

- 生成器对象只能遍历一次，遍历完再展开得到空数组；可迭代对象每次调用 `[Symbol.iterator]()` 是否返回新迭代器取决于实现
- `return` 的值不会出现在 `for...of` 和展开的结果里，因为那时 `done` 已经是 `true`
- 普通对象不可迭代，但能 `Object.keys` 遍历，不要把"可枚举"和"可迭代"混为一谈
