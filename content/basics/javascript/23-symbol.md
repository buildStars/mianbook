---
difficulty: 1
tags: [原理, 高频]
---

# Symbol 是什么？有哪些使用场景？

::: tip 一句话回答
Symbol 是 ES6 加的原始类型，每次调用 `Symbol()` 都得到一个**独一无二的值**，主要用作**对象的属性键**。Symbol 键不会被 `for...in`、`Object.keys`、`JSON.stringify` 遍历到，适合**避免属性名冲突**、挂不想暴露的元数据。另外语言内置了一批 Symbol（如 `Symbol.iterator`、`Symbol.toPrimitive`），用来**自定义对象在语言层面的行为**。
:::

## 详细解析

### 基本特性

```js
const s1 = Symbol('id')
const s2 = Symbol('id')
s1 === s2 // false，描述相同也不相等
s1.description // 'id'，描述只用于调试
typeof s1 // 'symbol'
```

- 不能 `new Symbol()`，它是原始值不是对象
- 不能隐式转字符串：`s1 + ''` 会抛 TypeError；要显式 `String(s1)` 或 `s1.description`

### 作为属性键时的可见性

```js
const id = Symbol('id')
const obj = { name: 'x', [id]: 1 }

Object.keys(obj) // ['name']
JSON.stringify(obj) // '{"name":"x"}'
Object.getOwnPropertySymbols(obj) // [Symbol(id)]
Reflect.ownKeys(obj) // ['name', Symbol(id)]
```

Symbol 键只是"不被常规遍历"，**不是真正的私有**，用 `getOwnPropertySymbols` 或 `Reflect.ownKeys` 都能拿到。需要真正的私有字段用 class 的 `#field`。

### Symbol.for：全局注册表

```js
Symbol.for('app') === Symbol.for('app') // true
Symbol.keyFor(Symbol.for('app')) // 'app'
Symbol.keyFor(Symbol('app')) // undefined，不在注册表里
```

`Symbol.for(key)` 先在全局注册表里找，有就返回同一个，没有才新建。用于跨模块、甚至跨 iframe 共享同一个 Symbol。React 就用 `Symbol.for` 生成的值给元素对象打类型标记，多份 React 副本之间也能认出彼此的元素。

### 内置 Symbol：改变语言行为

| 内置 Symbol | 影响什么 |
| --- | --- |
| `Symbol.iterator` | `for...of`、展开、解构，见 [迭代器协议](/basics/javascript/22-iterator-generator) |
| `Symbol.asyncIterator` | `for await...of` |
| `Symbol.toPrimitive` | 对象转原始值的规则 |
| `Symbol.hasInstance` | `instanceof` 的判断逻辑 |
| `Symbol.toStringTag` | `Object.prototype.toString` 的输出，如 `[object Map]` |

```js
const money = {
  amount: 100,
  [Symbol.toPrimitive](hint) {
    if (hint === 'number') return this.amount
    if (hint === 'string') return `${this.amount} 元`
    return 'default'
  },
}
+money // 100
`${money}` // '100 元'
money + '' // 'default'，+ 运算的 hint 是 default

class Even {
  static [Symbol.hasInstance](n) {
    return n % 2 === 0
  }
}
2 instanceof Even // true
```

类型转换的完整规则见 [== 和 ===](/basics/javascript/08-equality)。

### 使用场景

- **避免属性名冲突**：给第三方对象挂自己的字段，不会覆盖或被覆盖
- **挂元数据**：Symbol 键不进 `JSON.stringify`，序列化时自动排除
- **定义常量**：枚举值用 Symbol，保证只能用同一个引用比较，不会和字符串撞上
- **自定义对象行为**：让对象可迭代、控制类型转换

## 面试官可能追问

::: details Symbol 键能被 Object.assign 和展开复制吗？
能。`Object.assign` 和对象展开 `{ ...obj }` 会复制自身可枚举的 Symbol 属性。只是 `for...in`、`Object.keys`、`JSON.stringify` 会跳过它。
:::

::: details Symbol 能用 WeakMap 的键吗？
没有注册的 Symbol 可以作为 WeakMap 的键，这是较新的规范才加入的能力，老环境不支持。`Symbol.for` 创建的注册 Symbol 不行，因为它永远不会被回收。WeakMap 的介绍见 [Map 和 WeakMap](/basics/javascript/19-map-weakmap)。
:::

::: details Symbol 和 class 的 #私有字段怎么选？
要真正封装、外部完全访问不到，用 `#field`。要"对外不显眼但约定的代码能拿到"，比如库之间共享的协议字段，用 Symbol，尤其是 `Symbol.for`。
:::

## 易错点

- `Symbol('a') === Symbol('a')` 是 false，只有 `Symbol.for('a')` 才相等
- Symbol 属性不是私有属性，`Reflect.ownKeys` 能拿到
- 模板字符串里直接放 Symbol 会报错，要先 `String(s)` 或用 `.description`
