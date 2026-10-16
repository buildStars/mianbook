---
difficulty: 1
tags: [高频]
---

# 什么是类数组？类数组和数组有什么区别？怎么转成数组？

::: tip 一句话回答
类数组是**有 `length` 和数字下标、但原型链上没有 `Array.prototype`** 的对象，常见的有 `arguments`、`NodeList`、`HTMLCollection`。它能用下标读、能用 `length`，但没有 `map`、`filter` 这些方法。转成数组首选 **`Array.from`**，可迭代的类数组也能用**展开运算符**，老写法是 `Array.prototype.slice.call`。
:::

## 详细解析

### 类数组长什么样

```js
const al = { 0: 'a', 1: 'b', length: 2 }
console.log(Array.isArray(al)) // false
al.map // undefined，原型是 Object.prototype
```

判断标准只有两条：有非负整数的 `length`，元素按数字下标存放。它不是一种特定的类型，只是一种"形状"。

### 常见的类数组

| 对象 | 来源 | 是否可迭代 | 特点 |
| --- | --- | --- | --- |
| `arguments` | 普通函数内部 | 是 | 箭头函数没有，推荐用剩余参数 `...args` 替代 |
| `NodeList` | `querySelectorAll`、`childNodes` | 是 | 自带 `forEach`；`querySelectorAll` 返回的是静态的 |
| `HTMLCollection` | `children`、`getElementsByClassName` | 是 | **动态的**，DOM 变了它跟着变；没有 `forEach` |
| 字符串 | - | 是 | 只读，按 UTF-16 码元下标 |
| 自己写的 `{ length: 2 }` | - | 否 | 没有 `Symbol.iterator` |

### 和数组的区别

- 原型不同：数组继承 `Array.prototype`，类数组一般继承 `Object.prototype` 或自己的原型（如 `NodeList.prototype`）
- `length` 行为不同：数组的 `length` 会随下标赋值自动更新，给它赋小值会截断元素；类数组的 `length` 只是个普通属性
- `Array.isArray` 只认真数组

### 转成数组的几种方式

```js
const al = { 0: 'a', 1: 'b', length: 2 }

Array.from(al) // ['a', 'b']，只要有 length 就行
Array.prototype.slice.call(al) // ['a', 'b']，老写法
;[...al] // TypeError: al is not iterable

function f() {
  return [...arguments] // arguments 可迭代，展开没问题
}
f(1, 2) // [1, 2]
```

- **`Array.from`**：同时支持类数组和可迭代对象，最通用。第二个参数是映射函数，`Array.from({ length: 3 }, (_, i) => i * 2)` 得到 `[0, 2, 4]`，常用来生成序列
- **展开运算符**：走的是迭代器协议，只认可迭代对象，见 [迭代器协议](/basics/javascript/22-iterator-generator)
- **`slice.call`**：借用数组方法。数组方法大多是"通用的"，只依赖 `this.length` 和下标，所以能用在类数组上

### 不转换，直接借用数组方法

```js
const al = { 0: 'a', 1: 'b', length: 2 }
Array.prototype.map.call(al, (x) => x.toUpperCase()) // ['A', 'B']
```

借用的原理就是 `call` 改变 `this`，见 [call、apply、bind](/basics/javascript/05-call-apply-bind)。只用一次时这样写省一次拷贝；要连续调用多个数组方法时，还是先转成数组更清楚。

## 面试官可能追问

::: details 为什么 arguments 不直接设计成数组？
历史原因，早期 JS 没考虑这么多。非严格模式下 `arguments` 还和形参有联动：改 `arguments[0]` 会同步改第一个形参。现在写新代码直接用剩余参数 `...args`，它就是真数组，没有这些怪行为。
:::

::: details NodeList 和 HTMLCollection 遍历时有什么坑？
`HTMLCollection` 是动态的。一边遍历 `parent.children` 一边删除子元素，`length` 会实时变小，下标跟着错位，结果会漏删一半。先用 `Array.from` 拍一个快照再遍历就没问题。`querySelectorAll` 返回静态 `NodeList`，不受影响。
:::

::: details 怎么判断一个对象是不是类数组？
没有内置方法，一般手写：对象不为 null、不是函数、`length` 是非负整数且不超过 `Number.MAX_SAFE_INTEGER`。函数也有 `length`（形参个数），所以要排除；`window` 也有 `length`（iframe 数量），视场景排除。
:::

## 易错点

- 展开运算符不是万能的：`[...{ length: 2 }]` 会报错，`Array.from` 才能处理不可迭代的类数组
- `HTMLCollection` 没有 `forEach`，`NodeList` 有，别记混
- 箭头函数里没有自己的 `arguments`，读到的是外层普通函数的
