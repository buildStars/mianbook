---
difficulty: 2
tags: [高频, 手写题]
---

# 深拷贝和浅拷贝有什么区别？怎么实现深拷贝？

::: tip 一句话回答
**浅拷贝**只复制第一层，嵌套的对象仍然和原对象共享引用，比如展开运算符、`Object.assign`；**深拷贝**递归复制所有层级，新旧对象完全独立。`JSON.parse(JSON.stringify(obj))` 写法简单，但会丢失函数和 undefined、转坏 Date 和 Map 等类型，遇到循环引用直接报错；现代环境优先用内置的 `structuredClone`；手写时要按类型分别处理，并用 WeakMap 解决循环引用。
:::

## 详细解析

### 浅拷贝

```js
const user = { name: 'Tom', info: { age: 18 } }
const copy = { ...user } // 和 Object.assign({}, user) 效果相同

copy.name = 'Jerry'
copy.info.age = 20
console.log(user.name) // Tom，第一层是独立的
console.log(user.info.age) // 20，嵌套对象仍是同一个引用
```

数组的浅拷贝：`[...arr]`、`arr.slice()`、`arr.concat()`、`Array.from(arr)`。

### JSON 方案的局限

| 原数据 | 经过 `JSON.parse(JSON.stringify())` 后 |
| --- | --- |
| 值为 `undefined`、函数、Symbol 的属性 | 被丢弃（在数组里会变成 `null`） |
| Symbol 键的属性 | 被丢弃 |
| `Date` | 变成 ISO 格式的字符串 |
| `RegExp`、`Map`、`Set` | 变成空对象 `{}` |
| `NaN`、`Infinity` | 变成 `null` |
| 类的实例 | 原型丢失，变成普通对象 |
| 循环引用、BigInt | 直接抛 TypeError |

### structuredClone

`structuredClone` 是内置的深拷贝函数，现代浏览器和 Node.js 17 起可用，使用的是和 `postMessage` 相同的结构化克隆算法：

- 支持循环引用，以及 `Date`、`RegExp`、`Map`、`Set`、`ArrayBuffer`、BigInt 等类型
- 不能克隆函数和 DOM 节点，例如 `structuredClone({ fn() {} })` 会抛出 `DataCloneError`
- 类的实例会丢失原型，变成普通对象；也不保留 getter / setter，更多限制见下方追问

## 代码示例：手写深拷贝

```js
function deepClone(value, cache = new WeakMap()) {
  // 原始值和函数直接返回（函数一般共享引用即可）
  if (typeof value !== 'object' || value === null) return value
  // 拷贝过的对象直接返回之前的结果，解决循环引用
  if (cache.has(value)) return cache.get(value)

  if (value instanceof Date) return new Date(value.getTime())
  if (value instanceof RegExp) return new RegExp(value.source, value.flags)

  if (value instanceof Map) {
    const result = new Map()
    cache.set(value, result)
    // Map 的键通常当作标识使用，这里直接复用，只深拷贝值
    value.forEach((v, k) => result.set(k, deepClone(v, cache)))
    return result
  }
  if (value instanceof Set) {
    const result = new Set()
    cache.set(value, result)
    value.forEach((v) => result.add(deepClone(v, cache)))
    return result
  }

  // 数组和普通对象：Object.create 保留原型（包括 null 原型）
  const result = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value))
  // 必须先登记再递归，子属性引用回 value 时才能拿到 result
  cache.set(value, result)
  // Reflect.ownKeys 返回自身所有的键，包括 Symbol 键
  for (const key of Reflect.ownKeys(value)) {
    result[key] = deepClone(value[key], cache)
  }
  return result
}
```

测试：

```js
const id = Symbol('id')
const source = {
  nested: { arr: [1, { deep: true }] },
  date: new Date(0),
  reg: /ab+c/gi,
  map: new Map([['k', { v: 1 }]]),
  set: new Set([1, 2]),
  fn() {},
  [id]: 'symbol',
}
source.self = source // 循环引用

const copy = deepClone(source)
console.log(copy.self === copy) // true，循环引用指向拷贝后的对象
console.log(copy.nested.arr[1] !== source.nested.arr[1]) // true，嵌套对象是新的
console.log(copy.map.get('k') !== source.map.get('k'), copy.set.has(2)) // true true
console.log(copy.date.getTime(), copy.reg.flags, copy[id]) // 0 gi symbol
console.log(copy.fn === source.fn) // true，函数共享引用
```

这个版本覆盖了面试中常见的类型，其他内置类型（如 TypedArray、Error）可以按同样的思路增加分支。它通过赋值复制属性，getter 会被求值成普通属性；需要完整保留属性描述符时，可以改用 `Object.getOwnPropertyDescriptors` 配合 `Object.defineProperties`。

## 面试官可能追问

::: details 为什么用 WeakMap 而不是 Map 记录已拷贝的对象？
缓存的键都是对象，而且只需要按键查找、不需要遍历，正好是 WeakMap 的适用场景。WeakMap 对键是弱引用，即使缓存被长期持有（比如在多次拷贝之间复用），也不会阻止原对象被垃圾回收。就上面的实现而言，缓存在一次拷贝结束后就不再被引用，用 Map 也不会泄漏，WeakMap 是更稳妥的选择。两者的区别见 [Map、Set 和 WeakMap、WeakSet](/basics/javascript/19-map-weakmap)。
:::

::: details structuredClone 有哪些限制？
- 函数、DOM 节点、Symbol 值不能克隆，会抛出 `DataCloneError`
- 类的实例会丢失原型，变成普通对象；getter / setter 不保留，克隆的是 getter 当时返回的值
- Symbol 键的属性和不可枚举的属性会被忽略
- 属性描述符不会保留，例如冻结的对象克隆后不再是冻结的
- Map 的对象键也会被克隆，克隆后的 Map 不能再用原来的键对象查到值
:::

::: details 函数需要深拷贝吗？
一般不需要，直接共享引用即可。函数描述的是行为，通常不会被修改，复制一份没有意义；而且闭包里的变量无法复制，用 `new Function('return ' + fn.toString())()` 之类的方式重建函数会丢失闭包，对原生函数也无效。
:::

## 易错点

- 展开运算符、`Object.assign`、`slice`、`concat` 都只是浅拷贝
- JSON 方案会**静默丢失**数据，只适合纯 JSON 数据（普通对象、数组、字符串、有限的数字、布尔值和 null）
- 手写时要在递归子属性**之前**把当前对象登记到缓存里，否则循环引用仍然会无限递归
