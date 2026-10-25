---
title: 手写 lodash 的 get 和 set
---

## 要求

实现 lodash 风格的 `get(obj, path, defaultValue)` 和 `set(obj, path, value)`。

路径 `path` 有两种写法：

- 字符串：点号分隔的键 `a.b`、方括号里的下标 `a[0]`、方括号里带引号的键 `a["c.d"]` 或 `a['c.d']`（键本身含点号时这样写），可以混着用，比如 `'a[0].b["c.d"]'`
- 数组：每一项就是一个键，不再解析，比如 `['a', '0', 'x.y']`

**`get(obj, path, defaultValue)`**

- 按路径逐层读取，中途遇到 `null` 或 `undefined` 就返回 `defaultValue`，不报错
- 只有最终结果是 `undefined` 才返回 `defaultValue`；`null`、`0`、`''`、`false` 都原样返回

**`set(obj, path, value)`**

- 按路径赋值，直接修改 `obj` 并返回它
- 中间层不存在或者是原始值（字符串、数字等）时新建：下一个键是数组下标（`0` 或不以 0 开头的正整数，`'01'` 不算）就建数组，否则建对象；已经是对象的中间层保留
- 路径里有 `__proto__`、`constructor`、`prototype` 任何一个时抛出错误，并且不做任何修改（防止原型污染）

## 提示

- 先写一个 `toPath(path)` 把路径解析成键数组，get 和 set 都用它；数组路径直接复制一份返回
- 用正则加 `matchAll` 依次匹配三种片段：不含 `.`、`[`、`]` 的普通键，`[数字]`，引号括起来的 `["..."]` 或 `['...']`；用捕获组取出下标和引号里的内容
- get 最后用 `=== undefined` 判断要不要返回默认值，不能用 `??` 或 `||`，否则 `null`、`0` 也会被替换
- set 先检查全部键再赋值；判断中间层是不是对象可以用 `Object(x) !== x`，判断下标可以用正则 `^(0|[1-9]\d*)$`

## 起始代码

```js
function get(obj, path, defaultValue) {
  // 返回路径上的值，结果是 undefined 时返回 defaultValue
}

function set(obj, path, value) {
  // 按路径赋值，返回 obj
}
```

## 测试

```js
const data = { a: [{ b: { c: 3 } }], n: null, zero: 0, empty: '', no: false, u: undefined, 'x.y': 1, q: { 'c.d': 'dot' } }

test('get 按字符串路径读取，支持点号和方括号下标', () => {
  expect(get(data, 'a[0].b.c')).toBe(3)
  expect(get(data, 'a.0.b.c')).toBe(3)
  expect(get(data, 'a[0].b')).toEqual({ c: 3 })
})

test('get 的路径可以是数组，每一项就是一个键', () => {
  expect(get(data, ['a', '0', 'b', 'c'])).toBe(3)
  expect(get(data, ['x.y'])).toBe(1)
})

test('get 支持方括号里带引号的键', () => {
  expect(get(data, '["x.y"]')).toBe(1)
  expect(get(data, "q['c.d']")).toBe('dot')
  expect(get(data, 'q["c.d"].length')).toBe(3)
})

test('get 中途遇到 null 或 undefined 返回默认值，不报错', () => {
  expect(get(data, 'a[1].b.c', 'def')).toBe('def')
  expect(get(data, 'n.x', 'def')).toBe('def')
  expect(get(null, 'a.b', 'def')).toBe('def')
  expect(get(data, 'missing.deep')).toBeUndefined()
})

test('只有结果是 undefined 才用默认值', () => {
  expect(get(data, 'n', 'def')).toBeNull()
  expect(get(data, 'zero', 'def')).toBe(0)
  expect(get(data, 'empty', 'def')).toBe('')
  expect(get(data, 'no', 'def')).toBe(false)
  expect(get(data, 'u', 'def')).toBe('def')
  expect(get(data, 'missing', 'def')).toBe('def')
})

test('set 自动创建中间层：下一个键是下标就建数组，否则建对象', () => {
  const obj = {}
  expect(set(obj, 'list[0].name', 'Tom')).toBe(obj)
  expect(Array.isArray(obj.list)).toBe(true)
  expect(obj.list[0]).toEqual({ name: 'Tom' })
  set(obj, 'user.tags[1]', 'vip')
  expect(Array.isArray(obj.user.tags)).toBe(true)
  expect(obj.user.tags).toHaveLength(2)
  expect(obj.user.tags[1]).toBe('vip')
  set(obj, 'codes.01', 'x') // '01' 不是下标
  expect(Array.isArray(obj.codes)).toBe(false)
  expect(obj.codes).toEqual({ '01': 'x' })
})

test('set 保留已有的中间层，原始值的中间层换成对象', () => {
  const obj = { a: { keep: 1 }, s: 'text' }
  set(obj, 'a.b', 2)
  expect(obj.a).toEqual({ keep: 1, b: 2 })
  set(obj, 'a.keep', 9)
  expect(obj.a.keep).toBe(9)
  set(obj, 's.len', 4)
  expect(obj.s).toEqual({ len: 4 })
  set(obj, ['k', 'x.y'], 5) // 数组路径
  expect(obj.k).toEqual({ 'x.y': 5 })
})

test('set 拒绝 __proto__、constructor、prototype，不做任何修改', () => {
  try {
    expect(() => set({}, '__proto__.polluted', true)).toThrow()
    expect(() => set({}, 'constructor.prototype.polluted', true)).toThrow()
    expect(() => set({}, ['__proto__', 'polluted'], true)).toThrow()
    expect({}.polluted).toBeUndefined()
    const obj = {}
    expect(() => set(obj, 'a.b.__proto__.polluted', true)).toThrow()
    expect(obj).toEqual({})
  } finally {
    delete Object.prototype.polluted // 实现有漏洞时把原型恢复干净
  }
})
```

## 参考答案

```js
// 'a[0].b["c.d"]' -> ['a', '0', 'b', 'c.d']
function toPath(path) {
  if (Array.isArray(path)) return [...path]
  const keys = []
  for (const m of String(path).matchAll(/[^.[\]]+|\[(\d+)\]|\[(["'])(.*?)\2\]/g)) {
    keys.push(m[1] ?? m[3] ?? m[0]) // 下标、引号里的内容、普通键，三选一
  }
  return keys
}

function get(obj, path, defaultValue) {
  let cur = obj
  for (const key of toPath(path)) {
    if (cur == null) return defaultValue // 中途遇到 null / undefined 就停下，不会报错
    cur = cur[key]
  }
  return cur === undefined ? defaultValue : cur // null 是"有值"，原样返回
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const isIndex = (key) => /^(0|[1-9]\d*)$/.test(key) // '01' 不算下标

function set(obj, path, value) {
  const keys = toPath(path)
  if (keys.some((key) => UNSAFE_KEYS.has(key))) throw new Error(`不安全的路径：${path}`)
  let cur = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    // 中间层不存在或是原始值就新建：下一个键是下标建数组，否则建对象
    if (Object(cur[key]) !== cur[key]) cur[key] = isIndex(keys[i + 1]) ? [] : {}
    cur = cur[key]
  }
  cur[keys[keys.length - 1]] = value
  return obj
}
```
