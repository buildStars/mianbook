---
difficulty: 1
tags: [高频]
---

# 箭头函数和普通函数有什么区别？

::: tip 一句话回答
箭头函数**没有自己的 this**，它沿用定义时外层作用域的 `this`，`call`、`apply`、`bind` 也改变不了。它也没有自己的 `arguments`、`super` 和 `new.target`，没有 `prototype` 属性，不能用 `new` 调用，也不能作为 Generator。适合写需要沿用外层 `this` 的回调，不适合写需要动态 `this` 的对象方法和事件处理函数。
:::

## 详细解析

### 主要区别

| | 普通函数 | 箭头函数 |
| --- | --- | --- |
| `this` | 调用时确定，取决于调用方式 | 没有自己的，沿用定义时外层作用域的 `this` |
| `call` / `apply` / `bind` | 可以改变 `this` | 改变不了 `this`，但传入的其他参数仍然有效 |
| `arguments` | 有 | 没有，访问到的是外层函数的；可以用剩余参数 `...args` 代替 |
| 用 `new` 调用 | 可以 | 抛出 TypeError，也没有 `prototype` 属性 |
| `new.target` | 用 `new` 调用时指向该函数 | 没有自己的，沿用外层的 |
| Generator | 可以写成 `function*` | 不能，函数体内不能使用 `yield` |

`super` 也是一样，箭头函数里的 `super` 取自外层的方法。`this` 的完整规则见 [this 的指向](/basics/javascript/04-this)，`new` 的执行过程见 [new 操作符](/basics/javascript/06-new)。

### 简写规则

```js
const double = (x) => x * 2 // 只有一个表达式：省略花括号，隐式返回
const add = (a, b) => {
  return a + b // 有花括号就要写 return
}
const getUser = () => ({ name: 'Tom' }) // 返回对象字面量要加圆括号
const wrong = () => { name: 'Tom' } // ❌ 花括号被当成函数体，返回 undefined
const sum = (...nums) => nums.reduce((a, b) => a + b, 0) // 用剩余参数代替 arguments
```

### 输出题

```js
const obj = {
  value: 1,
  normal() {
    return this.value
  },
  arrow: () => this,
  create() {
    return () => this.value
  },
}

console.log(obj.normal()) // 1
console.log(obj.arrow() === obj) // false
const fn = obj.create()
console.log(fn()) // 1
console.log(fn.call({ value: 2 })) // 1
console.log(obj.create.call({ value: 3 })()) // 3
```

- `obj.normal()`：普通函数作为方法调用，`this` 是 `obj`
- `obj.arrow()`：对象字面量的花括号不是作用域，箭头函数拿到的是 `obj` 外面那层的 `this`（ES 模块中是 `undefined`，浏览器的普通脚本中是 `window`），不是 `obj`
- `fn()`：箭头函数是在 `create` 执行时创建的，它的 `this` 就是那次调用的 `this`，也就是 `obj`
- `fn.call({ value: 2 })`：`call` 改变不了箭头函数的 `this`，仍然输出 1
- `obj.create.call({ value: 3 })()`：改变的是外层 `create` 的 `this`，箭头函数跟着外层走，输出 3

### 适合与不适合的场景

不适合：需要通过 `this` 访问对象本身的对象方法（如上面的 `obj.arrow`）和原型方法（`Person.prototype.say = () => {}` 里的 `this` 也不是实例），以及需要 `this` 指向触发元素的事件回调。适合：数组方法（`map`、`filter` 等）的回调，以及定时器、Promise 等回调中需要沿用外层 `this` 的场景。

```js
// ❌ 事件回调：this 不是 button，要改用 e.currentTarget
button.addEventListener('click', (e) => {
  this.classList.add('active')
})

// ✅ 定时器回调里沿用外层的 this
class Timer {
  seconds = 0
  start() {
    setInterval(() => {
      this.seconds++ // this 是 Timer 实例
    }, 1000)
  }
}
```

## 面试官可能追问

::: details class 字段中定义的箭头函数方法有什么特点？
```js
class Button {
  label = '提交'
  handleClick = () => {
    console.log(this.label)
  }
}

const { handleClick } = new Button()
handleClick() // 输出：提交
```

- `this` 固定指向实例，单独拿出来当回调也不会丢失，React 类组件中常这样写
- 它是实例属性，不在原型上，每创建一个实例就多一个函数
- 子类不能通过 `super.handleClick()` 调用它；子类用普通方法重写同名方法也不起作用，因为父类构造时添加的实例属性会遮蔽原型上的方法
:::

::: details Vue 选项式 API 的 methods 为什么不能用箭头函数？
Vue 会用 `bind` 把 `methods` 中的每个函数绑定到组件实例上，所以普通函数里的 `this` 指向组件实例。箭头函数没有自己的 `this`，`bind` 对它无效，`this` 是定义时外层作用域的 `this`（单文件组件的脚本按 ES 模块处理，这里是 `undefined`），访问 `this.count` 就会报错。`watch` 的回调和生命周期钩子同理。
:::

::: details 箭头函数编译成 ES5 后，this 是怎么实现的？
ES5 没有箭头函数，Babel 这类工具会在外层函数里先保存一份 `var _this = this`，再把箭头函数改成普通函数，函数体里的 `this` 全部换成 `_this`。用到 `arguments` 时也一样，改成外层保存的 `_arguments`。这说明箭头函数的 `this` 只是按词法作用域查找外层的变量，本身不涉及任何绑定，所以 `call`、`bind` 对它无效。
:::


## 易错点

- 对象字面量的花括号不形成作用域，对象里的箭头函数拿到的是对象外面的 `this`
- `call` / `apply` / `bind` 改变不了箭头函数的 `this`
- 返回对象字面量要写成 `() => ({ ... })`，不加圆括号会被当成函数体
