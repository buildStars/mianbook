---
title: 手写 JSON.stringify
---

## 要求

实现 `stringify(value)`，结果和 `JSON.stringify(value)` 一样（这里只练值的处理，不用支持 replacer 和 space 两个参数，输出里没有多余的空格）。

- `null`、布尔值、有限的数字照常输出；字符串加双引号，里面的 `"`、`\` 和控制字符要转义：`\n` `\r` `\t` `\b` `\f` 用简写，其余 U+0000～U+001F 的字符写成 `\u` 加四位小写十六进制（比如 `\u0001`）
- `NaN`、`Infinity`、`-Infinity` 输出 `null`
- `undefined`、函数、Symbol：在对象里整个属性跳过；在数组里写成 `null`；单独序列化时返回 `undefined`（不是字符串）
- 值有 `toJSON` 方法时先调用它（参数是所在的键名），再序列化它的返回值；`Date` 就是这样变成 ISO 字符串的
- 对象只输出自身可枚举的字符串键，顺序和 `Object.keys` 一样
- 遇到循环引用（对象引用了自己的祖先）抛 `TypeError`；同一个对象被引用多次但没有成环，照常输出
- BigInt 抛 `TypeError`

```js
stringify({ a: undefined, b: () => {}, d: [undefined, NaN] }) // '{"d":[null,null]}'
stringify({ date: new Date(0) }) // '{"date":"1970-01-01T00:00:00.000Z"}'
stringify(undefined) // undefined
```

## 提示

- 写一个递归函数按类型分派：原始值直接输出，数组和对象递归处理每一项；字符串转义用 `replace` 加替换函数，控制字符用 `charCodeAt` 转成十六进制再补足四位
- 让递归函数对"不能序列化"的值（undefined、函数、Symbol）返回 undefined，由调用方决定怎么办：对象里跳过这个属性，数组里写 `null`
- 先调用 toJSON 再判断类型，否则 Date 会被当成普通对象输出成 `{}`
- 循环引用：用一个栈记录当前递归路径上的对象，进入时压栈、处理完出栈，遇到已经在栈里的对象就抛错；只增不减的 Set 会把共享引用误判成循环

## 起始代码

```js
function stringify(value) {
  // 返回 JSON 字符串；整个值不能序列化时返回 undefined
}
```

## 测试

```js
test('基本类型、嵌套对象和数组的输出和原生一致', () => {
  const values = [null, true, false, 0, -12.5, 'hi', '', [], {}, [1, 'a', [null]], { a: 1, b: { c: [true, { d: 'x' }] }, e: {} }]
  for (const v of values) expect(stringify(v)).toBe(JSON.stringify(v))
})

test('字符串里的引号、反斜杠和控制字符要转义', () => {
  const s = '他说"你好"\\ 换行\n回车\r制表\t退格\b换页\f 其他\u0001\u001f'
  expect(stringify(s)).toBe(JSON.stringify(s))
  expect(stringify({ 'k"ey': s })).toBe(JSON.stringify({ 'k"ey': s }))
})

test('NaN 和 Infinity 输出 null', () => {
  expect(stringify({ a: NaN, b: Infinity, c: -Infinity })).toBe('{"a":null,"b":null,"c":null}')
  expect(stringify([NaN])).toBe('[null]')
  expect(stringify(Infinity)).toBe('null')
})

test('undefined、函数、Symbol 在对象里被跳过，在数组里变成 null', () => {
  expect(stringify({ a: undefined, b: () => {}, c: Symbol('s'), d: 1 })).toBe('{"d":1}')
  expect(stringify([undefined, () => {}, Symbol('s'), 1])).toBe('[null,null,null,1]')
})

test('单独序列化 undefined、函数、Symbol 返回 undefined 本身', () => {
  expect(stringify(undefined)).toBeUndefined()
  expect(stringify(() => {})).toBeUndefined()
  expect(stringify(Symbol('s'))).toBeUndefined()
})

test('先调用 toJSON，Date 输出 ISO 字符串', () => {
  const value = { date: new Date(0), custom: { toJSON: (key) => '键是 ' + key } }
  expect(stringify(value)).toBe('{"date":"1970-01-01T00:00:00.000Z","custom":"键是 custom"}')
  expect(stringify(new Date(0))).toBe('"1970-01-01T00:00:00.000Z"')
})

test('循环引用和 BigInt 抛出 TypeError', () => {
  const loop = { name: 'a', child: {} }
  loop.child.parent = loop
  expect(() => stringify(loop)).toThrow(TypeError)
  expect(() => stringify({ n: 1n })).toThrow(TypeError)
})

test('同一个对象被引用两次不算循环引用', () => {
  const shared = { x: 1 }
  expect(stringify({ a: shared, b: [shared, shared] })).toBe('{"a":{"x":1},"b":[{"x":1},{"x":1}]}')
})
```

## 参考答案

```js
const ESC = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' }
const quote = (s) =>
  '"' + s.replace(/["\\\u0000-\u001f]/g, (c) => ESC[c] || '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '"'

function stringify(value) {
  const stack = [] // 当前递归路径上的对象，用来发现循环引用

  // 返回 undefined 表示"这个值不能序列化"，由调用方决定跳过还是写 null
  function ser(holder, key) {
    let v = holder[key]
    if (v !== null && (typeof v === 'object' || typeof v === 'bigint') && typeof v.toJSON === 'function') v = v.toJSON(key)
    // 包装对象拆箱：new String('a') 当作 'a'
    if (v instanceof Number || v instanceof String || v instanceof Boolean) v = v.valueOf()

    if (v === null) return 'null'
    if (typeof v === 'boolean') return String(v)
    if (typeof v === 'string') return quote(v)
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null' // NaN、Infinity 变 null
    if (typeof v === 'bigint') throw new TypeError('Do not know how to serialize a BigInt')
    if (typeof v !== 'object') return undefined // undefined、函数、Symbol

    if (stack.includes(v)) throw new TypeError('Converting circular structure to JSON')
    stack.push(v)
    let out
    if (Array.isArray(v)) {
      // 数组里不能序列化的元素写成 null，保持下标不变
      out = '[' + Array.from(v, (_, i) => ser(v, String(i)) ?? 'null').join(',') + ']'
    } else {
      const parts = []
      for (const k of Object.keys(v)) {
        const s = ser(v, k)
        if (s !== undefined) parts.push(quote(k) + ':' + s) // 对象里直接跳过
      }
      out = '{' + parts.join(',') + '}'
    }
    stack.pop() // 出栈：同一个对象被引用两次不算循环
    return out
  }
  // 外面包一层 { '': value }，最外层的值也有"所在的键名"（空字符串）
  return ser({ '': value }, '')
}
```
