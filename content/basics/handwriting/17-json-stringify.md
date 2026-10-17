---
difficulty: 3
tags: [手写题, 输出题]
---

# 手写 JSON.stringify：要处理哪些特殊值和循环引用？

::: tip 一句话回答
按类型分派递归：`null`、布尔、字符串、有限数字照常输出，**NaN 和 Infinity 变成 null**；**undefined、函数、Symbol 在对象里被跳过，在数组里变成 null，单独序列化时返回 undefined**；**BigInt 直接抛 TypeError**。处理对象前先调用它的 **toJSON**（Date 就是靠它变成 ISO 字符串），再交给 replacer。**循环引用**用一个记录当前递归路径的栈来检测，命中就抛 TypeError。replacer 可以是函数（改值）或数组（白名单），space 控制缩进，最多 10 个字符。
:::

## 详细解析

### 各类型的规则

| 值 | 作为对象属性 | 作为数组元素 | 单独序列化 |
| --- | --- | --- | --- |
| `undefined`、函数、Symbol | 整个属性被跳过 | `null` | 返回 `undefined`（不是字符串） |
| `NaN`、`Infinity`、`-Infinity` | `null` | `null` | `"null"` |
| BigInt | 抛 TypeError | 抛 TypeError | 抛 TypeError |
| Date | 调 toJSON，变 ISO 字符串 | 同左 | 同左 |
| Map、Set、RegExp、Error | `{}`，只序列化自身可枚举属性 | 同左 | 同左 |
| `new String('x')` 这类包装对象 | 拆箱成原始值 | 同左 | 同左 |

对象只序列化**自身可枚举的字符串键**，Symbol 键会被忽略。这些规则正是"用 JSON 做深拷贝"会丢数据的原因，见 [深拷贝](/basics/javascript/10-deep-clone)。

### 处理一个值的顺序

1. 值有 toJSON 方法，先调用，参数是当前的 key
2. replacer 是函数，用 `replacer.call(holder, key, value)` 替换值，this 是所在的父对象
3. 包装对象拆箱
4. 按类型输出；对象和数组递归处理子项

最外层值被包进 `{ '': value }` 再处理，所以 replacer 第一次被调用时 key 是空字符串，这和原生行为一致。

### 循环引用检测

用一个栈记录**当前递归路径**上的对象：进入对象时压栈，处理完出栈。遇到的对象已经在栈里，说明自己引用了祖先，就抛错。不能用一个只增不减的 Set 记录"见过的对象"，否则 `{ a: shared, b: shared }` 这种同一对象被引用两次但没有成环的情况会被误判。

## 代码示例：手写 JSON.stringify

```js
const ESC = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' }
const quote = (s) =>
  '"' + s.replace(/["\\\u0000-\u001f]/g, (c) => ESC[c] || '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '"'

function stringify(value, replacer, space) {
  const indent = typeof space === 'number' ? ' '.repeat(Math.min(10, space))
    : typeof space === 'string' ? space.slice(0, 10) : ''
  const stack = [] // 当前递归路径上的对象，用来发现循环引用

  // 返回 undefined 表示"这个值不能序列化"，由调用方决定跳过还是写 null
  function ser(holder, key, gap) {
    let v = holder[key]
    if (v !== null && (typeof v === 'object' || typeof v === 'bigint') && typeof v.toJSON === 'function') v = v.toJSON(key)
    if (typeof replacer === 'function') v = replacer.call(holder, key, v)
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
    const inner = gap + indent
    const wrap = (parts, open, close) => {
      if (parts.length === 0) return open + close
      if (!indent) return open + parts.join(',') + close
      return `${open}\n${inner}${parts.join(`,\n${inner}`)}\n${gap}${close}`
    }
    let out
    if (Array.isArray(v)) {
      // 数组里不能序列化的元素写成 null，保持下标不变
      out = wrap(v.map((_, i) => ser(v, i, inner) ?? 'null'), '[', ']')
    } else {
      const keys = Array.isArray(replacer) ? replacer.map(String) : Object.keys(v)
      const parts = []
      for (const k of keys) {
        const s = ser(v, k, inner)
        if (s !== undefined) parts.push(quote(k) + (indent ? ': ' : ':') + s) // 对象里直接跳过
      }
      out = wrap(parts, '{', '}')
    }
    stack.pop() // 出栈：同一个对象被引用两次不算循环
    return out
  }
  return ser({ '': value }, '', '')
}

stringify({ a: undefined, b: () => {}, c: Symbol('s'), d: 1 }) // '{"d":1}'
stringify([undefined, () => {}, NaN, -Infinity]) // '[null,null,null,null]'
stringify({ date: new Date(0) }) // '{"date":"1970-01-01T00:00:00.000Z"}'
stringify(undefined) // undefined
stringify({ a: 1, b: 2, c: 3 }, ['a', 'c']) // '{"a":1,"c":3}'
stringify({ a: 1, b: { c: 2 } }, null, 2) // 和原生一样的两空格缩进
const loop = { name: 'a' }
loop.self = loop
stringify(loop) // TypeError: Converting circular structure to JSON
stringify({ n: 1n }) // TypeError: Do not know how to serialize a BigInt
```

上面的用例和原生 `JSON.stringify` 逐一对比过，输出相同。简化之处：数组 replacer 没有去重，也没处理 Proxy 等特殊对象。

## 面试官可能追问

::: details BigInt 真的没法序列化吗？
默认没法，但它会先查 toJSON。给 `BigInt.prototype.toJSON` 定义一个返回字符串的方法，`JSON.stringify({ n: 1n })` 就能得到 `{"n":"1"}`。这会改全局原型，项目里更稳妥的做法是用 replacer 把 BigInt 转成字符串，反序列化时再用 reviver 转回来。
:::

::: details 循环引用的对象想序列化怎么办？
用 replacer 配合 WeakSet，遇到见过的对象返回 `"[Circular]"` 之类的占位符，常用于打日志。要能还原结构，就得用专门的格式记录引用关系，例如把重复对象替换成路径引用，或者改用支持循环引用的结构化克隆（`structuredClone`）。
:::

::: details 对象属性的输出顺序是怎样的？
和 `Object.keys` 一致：整数形式的键按数值升序排在前面，其他字符串键按插入顺序。所以 `{ b: 1, 2: 1, a: 1, 1: 1 }` 输出时 1 和 2 在最前。用 JSON 字符串比较两个对象是否相等不可靠，原因之一就是顺序，见 [深度相等](/basics/handwriting/12-deep-equal)。
:::

## 易错点

- 把对象和数组里的 undefined 处理成一样：对象里跳过，数组里写 null
- `JSON.stringify(undefined)` 返回的是 undefined，不是字符串 `"undefined"`
- 循环检测用只增不减的集合，把共享引用误判成循环
- 忘了先调用 toJSON，Date 被序列化成 `{}`
