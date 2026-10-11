---
difficulty: 2
tags: [高频, 输出题]
---

# this 的指向有哪些规则？

::: tip 一句话回答
普通函数的 `this` 在**调用时**才确定，取决于怎么调用：直接调用是**默认绑定**，`obj.fn()` 是**隐式绑定**，`call` / `apply` / `bind` 是**显式绑定**，`new` 调用是 **new 绑定**，优先级为 new > 显式 > 隐式 > 默认。**箭头函数**没有自己的 `this`，用的是定义时外层作用域的 `this`。
:::

## 详细解析

### 绑定规则

| 规则 | 调用形式 | this 指向 |
| --- | --- | --- |
| 默认绑定 | `fn()` | 非严格模式下是全局对象（浏览器中是 `window`），严格模式下是 `undefined` |
| 隐式绑定 | `obj.fn()` | `obj`；`a.b.fn()` 只看最后一层，是 `a.b` |
| 显式绑定 | `fn.call(obj)`、`fn.apply(obj)`、`fn.bind(obj)()` | `obj`，见 [call、apply、bind](/basics/javascript/05-call-apply-bind) |
| new 绑定 | `new Fn()` | 新创建的实例，见 [new 操作符](/basics/javascript/06-new) |
| 箭头函数 | 任何形式（但不能用 `new` 调用） | 定义时外层作用域的 `this`，`call` / `apply` / `bind` 也改不了，见 [箭头函数](/basics/javascript/18-arrow-function) |

默认绑定看的是**函数自身**是否处于严格模式，与在哪里调用无关。ES Module 和 class 内部的代码默认就是严格模式。

优先级为 new > 显式绑定 > 隐式绑定 > 默认绑定：

```js
function setId(id) {
  this.id = id
}
const a = { id: 'a', setId }
const b = {}

a.setId.call(b, 'x') // 显式优先于隐式：修改的是 b
const instance = new (setId.bind(a))('y') // new 优先于 bind：修改的是新实例
console.log(a.id, b.id, instance.id) // a x y
```

### 隐式丢失

`this` 只看调用那一刻的形式。把方法赋值给变量，或者作为回调传出去，调用时前面没有了 `obj.`，就退化成默认绑定：

```js
const user = {
  id: 1,
  showId() {
    console.log(this.id)
  },
}

user.showId() // 1
const show = user.showId
show() // undefined：默认绑定，this 是 window（严格模式下 this 是 undefined，会抛 TypeError）
setTimeout(user.showId, 0) // undefined：传进去的只是函数本身，和 user 已经无关
```

### class 和 DOM 事件

class 内部的代码默认运行在严格模式。如果把实例的方法单独取出来调用，比如 `const inc = counter.inc` 之后再调用 `inc()`，方法里的 `this` 是 `undefined`，访问 `this.count` 会直接抛 TypeError。常见的解决办法是在构造函数里写 `this.inc = this.inc.bind(this)`，或者把方法写成箭头函数形式的类字段 `inc = () => { this.count++ }`。

DOM 事件的处理函数如果是普通函数，`this` 指向绑定监听器的元素，也就是 `event.currentTarget`。它不一定是 `event.target`：在父元素上监听时，`event.target` 可能是实际被点击的子元素（见 [事件委托](/basics/browser/04-event-delegation)）。

## 代码示例：综合输出题

以下代码在浏览器中以普通 `<script>` 运行（非模块、非严格模式）：

```js
var id = 'global'

const obj = {
  id: 'obj',
  normal() {
    return this.id
  },
  arrow: () => this.id,
  nested() {
    const inner = () => this.id
    return inner()
  },
}
const other = { id: 'other' }

console.log(obj.normal()) // ①
const fn = obj.normal
console.log(fn()) // ②
console.log(obj.arrow()) // ③
console.log(obj.nested()) // ④
console.log(obj.normal.bind(other)()) // ⑤
console.log(obj.arrow.call(other)) // ⑥
console.log(obj.nested.call(other)) // ⑦
```

输出依次是：`obj`、`global`、`global`、`obj`、`other`、`global`、`other`

- ①：隐式绑定，`this` 是 `obj`
- ②：隐式丢失，`fn()` 是默认绑定，`this` 是 `window`。顶层用 `var` 声明的变量会成为 `window` 的属性，所以输出 `global`
- ③：箭头函数取外层的 `this`。对象字面量不是作用域，外层就是全局作用域，`this` 是 `window`
- ④：`inner` 是箭头函数，继承 `nested` 被调用时的 `this`，也就是 `obj`
- ⑤：bind 显式绑定到 `other`
- ⑥：箭头函数的 `this` 改不了，`call` 传入的 `other` 被忽略，结果同 ③
- ⑦：`call` 让 `nested` 的 `this` 变成 `other`，`inner` 跟着继承

## 面试官可能追问

::: details 浏览器中 setTimeout 的回调里，this 是什么？
回调是普通函数时，`this` 是 `window`。浏览器的定时器会以全局对象作为 `this` 调用回调，所以即使回调是严格模式的函数，`this` 也是 `window`，而不是 `undefined`。Node.js 中则是 `setTimeout` 返回的那个 `Timeout` 对象。回调是箭头函数时，取外层作用域的 `this`。
:::

::: details 对一个函数多次 bind，this 是哪个？
只有第一次 bind 生效。第二次 bind 得到的函数，会用第二个对象去调用第一次 bind 的结果；而第一次 bind 的结果会忽略调用时传入的 `this`，始终用第一个对象调用原函数。不过每次 bind 预设的参数会依次累加。
:::

::: details 回调函数中怎样保持 this？
- 用箭头函数包一层：`setTimeout(() => user.showId(), 0)`
- 用 bind：`setTimeout(user.showId.bind(user), 0)`
- 部分 API 支持传入 `this`，例如 `arr.forEach(callback, thisArg)`
- 早期的写法是先保存 `const self = this`，在回调里使用 `self`
:::

## 易错点

- 普通函数的 `this` 由**调用方式**决定，与函数在哪里定义无关；箭头函数正好相反，只看定义的位置
- 对象字面量不构成作用域，用箭头函数定义对象方法时，`this` 不是这个对象
- 严格模式下默认绑定的 `this` 是 `undefined`，访问它的属性会直接抛 TypeError，而不是得到 `undefined`
