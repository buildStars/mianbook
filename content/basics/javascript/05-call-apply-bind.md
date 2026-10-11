---
difficulty: 2
tags: [高频, 手写题]
---

# call、apply、bind 有什么区别？手写 bind

::: tip 一句话回答
三者都能指定函数执行时的 `this`。`call` 逐个传参，`apply` 用数组（或类数组）传参，两者都会**立即执行**函数；`bind` 不执行函数，而是**返回一个新函数**，把 `this` 和预设的参数固定下来，可以用来实现偏函数。手写 bind 的关键是：返回的函数被 `new` 调用时，要忽略绑定的 `this`。
:::

## 详细解析

### 三者对比

| | `call` | `apply` | `bind` |
| --- | --- | --- | --- |
| 传参方式 | 逐个传：`fn.call(obj, 1, 2)` | 数组或类数组：`fn.apply(obj, [1, 2])` | 逐个传，绑定时和调用时可以分两次传 |
| 是否立即执行 | 是 | 是 | 否 |
| 返回值 | 函数的返回值 | 函数的返回值 | 绑定了 `this` 和参数的新函数 |

bind 可以预设一部分参数，得到一个偏函数：

```js
function add(a, b) {
  return a + b
}
const add10 = add.bind(null, 10) // 预设第一个参数
console.log(add10(5)) // 15
```

非严格模式下，传入 `null` 或 `undefined` 时 `this` 指向全局对象；传入原始值会被包装成对应的对象，例如 `fn.call(1)` 中的 `this` 是一个 Number 对象。严格模式下，函数拿到的就是传入的原值。

### 手写 call 和 apply

思路是把函数临时挂到目标对象上，以 `context.fn()` 的形式调用，利用隐式绑定让 `this` 指向目标对象：

```js
Function.prototype.myCall = function (context, ...args) {
  // 模拟非严格模式：null / undefined 换成全局对象，原始值包装成对象
  context = context == null ? globalThis : Object(context)
  // 用 Symbol 作临时属性的键，不会覆盖对象上已有的属性
  const key = Symbol('fn')
  context[key] = this // 这里的 this 就是调用 myCall 的那个函数
  const result = context[key](...args)
  delete context[key] // 调用完立即删除，不在对象上留下痕迹
  return result
}

// apply 只是参数形式不同：第二个参数是数组或类数组，也可以不传
Function.prototype.myApply = function (context, args) {
  return this.myCall(context, ...Array.from(args ?? []))
}

function sum(a, b) {
  return this.base + a + b
}
console.log(sum.myCall({ base: 10 }, 1, 2), sum.myApply({ base: 10 }, [1, 2])) // 13 13
```

### 手写 bind

需要处理两点：返回一个新函数，调用时把预设参数和新传入的参数拼在一起；新函数被 `new` 调用时，忽略绑定的 `this`，并且实例的原型要指向原函数的 `prototype`。

```js
Function.prototype.myBind = function (context, ...presetArgs) {
  const fn = this
  if (typeof fn !== 'function') {
    throw new TypeError('myBind 只能在函数上调用')
  }

  return function bound(...args) {
    const finalArgs = [...presetArgs, ...args]
    // 被 new 调用：忽略绑定的 this，直接 new 原函数，实例的原型就是 fn.prototype
    if (new.target) return new fn(...finalArgs)
    return fn.apply(context, finalArgs)
  }
}

function Person(name, age) {
  this.name = name
  this.age = age
}
const obj = {}
const BoundPerson = Person.myBind(obj, 'Tom')

BoundPerson(18) // 普通调用，this 是 obj
console.log(obj.name, obj.age) // Tom 18

const p = new BoundPerson(20) // new 调用，绑定的 obj 被忽略
console.log(p.name, p.age) // Tom 20
console.log(Object.getPrototypeOf(p) === Person.prototype) // true
```

早期常见的写法是用 `this instanceof bound` 判断是否被 `new` 调用，并设置 `bound.prototype = Object.create(fn.prototype)`。这样实例的原型是 `bound.prototype`，要再往上一层才是 `fn.prototype`。用 `new.target` 判断更直接，它的用法见 [new 操作符](/basics/javascript/06-new)。

## 面试官可能追问

::: details 多次 bind 会怎样？
只有第一次绑定的 `this` 生效，但预设的参数会累加：

```js
function f(...args) {
  return [this.id, ...args]
}
const g = f.bind({ id: 1 }, 'a').bind({ id: 2 }, 'b')
console.log(g('c')) // [1, 'a', 'b', 'c']
```

第一次 bind 返回的函数会忽略调用时传入的 `this`，所以第二次绑定的 `{ id: 2 }` 传不进去。
:::

::: details 箭头函数能被 call、apply、bind 改变 this 吗？
不能。箭头函数没有自己的 `this`，传入的 `this` 会被直接忽略，但参数照常传递，bind 也照样可以预设参数。详见 [箭头函数和普通函数的区别](/basics/javascript/18-arrow-function)。
:::

::: details apply 有哪些经典用法？
以前常用 apply 把数组"展开"成参数列表，比如 `Math.max.apply(null, arr)` 求最大值，`Array.prototype.push.apply(a, b)` 把 b 追加到 a 的末尾。ES2015 有了展开运算符后，直接写 `Math.max(...arr)`、`a.push(...b)` 即可。数组非常大时，两种写法都可能因为参数太多导致栈溢出，抛出 RangeError，这时改用循环或 `reduce`。
:::

## 易错点

- `bind` 只返回新函数，不会执行；需要立即执行用 `call` 或 `apply`
- 非严格模式下传入 `null` 时 `this` 是全局对象，严格模式下就是 `null`
- `bind` 返回的函数被 `new` 调用时，绑定的 `this` 会失效
