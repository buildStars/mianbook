---
difficulty: 2
tags: [手写题]
---

# 怎么判断两个对象深度相等？

::: tip 一句话回答
先用 `Object.is` 判断原始值和同一引用（它能让 NaN 等于 NaN）；都是对象时，先比原型，再按类型处理：Date 比时间戳，RegExp 比 source 和 flags，Map、Set 比大小和内容，数组和普通对象比**键的数量**再**递归比较每个键的值**。循环引用用 **WeakMap 记录正在比较的对象对**，再次遇到同一对就直接返回 true。还要说明取舍：是否比较原型、Symbol 键、不可枚举属性，各个库的选择并不一样。项目里直接用 lodash 的 `isEqual` 这类现成实现。
:::

## 详细解析

### 比较的顺序

1. `Object.is(a, b)` 为 true 直接相等，覆盖原始值、同一个引用和 NaN
2. 有一方不是对象（或是 null）就不相等
3. 原型不同就不相等：`[]` 和 `{}` 都没有可枚举的键，不比原型会被误判为相等
4. 特殊类型单独处理：Date、RegExp 的内容不在可枚举属性上，按普通对象比较会全部"相等"
5. 数组和普通对象：键的数量相同，并且 a 的每个键在 b 里都是自有属性、值也深度相等

### 循环引用

`x.self = x` 这样的结构，递归会无限下去。比较前把 (a, b) 这一对记下来，之后再遇到同一对，说明正在比较中，先当作相等返回；如果它们其实不相等，别的属性会比出差异，最终结果仍然是 false。要记的是"一对"而不是单个对象：同一个 a 可能在不同位置和不同的对象比较。

这样做有一个取舍：自引用的 `x.self = x`，和互相引用的 `y.self = z`、`z.self = y`（其余属性都相同）会被判为相等，因为一直展开下去结构完全一样。lodash 的 `isEqual` 和 Node 的 `util.isDeepStrictEqual` 还要求引用关系的形状一致，会判为不等。

### 取舍：哪些东西算"相等"

没有唯一正确的标准，常见实现的选择就不同（以下结果用 node 实测）：

| 情况 | 本文实现 | lodash `isEqual` | Node `util.isDeepStrictEqual` |
| --- | --- | --- | --- |
| `0` 和 `-0` | 不等 | 相等 | 不等 |
| `{}` 和 `Object.create(null)` | 不等 | 相等 | 不等 |
| `[1, , 3]` 和 `[1, undefined, 3]` | 不等 | 相等 | 不等 |
| 两个 Set，各含一个内容相同的对象 | 不等 | 相等 | 相等 |
| 只有 Symbol 键的值不同 | 相等 | 不等 | 不等 |
| 只有不可枚举属性不同 | 相等 | 相等 | 相等 |

面试时说清楚自己的选择即可。比较 Symbol 键可以把 `Object.keys` 换成 `Reflect.ownKeys` 再过滤出可枚举的键。

## 代码示例：手写 deepEqual

```js
function deepEqual(a, b, seen = new WeakMap()) {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false

  // 循环引用：记录正在比较的 (a, b)，同一对再次出现就先当作相等
  let compared = seen.get(a)
  if (compared?.has(b)) return true
  if (!compared) seen.set(a, (compared = new WeakSet()))
  compared.add(b)

  if (a instanceof Date) return Object.is(a.getTime(), b.getTime())
  if (a instanceof RegExp) return a.source === b.source && a.flags === b.flags
  if (a instanceof Map) {
    if (a.size !== b.size) return false
    for (const [key, value] of a) {
      if (!b.has(key) || !deepEqual(value, b.get(key), seen)) return false // 键按引用查找，值深度比较
    }
    return true
  }
  if (a instanceof Set) {
    if (a.size !== b.size) return false
    for (const value of a) if (!b.has(value)) return false // 对象元素要求是同一个引用
    return true
  }
  if (Array.isArray(a) && a.length !== b.length) return false // new Array(3) 和 [] 都没有键，要单独比长度
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key], seen))
}
```

测试：

```js
console.log(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })) // true
console.log(deepEqual(NaN, NaN), deepEqual(0, -0)) // true false
console.log(deepEqual([], {}), deepEqual([1, , 3], [1, undefined, 3])) // false false
console.log(deepEqual({ a: undefined }, { b: undefined })) // false，键不同
console.log(deepEqual(new Array(3), [])) // false，长度不同
console.log(deepEqual(new Date(0), new Date(0)), deepEqual(/a/g, /a/i)) // true false
console.log(deepEqual(new Map([['k', { v: 1 }]]), new Map([['k', { v: 1 }]]))) // true
console.log(deepEqual(new Set([1, 2]), new Set([2, 1]))) // true，Set 不看顺序

const x = { name: 'x' }
x.self = x
const y = { name: 'x' }
y.self = y
console.log(deepEqual(x, y)) // true，循环引用不会爆栈
y.name = 'y'
console.log(deepEqual(x, y)) // false
```

## 面试官可能追问

::: details Set 里的对象、Map 的对象键怎么按内容比较？
`has` 按 SameValueZero 查找，对象只能找到同一个引用。要按内容比较，就对 a 的每个元素，在 b 里找一个还没被匹配过、并且深度相等的元素，找不到就不相等。lodash 就是这样处理的，代价是复杂度变成 O(n²)，所以上面的实现选择了按引用查找。
:::

::: details 用 JSON.stringify 比较两个对象行不行？
只适合键顺序固定的纯数据，否则会出错：`{ a: 1, b: 2 }` 和 `{ b: 2, a: 1 }` 序列化结果不同；值为 undefined 和函数的属性被丢弃，`{ a: undefined }` 和 `{}` 会被判为相等；NaN 变成 null；Date 变成字符串，Map、Set 都变成 `{}`；遇到循环引用直接抛错。
:::

::: details 深比较的性能怎么样？React 为什么用浅比较？
深比较要遍历两个对象的全部内容，复杂度和数据量成正比，数据大或调用频繁时代价很高。React 的 memo、useEffect 依赖都只比较引用或第一层，是因为它约定数据不可变：内容变了就创建新对象，比较引用就够了，又快又准。深比较更适合测试断言、表单"是否有修改"这类低频场景。
:::

## 易错点

- 只检查 a 的键在 b 里是否相等，不比较键的数量，`{ a: 1 }` 和 `{ a: 1, b: 2 }` 会被判为相等
- 不比原型、不处理 Date 和 RegExp，`[]` 和 `{}`、两个不同的日期都会被判为相等
- 没处理的类型会按普通对象比较可枚举键，比如 `new Number(1)` 和 `new Number(2)` 在上面的实现里是相等的，TypedArray、Error 也要单独加分支
