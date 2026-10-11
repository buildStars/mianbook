---
difficulty: 1
tags: [高频]
---

# JS 有哪些数据类型？怎么判断类型？

::: tip 一句话回答
JS 有 8 种数据类型：7 种**原始类型** `undefined`、`null`、`boolean`、`number`、`bigint`、`string`、`symbol`，其余都是**对象**（Object），函数、数组、日期、正则也都是对象。判断时，原始类型用 `typeof`（注意 `typeof null` 是 "object"），数组用 `Array.isArray`，要精确区分各种内置对象用 `Object.prototype.toString.call(x)`。
:::

## 详细解析

### 原始值和对象

`symbol` 是 ES2015 新增的，`bigint` 是 ES2020 新增的。两类值的核心区别：

- **原始值不可变**，按值比较：字符串的方法都返回新字符串，原来的值不会变
- **对象按引用比较**：两个内容相同的对象并不相等；赋值和传参复制的是引用，通过一个变量修改，另一个变量也能看到

```js
const s = 'abc'
s.toUpperCase()
console.log(s) // abc，原始值没有被修改

console.log({ a: 1 } === { a: 1 }) // false，两个不同的对象
const a = { x: 1 }
const b = a
b.x = 2
console.log(a.x) // 2，a 和 b 指向同一个对象
```

原始值也能调用方法（如 `'abc'.toUpperCase()`），是因为语义上访问属性时，原始值会被临时包装成对应的对象（如 `String`、`Number`）。

> 常说的"原始值存在栈上、对象存在堆上"只是便于理解的概念模型，不是引擎的真实实现。例如在 V8 中，字符串也分配在堆上，被闭包引用的变量也不在栈上。

### 判断类型的方法

| 方法 | 适用场景 | 局限 |
| --- | --- | --- |
| `typeof x` | 原始类型和函数 | `typeof null` 是 "object"（历史遗留问题）；函数返回 "function"，数组、普通对象、日期等其他对象都返回 "object" |
| `x instanceof Ctor` | 判断对象是不是某个构造函数的实例 | 基于原型链（见 [原型和原型链](/basics/javascript/03-prototype-chain)）；不能判断原始类型；跨 iframe 或窗口时会失效 |
| `Object.prototype.toString.call(x)` | 返回 "[object Xxx]"，能区分几乎所有内置类型，最通用 | 结果可以被 `Symbol.toStringTag` 修改；自定义类的实例默认都是 "[object Object]" |
| `Array.isArray(x)` | 判断数组 | 只能判断数组，但跨 iframe 也准确 |
| `Number.isNaN(x)` | 判断 `NaN` | 只能判断 `NaN` |

```js
typeof undefined // 'undefined'
typeof null // 'object'
typeof 1n // 'bigint'
typeof Symbol() // 'symbol'
typeof function () {} // 'function'
typeof [] // 'object'
typeof notDeclared // 'undefined'，未声明的变量不会报错

const tag = (x) => Object.prototype.toString.call(x)
tag(null) // '[object Null]'
tag([]) // '[object Array]'
tag(new Date()) // '[object Date]'
tag({ [Symbol.toStringTag]: 'Fake' }) // '[object Fake]'
```

`typeof` 对未声明的变量返回 "undefined"，但对处在暂时性死区的 `let` / `const` 变量会报错，见 [var、let、const 的区别](/basics/javascript/09-var-let-const)。

`instanceof` 跨 iframe 失效，是因为每个 iframe 都有自己的全局环境和一套独立的 `Array`、`Object` 等构造函数。iframe 里创建的数组，原型链上是 iframe 自己的 `Array.prototype`：

```js
const iframe = document.createElement('iframe')
document.body.appendChild(iframe)
const arr = new iframe.contentWindow.Array()
console.log(arr instanceof Array) // false
console.log(Array.isArray(arr)) // true
```

## 代码示例：通用的 getType

```js
function getType(value) {
  // null 单独处理
  if (value === null) return 'null'
  // 其他原始类型和函数，typeof 已经足够准确
  const type = typeof value
  if (type !== 'object') return type
  // 对象用 toString 细分：'[object Array]' → 'array'
  return Object.prototype.toString.call(value).slice(8, -1).toLowerCase()
}

console.log(getType(null)) // null
console.log(getType(1n)) // bigint
console.log(getType(() => {})) // function
console.log(getType([])) // array
console.log(getType(new Date())) // date
console.log(getType(/a/)) // regexp
console.log(getType(new Map())) // map
console.log(getType({})) // object
```

## 面试官可能追问

::: details 为什么 typeof null 是 "object"？
这是第一版 JS 实现遗留的问题。当时的值在底层带有表示类型的标签，对象的类型标签是 0；而 `null` 用空指针表示，所有位都是 0，于是被 `typeof` 当成了对象。后来有过把结果改成 "null" 的提案，但会破坏大量已有代码，没有通过。判断 null 直接用 `x === null`。
:::

::: details Number.isNaN 和全局的 isNaN 有什么区别？
全局的 `isNaN` 会先把参数转成数字再判断，所以 `isNaN('abc')`、`isNaN(undefined)` 都是 true。`Number.isNaN` 不做转换，只有参数本身是 `NaN` 才返回 true。另外 `NaN` 是唯一不等于自身的值，也可以用 `x !== x` 或 `Object.is(x, NaN)` 判断。
:::

::: details BigInt 有什么用？有哪些限制？
`number` 是双精度浮点数，超过 `Number.MAX_SAFE_INTEGER`（`2 ** 53 - 1`）的整数就不一定能精确表示。BigInt 可以表示任意大的整数，写法是在数字后面加 `n`（如 `10n`），或者调用 `BigInt('9007199254740993')`，适合处理 64 位整数 ID、高精度时间戳等。限制：

- 不能和 `number` 直接混合运算，`1n + 1` 会抛 TypeError，要先用 `Number()` 或 `BigInt()` 显式转换；比较运算可以直接用，`1n < 2` 是 true
- 只能表示整数，除法会舍去小数部分：`5n / 2n` 是 `2n`
- `Math` 的方法不接受 BigInt，`JSON.stringify` 遇到 BigInt 会抛 TypeError
:::

## 易错点

- `typeof null` 和 `typeof []` 都是 "object"，判断数组要用 `Array.isArray`
- 函数也是对象，但 `typeof` 返回 "function"
- `NaN` 的类型是 number，而且 `NaN !== NaN`，判断要用 `Number.isNaN`
