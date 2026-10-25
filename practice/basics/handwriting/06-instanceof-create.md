---
title: 手写 instanceof 和 Object.create
---

## 要求

实现两个函数：

**`myInstanceof(obj, Ctor)`**：返回值和 `obj instanceof Ctor` 一样，不能直接用 `instanceof` 和 `isPrototypeOf`。按顺序判断：

1. Ctor 不是对象或函数（比如 null、数字、字符串），抛 `TypeError`
2. Ctor 自定义了 `Symbol.hasInstance` 方法（不是所有函数默认继承的那个），就调用它，把返回值转成布尔值作为结果；这时 Ctor 也可以是普通对象
3. Ctor 不是函数，抛 `TypeError`
4. obj 是原始值（数字、字符串、null、undefined 等），返回 false；函数不是原始值
5. `Ctor.prototype` 不是对象（比如箭头函数没有 prototype），抛 `TypeError`
6. 沿 obj 的原型链逐层往上找，某一层等于 `Ctor.prototype` 就返回 true，找到 null 还没有就返回 false

**`createObject(proto)`**：`Object.create` 只支持第一个参数的 polyfill。

- 返回一个新对象，它的原型是 proto，自身没有任何属性
- proto 不是对象或函数时，抛 `TypeError`
- 这种写法模拟不了没有原型的对象，proto 是 null 时也要抛错，不能悄悄返回一个普通对象
- 不能调用 `Object.create`，也不要用 `Object.setPrototypeOf` 和 `__proto__`（老环境里没有它们）

## 提示

- 用 `Object.getPrototypeOf` 循环往上取原型，直到 null；原始值要先排除，因为 `Object.getPrototypeOf(1)` 会得到 `Number.prototype`
- 判断 Symbol.hasInstance 是不是自定义的：和 `Function.prototype[Symbol.hasInstance]` 比较，不相等才调用它
- createObject：写一个空的构造函数，把它的 prototype 设成 proto，再 new 它
- null 要提前拦截：构造函数的 prototype 不是对象时，new 出来的对象的原型会退回 `Object.prototype`，不会报错

## 起始代码

```js
function myInstanceof(obj, Ctor) {
  // 返回和 obj instanceof Ctor 一样的结果
}

function createObject(proto) {
  // 返回一个以 proto 为原型的新对象
}
```

## 测试

