---
difficulty: 2
tags: [高频, 原理]
---

# 原型和原型链是什么？

::: tip 一句话回答
每个对象都有一个内部属性 `[[Prototype]]`，指向它的**原型**；函数还有一个 `prototype` 属性，用 `new` 创建的实例，原型就是构造函数的 `prototype`。读取属性时先找对象自身，找不到就沿着原型一层层往上找，直到 `Object.prototype`，再往上是 `null`，这条查找链就是**原型链**。JS 的继承和 `instanceof` 都建立在它之上。
:::

## 详细解析

### 三个概念

- **`prototype`**：函数的属性（箭头函数、对象方法简写、async 函数等没有）。用 `new` 调用函数时，新对象的原型就是它，过程见 [new 操作符](/basics/javascript/06-new)
- **`[[Prototype]]`**：每个对象都有的内部属性，指向它的原型。用 `Object.getPrototypeOf(obj)` 读取，也可以用历史遗留的 `obj.__proto__`
- **`constructor`**：`prototype` 对象上默认有一个 `constructor` 属性，指回函数本身

```text
                prototype
   Person ─────────────────────→ Person.prototype
     ↑                                  │
     └─────────── constructor ──────────┘

实例的原型链（→ 表示 [[Prototype]]）
   p ──→ Person.prototype ──→ Object.prototype ──→ null

函数也是对象，也有自己的原型链
   Person   ──→ Function.prototype ──→ Object.prototype ──→ null
   Object   ──→ Function.prototype
   Function ──→ Function.prototype
```

### 属性查找

```js
function Person(name) {
  this.name = name
}
Person.prototype.sayHi = function () {
  return `Hi, ${this.name}`
}

const p = new Person('Tom')

console.log(p.sayHi()) // Hi, Tom，自身没有 sayHi，在 Person.prototype 上找到
console.log(p.toString()) // [object Object]，在 Object.prototype 上找到
console.log(p.constructor === Person) // true，constructor 也是从原型上读到的
console.log(Object.getPrototypeOf(p) === Person.prototype) // true
console.log(Object.getPrototypeOf(Object.prototype)) // null
```

赋值则不会沿原型链修改：`p.sayHi = ...` 一般会在 `p` 自身新增一个同名属性，**遮蔽**原型上的方法，原型本身不变。继承就是利用原型链，让子类的实例能访问父类原型上的方法，具体写法见 [JS 的继承方式](/basics/javascript/14-inheritance)。

### 函数和 Object 的关系

`Object`、`Function` 这些内置构造函数本身也是函数，所以它们的 `[[Prototype]]` 和普通函数一样，都是 `Function.prototype`；`Function.prototype` 再往上就是 `Object.prototype`。

```js
console.log(Object.__proto__ === Function.prototype) // true
console.log(Function.__proto__ === Function.prototype) // true
console.log(Function.prototype.__proto__ === Object.prototype) // true
console.log(Object instanceof Function, Function instanceof Object) // true true
```

### instanceof 与自身属性

`a instanceof B` 会沿着 `a` 的原型链往上找，只要某一层等于 `B.prototype` 就返回 true，找到 `null` 还没有就返回 false。所以 `p instanceof Person` 和 `p instanceof Object` 都是 true。

| 方法 | 检查范围 |
| --- | --- |
| `Object.hasOwn(obj, key)`（ES2022）、`obj.hasOwnProperty(key)` | 只检查自身属性 |
| `key in obj` | 自身和整条原型链 |
| `for...in` | 自身和原型链上的可枚举属性 |
| `Object.keys(obj)` | 只有自身的可枚举属性 |

`Object.create(null)` 创建的对象没有原型，不会继承 `toString`、`hasOwnProperty` 这些属性，适合用作纯粹的键值字典。例如 `const dict = Object.create(null)` 之后，`'toString' in dict` 是 false；`dict` 上也没有 `hasOwnProperty` 方法，判断自身属性要用 `Object.hasOwn(dict, key)`。

## 面试官可能追问

::: details 手写 instanceof？
```js
function myInstanceof(obj, Ctor) {
  // 原始值没有原型链
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return false
  let proto = Object.getPrototypeOf(obj)
  while (proto !== null) {
    if (proto === Ctor.prototype) return true
    proto = Object.getPrototypeOf(proto)
  }
  return false
}

console.log(myInstanceof([], Array), myInstanceof([], Object), myInstanceof(1, Number)) // true true false
```

原生 `instanceof` 实际调用的是右侧的 `Symbol.hasInstance` 方法，函数默认继承的实现就是上面的查找过程；也可以在 class 里定义 `static [Symbol.hasInstance]` 来自定义判断逻辑。
:::

::: details 为什么不建议修改内置对象的原型（如 Array.prototype）？
- 影响全局：所有数组都会受影响，包括第三方库里的代码
- 可能和未来的标准冲突：历史上 MooTools 库给数组加过 `flatten` 方法，导致后来的标准方法只能改名为 `flat`
- 直接赋值添加的方法是可枚举的，会出现在 `for...in` 的遍历结果里
- 例外是 polyfill：在旧环境里按规范补上缺失的标准方法
:::

::: details `__proto__` 和 `prototype` 有什么区别？
- `prototype` 是**函数**的属性，决定用 `new` 创建的实例以谁为原型
- `__proto__` 是定义在 `Object.prototype` 上的访问器属性，读写的是**对象自己**的 `[[Prototype]]`，所以 `p.__proto__ === Person.prototype`。函数也是对象，既有 `prototype`，也有 `__proto__`
- `__proto__` 是历史遗留写法，`Object.create(null)` 创建的对象上就没有它，推荐用 `Object.getPrototypeOf` / `Object.setPrototypeOf`
:::

## 易错点

- `prototype` 是函数才有的属性，实例上没有：`p.prototype` 是 `undefined`
- 给实例赋值只会在实例自身新增属性，不会修改原型上的同名属性
- 用一个新对象整体覆盖 `Person.prototype` 时，`constructor` 会丢失（变成从 `Object.prototype` 继承的 `Object`），需要手动补上 `constructor: Person`
