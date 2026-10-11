---
difficulty: 1
tags: [高频]
---

# var、let、const 有什么区别？

::: tip 一句话回答
`var` 是**函数作用域**，声明会被提升并初始化为 `undefined`，可以重复声明，在全局作用域声明时会成为 `window` 的属性。`let` 和 `const` 是**块级作用域**，同样会提升，但在声明语句执行之前处于**暂时性死区**，访问会报错，也不能在同一作用域内重复声明。`const` 声明时必须初始化，之后不能重新赋值，但如果值是对象，对象内部仍然可以修改。
:::

## 详细解析

### 对比

| | `var` | `let` | `const` |
| --- | --- | --- | --- |
| 作用域 | 函数作用域 | 块级作用域 | 块级作用域 |
| 声明之前访问 | 得到 `undefined` | ReferenceError（暂时性死区） | ReferenceError（暂时性死区） |
| 同一作用域内重复声明 | 可以 | SyntaxError | SyntaxError |
| 全局声明时成为 `window` 的属性 | 是 | 否 | 否 |
| 重新赋值 | 可以 | 可以 | TypeError |
| 声明时必须初始化 | 否 | 否 | 是 |

### 作用域

```js
if (true) {
  var a = 1
  let b = 2
}
console.log(a) // 1，var 只受函数作用域限制，块对它无效
console.log(b) // ReferenceError: b is not defined
```

`for` 循环中用 `let` 声明的变量，每次迭代都会创建一个新的绑定，循环里创建的闭包能拿到各自那一轮的值；用 `var` 则所有闭包共享同一个变量，经典的 `setTimeout` 例子见 [闭包](/basics/javascript/02-closure)。

### 提升和暂时性死区

`var` 声明会被提升到函数（或全局）作用域的顶部，并初始化为 `undefined`。`let` / `const` 也会提升，但不会被初始化：从进入块到声明语句执行之前，这段时间叫**暂时性死区**（TDZ），在这期间访问变量会抛 ReferenceError，连 `typeof` 也不例外：

```js
console.log(x) // undefined
var x = 1

typeof notDeclared // 'undefined'，从未声明的变量用 typeof 不会报错
typeof y // ReferenceError: Cannot access 'y' before initialization
let y = 2
```

函数声明会**整体提升**，可以在声明之前调用；函数表达式只提升变量：

```js
sayHi() // 正常执行
function sayHi() {}

sayBye() // TypeError: sayBye is not a function，此时 sayBye 还是 undefined
var sayBye = function () {}
```

如果函数表达式用 `let` / `const` 声明，提前调用会因为暂时性死区抛 ReferenceError。

### 全局变量与 window

在普通脚本的顶层，`var g = 1` 会让 `window.g` 变成 1，而 `let` / `const` 声明的变量不会成为 `window` 的属性。ES Module 的顶层是模块作用域，即使用 `var` 声明也不会挂到 `window` 上。

### const 与不可变

`const` 保证的是**变量的绑定不变**，不能重新赋值；如果值是对象，对象内部仍然可以修改。要禁止修改对象可以用 `Object.freeze`，但它只冻结一层（浅冻结）：

```js
const user = { name: 'Tom' }
user.name = 'Jerry' // 可以，修改的是对象内部

const frozen = Object.freeze({ name: 'Tom', tags: ['a'] })
frozen.name = 'Jerry' // 非严格模式下静默失败，严格模式下抛 TypeError
frozen.tags.push('b') // 可以，嵌套的数组没有被冻结
console.log(frozen.name, frozen.tags.length) // Tom 2

user = {} // TypeError: Assignment to constant variable.
```

## 面试官可能追问

::: details 举一个暂时性死区的例子？
```js
let x = 'outer'
function f() {
  console.log(x) // ReferenceError，而不是输出 'outer'
  let x = 'inner'
}
f()
```

函数里的 `let x` 从函数体开头就已经存在，遮蔽了外层的 `x`，只是在声明语句执行之前不能访问，这也说明 `let` 确实会提升。参数默认值里同样有暂时性死区：`function f(a = b, b = 1) {}` 调用 `f()` 会报错，因为计算 `a` 的默认值时 `b` 还没有初始化。
:::

::: details 怎样让对象真正不可变？
递归地对每一层调用 `Object.freeze`：

```js
function deepFreeze(obj) {
  Object.freeze(obj)
  for (const value of Object.values(obj)) {
    // 先冻结自身再递归，遇到已冻结的对象就跳过，循环引用也不会死循环
    if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
      deepFreeze(value)
    }
  }
  return obj
}
```

TypeScript 的 `readonly` 和 `as const` 只在编译期检查，不会阻止运行时的修改。
:::

::: details 实际开发中怎么选？
默认用 `const`；需要重新赋值时（如计数器、累加变量）才用 `let`；不再使用 `var`。ESLint 的 `prefer-const` 和 `no-var` 规则可以自动检查。
:::

## 易错点

- `let` / `const` 也会提升，只是存在暂时性死区，说它们"不会提升"是不准确的
- `const` 限制的是重新赋值，不保证对象内容不变；`Object.freeze` 也只冻结一层
- 在暂时性死区里，`typeof` 也会报错