```js
class Animal {}
class Dog extends Animal {}

// 调用 createObject 时临时禁用 Object.create，确保是自己实现的
const create = (proto) => {
  const original = Object.create
  Object.create = () => {
    throw new Error('createObject 里不能调用 Object.create')
  }
  try {
    return createObject(proto)
  } finally {
    Object.create = original
  }
}

test('沿原型链逐层查找，找到 null 还没有就返回 false', () => {
  const dog = new Dog()
  expect(myInstanceof(dog, Dog)).toBe(true)
  expect(myInstanceof(dog, Animal)).toBe(true)
  expect(myInstanceof(dog, Object)).toBe(true)
  expect(myInstanceof(dog, Array)).toBe(false)
  expect(myInstanceof([], Array)).toBe(true)
  expect(myInstanceof(Object.create(null), Object)).toBe(false) // 没有原型的对象
})

test('左侧是原始值时返回 false，包装对象和函数照常查找', () => {
  expect(myInstanceof(1, Number)).toBe(false)
  expect(myInstanceof('abc', String)).toBe(false)
  expect(myInstanceof(null, Object)).toBe(false)
  expect(myInstanceof(undefined, Object)).toBe(false)
  expect(myInstanceof(new Number(1), Number)).toBe(true)
  expect(myInstanceof(() => {}, Function)).toBe(true)
  expect(myInstanceof(Dog, Object)).toBe(true)
})

test('比较的是 Ctor.prototype，不是 constructor 属性', () => {
  function Foo() {}
  const fake = { constructor: Foo } // 只是有一个 constructor 属性
  expect(myInstanceof(fake, Foo)).toBe(false)
  const real = Object.create(Foo.prototype)
  expect(myInstanceof(real, Foo)).toBe(true)
  Foo.prototype = {} // 换掉 prototype 之后，之前创建的对象就不算了
  expect(myInstanceof(real, Foo)).toBe(false)
})

test('右侧自定义了 Symbol.hasInstance 时，用它的结果（转成布尔值）', () => {
  class Even {
    static [Symbol.hasInstance](n) {
      return Number.isInteger(n) && n % 2 === 0
    }
  }
  expect(myInstanceof(2, Even)).toBe(true)
  expect(myInstanceof(3, Even)).toBe(false)
  const HasLength = { [Symbol.hasInstance]: (v) => v != null && v.length } // 普通对象，返回值不是布尔值
  expect(myInstanceof('abc', HasLength)).toBe(true)
  expect(myInstanceof([], HasLength)).toBe(false)
})

test('右侧不能用来判断时抛 TypeError', () => {
  expect(() => myInstanceof({}, null)).toThrow(TypeError)
  expect(() => myInstanceof({}, 'Object')).toThrow(TypeError)
  expect(() => myInstanceof({}, {})).toThrow(TypeError) // 普通对象，没有 Symbol.hasInstance
  expect(() => myInstanceof({}, () => {})).toThrow(TypeError) // 箭头函数没有 prototype
})

test('createObject 返回以 proto 为原型的新对象', () => {
  const base = {
    greet() {
      return `hi, ${this.name}`
    },
  }
  const user = create(base)
  expect(Object.getPrototypeOf(user)).toBe(base)
  expect(Object.keys(user)).toEqual([])
  user.name = 'Jerry'
  expect(user.greet()).toBe('hi, Jerry')
  expect(create(base)).not.toBe(user)
  expect(Object.getPrototypeOf(create(Dog.prototype))).toBe(Dog.prototype)
})

test('createObject 的参数不是对象时抛 TypeError，传 null 也要抛错', () => {
  expect(() => create(1)).toThrow(TypeError)
  expect(() => create('abc')).toThrow(TypeError)
  expect(() => create(undefined)).toThrow(TypeError)
  expect(() => create(null)).toThrow()
})
```

## 参考答案

```js
const isObject = (v) => v !== null && (typeof v === 'object' || typeof v === 'function')

function myInstanceof(obj, Ctor) {
  if (!isObject(Ctor)) throw new TypeError("Right-hand side of 'instanceof' is not an object")
  // 右侧自定义了 Symbol.hasInstance 就交给它；默认继承的那个实现就是下面的原型链查找
  const hasInstance = Ctor[Symbol.hasInstance]
  if (hasInstance != null && hasInstance !== Function.prototype[Symbol.hasInstance]) {
    return Boolean(hasInstance.call(Ctor, obj))
  }
  if (typeof Ctor !== 'function') throw new TypeError("Right-hand side of 'instanceof' is not callable")
  if (!isObject(obj)) return false // 原始值没有原型链
  const target = Ctor.prototype
  if (!isObject(target)) throw new TypeError('Function has non-object prototype in instanceof check')
  let proto = Object.getPrototypeOf(obj)
  while (proto !== null) {
    if (proto === target) return true
    proto = Object.getPrototypeOf(proto)
  }
  return false
}

function createObject(proto) {
  if (typeof proto !== 'object' && typeof proto !== 'function') {
    throw new TypeError('Object prototype may only be an Object or null')
  }
  // F.prototype 不是对象时，new F() 的原型会退回 Object.prototype，所以模拟不了 null
  if (proto === null) throw new Error('这个 polyfill 不支持 null')
  function F() {} // 空构造函数，new 的时候不执行任何初始化逻辑
  F.prototype = proto
  return new F() // 新对象的原型就是 proto
}
```
