---
difficulty: 2
tags: [手写题]
---

# 手写 lodash 的 get 和 set：路径解析要注意什么？

::: tip 一句话回答
核心是先把 `'a[0].b.c'` 这样的路径**解析成键数组** `['a', '0', 'b', 'c']`，再逐层访问。get 中途遇到 null 或 undefined 就返回默认值，而且**只有结果是 undefined 才用默认值**，null 会原样返回；set 遇到不存在的中间层要自动创建，**下一个键是数字就建数组**，否则建对象。set 还必须拒绝 `__proto__`、`constructor`、`prototype` 这类键，否则会改到对象的原型上，造成原型污染。
:::

## 详细解析

### 路径解析

路径里有三种片段：点号后的普通键 `a`、方括号里的下标 `[0]`、带引号的键 `["c.d"]`（字符串路径里，键本身含点号时只能这样写）。用一个正则依次匹配：

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
```

路径也可以直接传数组，适合键是运行时拿到的、可能包含任意字符的场景。

### get：只有 undefined 才用默认值

```js
function get(obj, path, defaultValue) {
  let cur = obj
  for (const key of toPath(path)) {
    if (cur == null) return defaultValue // 中途遇到 null / undefined 就停下，不会报错
    cur = cur[key]
  }
  return cur === undefined ? defaultValue : cur // null 是"有值"，原样返回
}
```

这是 lodash 的约定：属性不存在和值为 undefined 都返回默认值，值为 null 则返回 null。不能写成 `cur ?? defaultValue`，那样 null 也会被替换。

### set：自动创建中间层，拒绝危险的键

```js
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const isIndex = (key) => /^(0|[1-9]\d*)$/.test(key) // '001' 不算下标

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

为什么要拦这三个键：路径如果以 `__proto__` 开头，`cur` 走到的是 `Object.prototype`；`constructor.prototype` 也会绕到同一个地方。后面的赋值就落在了所有普通对象共享的原型上，所有对象都会"多出"这个属性，这就是原型污染。路径来自用户输入（表单字段名、查询参数）时尤其危险，原理和完整的防御见 [原型污染是什么？怎么防御？](/basics/web-security/06-prototype-pollution)。lodash 也修复过这类漏洞，现在它的 set 在路径里遇到这三个键时会停止赋值、直接返回原对象，不报错。

### 和可选链、空值合并的对比

| | `get(obj, 'a.b.c', d)` | `obj?.a?.b?.c ?? d` |
| --- | --- | --- |
| 路径 | 字符串或数组，可以在运行时拼出来 | 写死在代码里 |
| 值为 `null` | 返回 `null` | 返回 `d` |
| 值为 `undefined` | 返回 `d` | 返回 `d` |
| 类型推断 | 运行时拼出的路径推断不出，退化成 any | TS 自动推断 |
| 开销 | 要解析字符串（lodash 会缓存解析结果） | 原生语法，没有额外开销 |

路径固定时直接用 `?.` 和 `??`；路径来自配置或数据时用 get，比如表单库按 `user.addresses[0].city` 读写字段、表格列配置里的 `dataIndex`。

## 代码示例：测试

```js
const data = { a: [{ b: { c: 3 } }], n: null, 'x.y': 1 }
console.log(get(data, 'a[0].b.c')) // 3
console.log(get(data, ['a', '0', 'b', 'c'])) // 3
console.log(get(data, 'a[1].b.c', 'def')) // def，a[1] 是 undefined，中途停下
console.log(get(data, 'n', 'def')) // null，值是 null 不用默认值
console.log(get(data, 'n.x', 'def')) // def
console.log(get(data, '["x.y"]')) // 1，含点号的键要加引号

const obj = { s: 'text' }
set(obj, 'list[0].name', 'Tom')
set(obj, 'user.tags[1]', 'vip')
set(obj, 's.len', 4) // s 是原始值，被替换成对象
console.log(JSON.stringify(obj))
// {"s":{"len":4},"list":[{"name":"Tom"}],"user":{"tags":[null,"vip"]}}

try {
  set({}, '__proto__.flag', true)
} catch (err) {
  console.log(err.message) // 不安全的路径：__proto__.flag
}
console.log({}.flag) // undefined，原型没有被修改
```

`tags[1]` 创建的数组下标 0 是空位，`JSON.stringify` 把空位输出成 null。

## 面试官可能追问

::: details 拦截这三个键会误伤正常数据吗？还有什么防御办法？
会。如果业务数据里真有一个字段叫 `constructor`，也会被拒绝。路径来自不可信输入时，宁可拒绝；数据结构由自己控制时，可以换别的办法：用 `Object.create(null)` 创建没有原型的对象，或者直接用 Map 存键值；读取时用 `Object.hasOwn` 只认自有属性，不读继承来的值。
:::

::: details 你的 get 和 lodash 的有什么不同？
lodash 会先判断整个字符串是不是对象上已有的键：`_.get({ 'a.b': 1 }, 'a.b')` 返回 1，而上面的实现会把它拆成 `a`、`b` 去找。lodash 还处理了更多写法，比如 `a..b` 里的空键、方括号里的小数 `a[1.5]`，并缓存路径的解析结果。遇到危险键时，lodash 是静默停止（停下之前已经创建的中间层会留下），这里选择在赋值前就抛错，让调用方尽早发现问题。
:::

::: details 下一个键是数字就建数组，有什么坑？
路径 `a.100` 会创建一个长度为 101、前面都是空位的数组，这往往不是预期的结果。另外要按"规范的下标"判断：`'001'` 不是数组下标，应该建对象。如果业务上希望数字键也存成对象属性，可以像 lodash 的 `setWith` 那样，让调用方传入一个函数自己决定创建什么。
:::

## 易错点

- get 的默认值只在结果为 undefined 时生效，值为 null、0、空字符串都会原样返回
- 用 `||` 代替 `??` 给默认值，0、空字符串、false 也会被替换
- set 不做危险键检查，路径一旦来自用户输入就可能污染原型
