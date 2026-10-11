---
difficulty: 2
tags: [高频, 手写题]
---

# new 操作符做了什么？手写 new

::: tip 一句话回答
`new Fn()` 做了三件事：创建一个新对象，并把它的原型指向 `Fn.prototype`；以这个新对象作为 `this` 执行构造函数；如果构造函数返回了一个对象（包括函数），结果就是这个对象，否则返回新创建的对象。手写时用 `Object.create` 创建对象，用 `apply` 执行构造函数，最后判断返回值。
:::

## 详细解析

### 执行过程

1. 创建一个新对象，把它的 `[[Prototype]]` 指向构造函数的 `prototype`，实例因此能访问原型上的方法（见 [原型和原型链](/basics/javascript/03-prototype-chain)）
2. 以这个新对象作为 `this` 执行构造函数，给它添加属性
3. 检查构造函数的返回值：返回的是对象（包括数组、函数），`new` 的结果就是它；返回原始值或 `null` 会被忽略，结果是第 1 步创建的对象

```js
function Person(name) {
  this.name = name
}
Person.prototype.say = function () {
  return `I am ${this.name}`
}

const p = new Person('Tom')
console.log(p.say()) // I am Tom
console.log(Object.getPrototypeOf(p) === Person.prototype) // true

function ReturnObject() {
  this.a = 1
  return { b: 2 }
}
console.log(new ReturnObject().a) // undefined，结果是返回的那个对象

function ReturnPrimitive() {
  this.a = 1
  return 'ignored'
}
console.log(new ReturnPrimitive().a) // 1，返回的原始值被忽略
```

### 哪些函数不能用 new 调用

能被 `new` 调用的函数，内部要有 `[[Construct]]` 方法。箭头函数（没有自己的 `this`，也没有 `prototype` 属性）、对象方法简写（如 `{ m() {} }` 中的 `m`）、async 函数、generator 函数，以及 `Math.max`、`parseInt` 这类不是构造函数的内置函数都没有这个方法，用 `new` 调用会抛 TypeError；`Symbol`、`BigInt` 则是规范特意禁止用 `new` 调用，`new Symbol()` 同样抛 TypeError。反过来，`class` 只能用 `new` 调用，直接调用会抛 TypeError。

### new.target

函数通过 `new` 调用时，`new.target` 指向被 `new` 的那个构造函数；普通调用时是 `undefined`。可以用它强制使用 `new`，或者实现"抽象类"：

```js
class Shape {
  constructor() {
    if (new.target === Shape) {
      throw new TypeError('Shape 是抽象类，不能直接实例化')
    }
  }
}
class Circle extends Shape {}

new Circle() // 正常，此时 Shape 构造函数里的 new.target 是 Circle
new Shape() // TypeError
```

## 代码示例：手写 new

```js
function myNew(Ctor, ...args) {
  if (typeof Ctor !== 'function') {
    throw new TypeError('Ctor 必须是函数')
  }
  // 1. 创建新对象，原型指向构造函数的 prototype
  const obj = Object.create(Ctor.prototype)
  // 2. 以新对象作为 this 执行构造函数
  const result = Ctor.apply(obj, args)
  // 3. 返回值是对象（包括函数）就用它，否则返回新对象；注意排除 null
  const isObject = result !== null && (typeof result === 'object' || typeof result === 'function')
  return isObject ? result : obj
}

// 沿用上面定义的 Person、ReturnObject、ReturnPrimitive
const p2 = myNew(Person, 'Jerry')
console.log(p2.say()) // I am Jerry
console.log(p2 instanceof Person) // true
console.log(myNew(ReturnObject).b) // 2
console.log(myNew(ReturnPrimitive).a) // 1
```

这只是帮助理解 `new` 的模拟：它用 `apply` 以普通方式调用构造函数，所以不能用于 class（class 不能不带 `new` 调用），构造函数里的 `new.target` 也会是 `undefined`。

## 面试官可能追问

::: details 构造函数返回基本类型或 null 会怎样？
会被忽略，`new` 仍然返回新创建的对象。`null` 虽然 `typeof` 是 "object"，但并不是对象，所以手写 new 时要单独排除。例外是派生类（`class B extends A`）的构造函数：返回对象和 `undefined` 以外的值会直接抛 TypeError。
:::

::: details Object.create 和 new 有什么区别？
- `Object.create(proto)` 只创建一个以 `proto` 为原型的新对象，不执行任何构造函数；传 `null` 可以创建没有原型的对象
- `new Fn()` 以 `Fn.prototype` 为原型创建对象，并且执行 `Fn` 来初始化实例
- 对普通函数来说，`new Fn(...args)` 大致相当于先 `const obj = Object.create(Fn.prototype)`，再 `Fn.apply(obj, args)`，最后处理返回值，也就是上面的 `myNew`
:::

::: details 怎样防止构造函数被当作普通函数调用？
- 用 `new.target` 判断：没有用 `new` 就抛错，或者自动补上，例如 `if (!new.target) return new Person(name)`
- 更简单的做法是改用 class，class 不用 `new` 调用会直接报错
- 早期的写法是判断 `this instanceof Person`，但用 `call` 传入一个已有的实例就能绕过
:::

## 易错点

- 构造函数 `return null` 不会生效，只有返回对象才会替换掉新创建的实例
- 箭头函数、对象方法简写不能作为构造函数，用 `new` 调用会抛 TypeError
- 手写 new 时，原型要在执行构造函数**之前**设置好，否则构造函数里无法调用原型上的方法
