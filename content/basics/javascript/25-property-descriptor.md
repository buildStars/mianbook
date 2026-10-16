---
difficulty: 2
tags: [原理, 对比]
---

# 对象的属性描述符是什么？Object.freeze、seal、preventExtensions 有什么区别？

::: tip 一句话回答
每个属性背后都有一个**描述符**，分两种：**数据描述符**（`value`、`writable`）和**访问器描述符**（`get`、`set`），两者都有 `enumerable` 和 `configurable`。用 `Object.defineProperty` 定义属性时，没写的特性**默认都是 false**。三种限制从弱到强：**preventExtensions** 不能加新属性，**seal** 再加上不能删、不能重新配置，**freeze** 再加上不能改值。三者都是**浅的**，只管对象自身这一层。
:::

## 详细解析

### 两种描述符

| 特性 | 含义 | 字面量创建时 | defineProperty 未指定时 |
| --- | --- | --- | --- |
| `value` | 属性值 | 赋的值 | `undefined` |
| `writable` | 能否修改值 | true | **false** |
| `enumerable` | 能否被 `for...in`、`Object.keys` 遍历 | true | **false** |
| `configurable` | 能否删除、能否修改描述符 | true | **false** |
| `get` / `set` | 读写时调用的函数（访问器专用） | - | `undefined` |

一个描述符不能同时有 `value`/`writable` 和 `get`/`set`，否则抛 TypeError。

```js
const user = {
  first: 'A',
  last: 'B',
  get full() {
    return `${this.first} ${this.last}`
  },
}
Object.getOwnPropertyDescriptor(user, 'first')
// { value: 'A', writable: true, enumerable: true, configurable: true }
Object.getOwnPropertyDescriptor(user, 'full')
// { get: [Function: get full], set: undefined, enumerable: true, configurable: true }
```

### defineProperty 默认值的坑

```js
const obj = {}
Object.defineProperty(obj, 'id', { value: 1 })

obj.id = 2 // 非严格模式静默失败，严格模式抛 TypeError
console.log(obj.id) // 1
console.log(Object.keys(obj)) // []，不可枚举
delete obj.id // 删不掉
```

只写了 `value`，其他三个都是 false：属性变成只读、不可见、不可删。这种属性常用来挂内部字段，但如果只是想加个普通属性，直接赋值就行。

`configurable: false` 之后基本就锁死了：不能删，不能改 `enumerable`，不能在数据和访问器之间切换。例外是 `writable` 还能从 true 改成 false（只能单向）。Vue 2 的响应式就是靠 `defineProperty` 的 `get`/`set` 实现的。

### 三种冻结级别

| | 加新属性 | 删属性 | 改描述符 | 改值 | 判断方法 |
| --- | --- | --- | --- | --- | --- |
| `Object.preventExtensions` | 不能 | 能 | 能 | 能 | `Object.isExtensible` |
| `Object.seal` | 不能 | 不能 | 不能 | 能 | `Object.isSealed` |
| `Object.freeze` | 不能 | 不能 | 不能 | 不能 | `Object.isFrozen` |

seal 等于 preventExtensions + 所有属性 `configurable: false`；freeze 再把所有数据属性设成 `writable: false`。访问器属性的 `set` 在 freeze 后仍然能调用，因为它没有 `writable` 这一项。三个操作都不可逆。

```js
const sealed = Object.seal({ n: 1 })
sealed.n = 2 // 能改
sealed.x = 1 // 加不上
delete sealed.n // 删不掉
console.log(sealed) // { n: 2 }
```

### freeze 是浅冻结

```js
const config = Object.freeze({ n: 1, inner: { m: 1 } })
config.n = 2
config.inner.m = 2
console.log(config.n, config.inner.m) // 1 2，内层对象没被冻结

function deepFreeze(obj) {
  for (const key of Reflect.ownKeys(obj)) {
    const v = obj[key]
    if (v && typeof v === 'object') deepFreeze(v)
  }
  return Object.freeze(obj)
}
```

`const` 只保证变量不能重新赋值，和 freeze 是两回事，见 [var、let、const](/basics/javascript/09-var-let-const)。

## 面试官可能追问

::: details 冻结一个对象能提升性能吗？
不要指望它。冻结主要是表达"这个对象不该被改"，防止误改。Vue 3 里大列表数据用 `markRaw` 或 `shallowRef` 跳过响应式才是性能手段，Vue 2 里 freeze 能让 Vue 跳过响应式转换，是一个特例。
:::

::: details 怎么一次定义或读取多个属性的描述符？
`Object.defineProperties(obj, { a: {...}, b: {...} })` 一次定义多个；`Object.getOwnPropertyDescriptors(obj)` 一次拿全部。后者配合 `Object.create` 可以完整拷贝对象，包括 getter/setter，而 `Object.assign` 会把 getter 求值成普通值。
:::

::: details Proxy 和 defineProperty 有什么不同？
defineProperty 只能拦截已知属性的读写，新增属性、删除、数组下标变化都管不到。Proxy 代理整个对象，能拦截读写、`in`、`delete`、新增等十几种操作。这也是 Vue 3 改用 Proxy 的主要原因。
:::

## 易错点

- defineProperty 漏写的特性默认是 false，不是 true
- freeze 是浅冻结，嵌套对象需要递归冻结
- 非严格模式下改冻结对象不报错，只是静默失败，容易误以为改成功了
