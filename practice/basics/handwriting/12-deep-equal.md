---
title: 手写 deepEqual
---

## 要求

实现 `deepEqual(a, b)`：判断两个值是否深度相等，返回 `true` 或 `false`。规则：

- 先用 `Object.is` 比较，相等就是相等：覆盖原始值和同一个引用，所以 `NaN` 等于 `NaN`，`0` 不等于 `-0`
- 否则两个都必须是对象（不是 `null`）才继续比，有一个不是就不相等
- 原型不同就不相等：`[]` 和 `{}`、`{}` 和 `Object.create(null)`、类的实例和内容相同的普通对象都不相等
- Date 比较时间戳；RegExp 比较 `source` 和 `flags`
- Map：大小相同，`a` 的每个键 `b` 里都有（用 `has` 查找），对应的值深度相等
- Set：大小相同，`a` 的每个元素 `b` 里都有（用 `has` 查找，不看顺序）
- 数组和普通对象：比较自有的可枚举键（`Object.keys`）。键的数量相同，`a` 的每个键也是 `b` 的自有属性，并且值深度相等。数组还要长度相同：`new Array(3)` 和 `[]` 不相等，`[1, , 3]` 和 `[1, undefined, 3]` 也不相等
- 支持循环引用：`x.self = x` 和 `y.self = y`（其他属性也相同）相等，不能爆栈

## 提示

- 按顺序判断：`Object.is` → 是不是都是对象 → 原型（`Object.getPrototypeOf`）→ Date、RegExp、Map、Set → 数组长度 → 键
- 比较键时先比数量再逐个递归；用 `Object.hasOwn(b, key)` 确认 `b` 自己有这个键，否则 `{ a: undefined }` 和 `{ b: undefined }` 会被判为相等
- 循环引用：用 `seen` 记下"正在比较的 (a, b) 这一对"（WeakMap 的值放一个 WeakSet），递归时传下去，同一对再次出现就先当作相等

## 起始代码

```js
function deepEqual(a, b, seen = new WeakMap()) {
  // 返回 true 或 false；seen 给递归时用，外部调用只传 a 和 b
}
```

## 测试

```js
test('原始值和同一个引用用 Object.is 比较', () => {
  expect(deepEqual(1, 1)).toBe(true)
  expect(deepEqual('a', 'a')).toBe(true)
  expect(deepEqual(1, '1')).toBe(false)
  expect(deepEqual(NaN, NaN)).toBe(true)
  expect(deepEqual(0, -0)).toBe(false)
  expect(deepEqual(null, null)).toBe(true)
  expect(deepEqual(null, undefined)).toBe(false)
  expect(deepEqual(null, {})).toBe(false)
  const obj = { a: 1 }
  expect(deepEqual(obj, obj)).toBe(true)
})

test('嵌套的对象和数组按内容比较', () => {
  expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true)
  expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false)
  expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
  expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false)
})

test('键的数量或名字不同就不相等', () => {
  expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false)
  expect(deepEqual({ a: undefined }, { b: undefined })).toBe(false)
  expect(deepEqual({ a: undefined }, {})).toBe(false)
})

test('原型不同就不相等', () => {
  class Point {
    constructor(x) {
      this.x = x
    }
  }
  expect(deepEqual([], {})).toBe(false)
  expect(deepEqual({}, Object.create(null))).toBe(false)
  expect(deepEqual(new Point(1), { x: 1 })).toBe(false)
  expect(deepEqual(new Point(1), new Point(1))).toBe(true)
})

test('数组要比较长度，空位和 undefined 不一样', () => {
  expect(deepEqual(new Array(3), [])).toBe(false)
  expect(deepEqual([1, , 3], [1, undefined, 3])).toBe(false)
  expect(deepEqual([1, undefined, 3], [1, , 3])).toBe(false)
  expect(deepEqual([1, , 3], [1, , 3])).toBe(true)
})

test('Date 比较时间戳，RegExp 比较 source 和 flags', () => {
  expect(deepEqual(new Date(0), new Date(0))).toBe(true)
  expect(deepEqual(new Date(0), new Date(1))).toBe(false)
  expect(deepEqual(/a/g, /a/g)).toBe(true)
  expect(deepEqual(/a/g, /a/i)).toBe(false)
  expect(deepEqual(/a/, /b/)).toBe(false)
  expect(deepEqual(new Date(0), {})).toBe(false)
})

test('Map 和 Set 比较内容', () => {
  expect(deepEqual(new Map([['k', { v: 1 }]]), new Map([['k', { v: 1 }]]))).toBe(true)
  expect(deepEqual(new Map([['k', { v: 1 }]]), new Map([['k', { v: 2 }]]))).toBe(false)
  expect(deepEqual(new Map([['k', 1]]), new Map([['j', 1]]))).toBe(false)
  expect(deepEqual(new Map([['k', 1]]), new Map([['k', 1], ['j', 2]]))).toBe(false)
  expect(deepEqual(new Set([1, 2]), new Set([2, 1]))).toBe(true)
  expect(deepEqual(new Set([1, 2]), new Set([1, 3]))).toBe(false)
  expect(deepEqual(new Set([1]), new Set([1, 2]))).toBe(false)
})

test('循环引用不会爆栈', () => {
  const x = { name: 'x' }
  x.self = x
  const y = { name: 'x' }
  y.self = y
  expect(deepEqual(x, y)).toBe(true)
  y.name = 'y'
  expect(deepEqual(x, y)).toBe(false)
  const p = [1]
  p.push(p)
  const q = [1]
  q.push(q)
  expect(deepEqual(p, q)).toBe(true)
})
```

## 参考答案

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
