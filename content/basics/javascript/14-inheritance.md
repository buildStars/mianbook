---
difficulty: 2
tags: [原理]
---

# JS 有哪些继承方式？class 继承有什么不同？

::: tip 一句话回答
ES5 有原型链继承、借用构造函数、组合继承、原型式继承、寄生组合式继承等方式，其中**寄生组合式继承**最完善：用 `Parent.call(this)` 继承实例属性，用 `Object.create(Parent.prototype)` 继承原型方法。ES6 的 `class extends` 底层仍然是原型，但实例由父类构造函数创建，所以子类必须先调用 `super()` 才能使用 `this`，也因此能正确继承 `Array`、`Error` 等内置类型。
:::

## 详细解析

### ES5 的几种方式

| 方式 | 做法 | 问题 |
| --- | --- | --- |
| 原型链继承 | `Child.prototype = new Parent()` | 父类的实例属性挂在子类原型上，引用类型的属性被所有子类实例共享；创建子类实例时无法向父构造函数传参 |
| 借用构造函数 | 在子构造函数中执行 `Parent.call(this, ...args)` | 拿不到父类原型上的方法；方法只能写在构造函数里，每个实例各有一份，无法复用 |
| 组合继承 | 以上两种结合 | 父构造函数被调用两次，子类原型上还多出一份用不到的父类实例属性 |
| 原型式继承 | `Object.create(obj)`，以现有对象为原型创建新对象 | 和原型链继承一样，引用类型的属性被共享 |
| 寄生组合式继承 | 借用构造函数继承属性，`Object.create(Parent.prototype)` 继承方法 | ES5 下的最佳方案，父构造函数只调用一次 |

### 寄生组合式继承与 class 对照

```js
// ES5：寄生组合式继承
function Animal(name) {
  this.name = name
}
Animal.prototype.say = function () {
  return 'I am ' + this.name
}

function Dog(name, breed) {
  Animal.call(this, name) // 继承实例属性
  this.breed = breed
}
Dog.prototype = Object.create(Animal.prototype) // 继承原型方法
Dog.prototype.constructor = Dog // 修正 constructor
```

```js
// ES6：class 继承
class Animal {
  constructor(name) {
    this.name = name
  }
  say() {
    return `I am ${this.name}`
  }
  static create(name) {
    return new this(name)
  }
}

class Dog extends Animal {
  constructor(name, breed) {
    super(name) // 必须先调用 super()，之后才能使用 this
    this.breed = breed
  }
}

console.log(Dog.create('旺财') instanceof Dog) // true：静态方法被继承，this 指向 Dog
console.log(Object.getPrototypeOf(Dog) === Animal) // true
console.log(Object.getPrototypeOf(Dog.prototype) === Animal.prototype) // true
```

`class extends` 建立了两条原型链：`Dog.prototype` 的原型指向 `Animal.prototype`，实例因此能调用父类的方法；`Dog` 本身的原型指向 `Animal`，所以静态方法也能继承。

### class 继承的特点

- **本质仍是原型**：类就是函数（`typeof Dog` 是 `'function'`），方法定义在 `prototype` 上，见[原型和原型链](/basics/javascript/03-prototype-chain)
- **私有字段子类也访问不到**：`#x` 只能在声明它的类内部访问。子类实例上其实有这个字段（父类构造函数执行时加上的），但在子类的方法里写 `this.#x` 会直接报 SyntaxError，只能通过父类提供的方法间接访问
- 和构造函数相比，类必须用 `new` 调用，类的方法不可枚举，类内部默认是严格模式；类声明也不会像函数声明那样整体提升，在声明之前使用会因为暂时性死区抛 ReferenceError

### 为什么必须先调用 super()

两种写法创建实例的顺序正好相反：

- **ES5**：`new Dog()` 先创建一个原型为 `Dog.prototype` 的空对象作为 `this`（过程见 [new 操作符](/basics/javascript/06-new)），再通过 `Animal.call(this)` 把父类的属性加上去
- **ES6**：子类构造函数自己不创建 `this`。调用 `super()` 时，由父类构造函数创建实例（多层继承时由最顶层的基类创建，原型仍然指向 `Dog.prototype`），返回给子类后，子类再在上面添加自己的属性

所以在 `super()` 之前 `this` 还不存在，访问它会抛出 ReferenceError；子类不写 `constructor` 时，会自动生成一个调用 `super(...args)` 的构造函数。也正因为实例由父类构造函数创建，`class MyArray extends Array` 得到的是真正的数组，`Error` 等内置类型也能正确继承。

## 面试官可能追问

::: details super 有哪几种用法？
- **作为函数**：`super(...)` 调用父类构造函数，只能在子类的 `constructor` 中使用
- **作为对象**：在普通方法中，`super.method()` 调用父类原型上的方法，方法里的 `this` 仍然是当前实例，比如子类重写 `say()` 时写 `return super.say() + '，汪'`；在静态方法中，`super.method()` 调用父类的静态方法
:::

::: details 为什么 ES5 很难完美继承 Array？
数组是特殊对象，`length` 会随下标自动变化。但 `Array.call(this)` 不会改造传入的 `this`，而是忽略它、返回一个新数组，所以 ES5 方式得到的实例只是一个原型指向 `Array.prototype` 的普通对象：

```js
function MyArray() {
  Array.call(this) // 返回的新数组被丢弃，this 没有任何变化
}
MyArray.prototype = Object.create(Array.prototype)

const arr = new MyArray()
arr[0] = 1
console.log(arr.length, Array.isArray(arr)) // 0 false

class MyArray2 extends Array {}
const arr2 = new MyArray2()
arr2[0] = 1
console.log(arr2.length, Array.isArray(arr2)) // 1 true
```

`Error` 也一样，`Error.call(this, msg)` 不会给 `this` 设置 `message`。
:::

::: details Object.setPrototypeOf 和 Object.create 有什么区别？
- `Object.create(proto)` 创建一个新对象，它的原型是 `proto`
- `Object.setPrototypeOf(obj, proto)` 修改一个已有对象的原型。这会破坏引擎对对象结构的优化，性能较差，能用 `Object.create` 时优先用它

用在继承里：`Child.prototype = Object.create(Parent.prototype)` 替换了整个原型对象，要手动修正 `constructor`，之前加在原 prototype 上的方法也会丢失；`Object.setPrototypeOf(Child.prototype, Parent.prototype)` 保留原来的 prototype 对象，只改变它的原型。`Object.setPrototypeOf(Child, Parent)` 还能让子构造函数继承父类的静态方法，相当于 `class extends` 建立的第二条原型链。
:::

## 易错点

- 子类构造函数中，在 `super()` 之前使用 `this` 会抛出 ReferenceError
- 用 `Object.create` 替换 prototype 后要修正 `constructor`，而且要在替换之后再往原型上添加方法
- class 只是写法更简洁，背后仍然是原型链
