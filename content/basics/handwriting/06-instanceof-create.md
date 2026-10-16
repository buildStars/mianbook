---
difficulty: 2
tags: [手写题, 原理]
---

# 手写 instanceof 和 Object.create：原理是什么？

::: tip 一句话回答
`a instanceof B` 沿着 a 的原型链往上找，某一层等于 `B.prototype` 就返回 true，找到 null 还没有就返回 false；手写时用 `Object.getPrototypeOf` 循环，左边是原始值直接返回 false。它会优先调用右侧的 `Symbol.hasInstance`，所以判断逻辑可以被自定义。`Object.create(proto, descriptors)` 创建一个以 proto 为原型的新对象，第二个参数用属性描述符定义它自身的属性；经典 polyfill 是用一个空构造函数，把它的 prototype 设为 proto 再 new，只能处理第一个参数。`Object.create(null)` 创建没有原型的对象，适合做字典、防原型污染。跨 iframe 时每个页面有自己的 Array，instanceof 会失效，判断数组要用 `Array.isArray`。
:::

## 详细解析

### instanceof 的判断过程

1. 右侧不是对象，抛 TypeError
2. 右侧有自定义的 `Symbol.hasInstance` 方法，就调用它，结果转成布尔值返回
3. 否则右侧必须是函数，不是就抛 TypeError；左侧是原始值，返回 false
4. 取右侧的 `prototype`，不是对象就抛 TypeError（比如箭头函数没有 prototype），再沿左侧的原型链逐层比较

所有函数都从 `Function.prototype` 继承了一个默认的 `Symbol.hasInstance`，它做的就是第 3 步的原始值判断和第 4 步的原型链查找，所以平时说的"沿原型链查找"指的就是这个默认实现。原型链本身见 [原型和原型链](/basics/javascript/03-prototype-chain)。

## 代码示例：手写 instanceof

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

class Animal {}
class Dog extends Animal {}
const dog = new Dog()
console.log(myInstanceof(dog, Dog), myInstanceof(dog, Animal), myInstanceof(dog, Object)) // true true true
console.log(myInstanceof(dog, Array), myInstanceof(1, Number), myInstanceof(new Number(1), Number)) // false false true

// Symbol.hasInstance 让 instanceof 不再依赖原型链
class Even {
  static [Symbol.hasInstance](n) {
    return Number.isInteger(n) && n % 2 === 0
  }
}
console.log(2 instanceof Even, myInstanceof(2, Even), myInstanceof(3, Even)) // true true false
```

和原生 instanceof 相比，这里没有处理 bind 返回的函数：它没有自己的 prototype，原生会改用原函数的 prototype 来判断。

## 代码示例：Object.create 和 polyfill

```js
const base = { greet() { return `hi, ${this.name}` } }
// 第二个参数和 Object.defineProperties 的格式一样，没写的特性默认是 false
const user = Object.create(base, { name: { value: 'Tom', enumerable: true } })
console.log(user.greet(), Object.getPrototypeOf(user) === base) // hi, Tom true

// 经典 polyfill：只支持第一个参数
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
const user2 = createObject(base)
user2.name = 'Jerry'
console.log(user2.greet(), Object.getPrototypeOf(user2) === base) // hi, Jerry true
```

polyfill 是给没有 `Object.create` 的老环境（ES3）用的：这些环境没有 `Object.defineProperties`，第二个参数无从实现；null 则受限于上面注释里说的 new 的行为。现在要指定原型，直接用 `Object.create`，或者字面量写法 `{ __proto__: proto }`。`new` 的第一步就相当于 `Object.create(Fn.prototype)`，见 [new 操作符做了什么](/basics/javascript/06-new)。

### Object.create(null) 的用途

```js
const dict = Object.create(null) // 没有原型，等价于 { __proto__: null }
dict.toString = 'a'
dict.__proto__ = 'b' // 没有继承 __proto__ 访问器，这里只是新增一个普通属性
console.log(Object.keys(dict), 'toString' in {}) // [ 'toString', '__proto__' ] true

const plain = {}
plain['__proto__'] = { polluted: true } // 普通对象：改的是原型，而不是新增属性
console.log(Object.keys(plain), plain.polluted) // [] true
```

- **做字典**：键来自用户输入或外部数据时，不会和 `toString`、`constructor` 这些继承来的属性冲突，`key in dict` 的结果也可靠
- **防原型污染**：对它赋值 `__proto__` 不会修改任何原型。例如 Node 的 `querystring.parse` 返回的就是没有原型的对象，查询参数里出现 `__proto__` 也只是一个普通的键
- **代价**：没有 `toString`、`hasOwnProperty` 这些方法，`String(dict)` 和模板字符串拼接都会抛 TypeError，判断自身属性要用 `Object.hasOwn(dict, key)`。只是存取键值的话，用 Map 也可以

### 跨 iframe 时 instanceof 失效

每个 iframe 有自己独立的一套全局对象，iframe 里创建的数组，原型是 iframe 自己的 `Array.prototype`：

```js
const iframe = document.body.appendChild(document.createElement('iframe'))
const arr = new iframe.contentWindow.Array(1, 2)
console.log(arr instanceof Array) // false：原型链上找不到当前页面的 Array.prototype
console.log(Array.isArray(arr), Object.prototype.toString.call(arr)) // true '[object Array]'
```

Node 里用 `vm.runInNewContext('[]')` 创建的数组也一样。判断数组用 `Array.isArray`，其他内置类型可以用 `Object.prototype.toString.call(x)`（对象可以通过 `Symbol.toStringTag` 改写这个结果）。

## 面试官可能追问

::: details instanceof 的结果可靠吗？
不完全可靠，它只说明原型链上有某个对象，而原型链可以被改动：`Object.setPrototypeOf` 能改对象的原型；构造函数的 `prototype` 被重新赋值后，之前创建的实例再判断就是 false；`Symbol.hasInstance` 可以让任何值通过检查；跨 iframe 时还会误判。判断内置类型优先用 `Array.isArray`、`typeof`，业务对象可以检查它是否有需要的方法和属性。
:::

::: details instanceof 和 isPrototypeOf 有什么区别？
`B.prototype.isPrototypeOf(a)` 和默认的 `a instanceof B` 结果一样，都是检查原型链。区别是 isPrototypeOf 直接拿原型对象来比，不需要构造函数，适合用 `Object.create` 搭起来、没有构造函数的原型链；它也不会调用 `Symbol.hasInstance`。
:::

::: details Object.create 的第二个参数和直接赋值有什么区别？
直接赋值创建的属性可写、可枚举、可配置；第二个参数是属性描述符，没写的特性默认都是 false。比如 `Object.create(base, { age: { value: 18 } })` 得到的 `age` 不可修改，`Object.keys` 里也看不到，严格模式下给它赋值会抛 TypeError。想和普通属性一样，要把 `writable`、`enumerable`、`configurable` 都写成 true。
:::

## 易错点

- `1 instanceof Number` 是 false，原始值不在任何原型链上；`new Number(1) instanceof Number` 才是 true
- 手写 instanceof 时比较的是右侧的 `prototype`，不是右侧本身，也不是 `constructor` 属性
- polyfill 里如果不拦截 null，`F.prototype = null` 之后 `new F()` 不会报错，得到的却是以 `Object.prototype` 为原型的普通对象，很容易误以为模拟成功了
