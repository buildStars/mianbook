---
difficulty: 1
tags: [高频]
---

# for...in、for...of、forEach 有什么区别？

::: tip 一句话回答
**for...in** 遍历对象的**可枚举属性键**（包括原型链上继承的），拿到的是字符串，适合遍历普通对象。**for...of** 走**迭代器协议**，拿到的是**值**，能遍历数组、字符串、Map、Set，支持 `break` 和 `await`。**forEach** 是数组方法，**不能中途跳出**，也**不会等待 async 回调**。遍历数组优先用 for...of 或 forEach，不要用 for...in。
:::

## 详细解析

### 三者对比

| | for...in | for...of | forEach |
| --- | --- | --- | --- |
| 拿到什么 | 键（字符串） | 值 | 值、下标、原数组 |
| 依赖什么 | 可枚举属性 | `Symbol.iterator` | `Array.prototype.forEach` |
| 原型链属性 | 会遍历 | 不涉及 | 不涉及 |
| 普通对象 | 能 | 不能（不可迭代） | 不能 |
| `break` / `continue` | 能 | 能 | 不能 |
| 顺序 `await` | 能 | 能 | 不能 |
| 稀疏数组的空位 | 跳过 | 当 `undefined` 处理 | 跳过 |

### for...in 遍历数组的坑

```js
const arr = [10, 20]
arr.foo = 'bar'
Array.prototype.extra = 'x' // 某个库扩展了原型

for (const k in arr) console.log(k, typeof k)
// 0 string
// 1 string
// foo string
// extra string
```

三个问题：下标是**字符串**，`k + 1` 会变成字符串拼接；会遍历到**数组上的自定义属性**；会遍历到**原型链上的可枚举属性**。遍历对象时如果只要自身属性，用 `Object.keys(obj)` 或 `Object.entries(obj)`，或者在循环里用 `Object.hasOwn(obj, k)` 过滤。

### for...of 的适用范围

```js
for (const v of [10, 20]) console.log(v) // 10 20
for (const ch of 'hi') console.log(ch) // h i
for (const [k, v] of new Map([['a', 1]])) console.log(k, v) // a 1
for (const [i, v] of ['x', 'y'].entries()) console.log(i, v) // 需要下标时这样写
```

普通对象不可迭代，`for (const v of {})` 会报 TypeError，要配合 `Object.entries` 用。原理见 [迭代器协议](/basics/javascript/22-iterator-generator)。

### forEach 和 async

```js
async function run() {
  const res = []
  ;[1, 2, 3].forEach(async (n) => {
    await null
    res.push(n)
  })
  console.log(res.length) // 0，forEach 没等回调
}
```

forEach 只是同步地调用回调，回调返回的 Promise 被直接丢弃。要**按顺序**执行就用 `for...of` + `await`；要**并发**执行就用 `await Promise.all(arr.map(async ...))`，见 [Promise](/basics/javascript/11-promise)。

### 怎么提前结束

- for...in / for...of：`break`、`return`（在函数里）
- forEach：只能抛异常，不推荐。需要中断时换成 for...of，或者用 `some` / `every` / `find`，它们找到结果就停

## 面试官可能追问

::: details for...in 遍历对象的顺序是怎样的？
现代引擎对自身属性按规范顺序：先按数值升序排整数键，再按插入顺序排字符串键，Symbol 键不参与。原型链上的属性排在自身属性之后。依赖属性顺序的逻辑最好还是用数组或 Map。
:::

::: details 遍历时修改数组会怎样？
forEach 开始时就确定了遍历范围，新 push 的元素不会被访问到；遍历中删掉的、还没访问到的元素会被跳过。for...of 每次按当前下标读取，边遍历边 push 可能死循环。遍历时尽量不改原数组，或先拷贝一份。
:::

::: details 三种方式性能有区别吗？
传统 `for (let i = 0; ...)` 通常最快，for...of 和 forEach 在现代引擎里差距不大，绝大多数业务里不是瓶颈。for...in 要处理原型链和字符串键，遍历数组时最慢，这也是不用它遍历数组的原因之一。
:::

## 易错点

- for...in 拿到的数组下标是字符串，不是数字
- forEach 里的 `return` 只是跳过本次回调，相当于 `continue`，不会终止循环
- forEach 里写 `await` 不会让循环变成顺序执行，[手写数组方法](/basics/handwriting/10-array-methods) 时也要注意这点
