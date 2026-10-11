---
difficulty: 2
tags: [高频, 原理]
---

# ES Module 和 CommonJS 有什么区别？

::: tip 一句话回答
ES Module 用 `import` / `export`，是**静态**的，代码执行前就能确定依赖关系，所以支持 tree-shaking；导出的是**活绑定**，原模块修改变量后，导入方能读到新值。CommonJS 用 `require` / `module.exports`，在**运行时**同步加载，`require` 返回的是导出对象本身，把其中的值解构到本地变量后就不再同步。另外，ESM 默认是严格模式，并且支持顶层 await。
:::

## 详细解析

### 对比

| | ES Module | CommonJS |
| --- | --- | --- |
| 语法 | `import` / `export` | `require` / `module.exports` |
| 依赖分析 | 静态：`import` 只能写在模块顶层，执行前就能确定依赖 | 动态：执行到 `require` 才加载，可以写在条件语句和函数里 |
| 导出的内容 | 活绑定，导入方只读 | `module.exports` 对象 |
| 加载 | 异步 | 同步 |
| 严格模式 | 默认开启 | 需要手动开启 |
| 顶层 `this` | `undefined` | `module.exports` |
| 顶层 await | 支持 | 不支持 |
| tree-shaking | 支持 | 很难做到 |

动态导入 `import()` 返回 Promise，在两种模块中都能使用，常用于按需加载。

### 活绑定与导出对象

ESM 导入的是对原模块变量的绑定，原模块改了，导入方读到的也会变：

```js
// counter.mjs
export let count = 0
export function inc() {
  count++
}

// main.mjs
import { count, inc } from './counter.mjs'
console.log(count) // 0
inc()
console.log(count) // 1：读到的是原模块中的最新值
count = 10 // TypeError：导入的绑定是只读的
```

CommonJS 的 `require` 返回的是 `module.exports` 对象本身，并不是"把值复制一份"。断开发生在解构或赋给本地变量之后：本地变量保存的是当时的值，原模块之后再给这个属性赋新值（基本类型的修改都属于这种情况），本地变量不会跟着变：

```js
// counter.js
exports.count = 0
exports.inc = function () {
  exports.count++
}

// main.js
const counter = require('./counter')
const { count } = counter
counter.inc()
console.log(count) // 0：解构时拿到的是当时的值
console.log(counter.count) // 1：通过导出对象访问，能看到属性的变化
```

常见的 `module.exports = { count, inc }` 写法，在导出时就把 `count` 的值复制到了对象属性上，之后模块内部的 `count++` 只改局部变量，`counter.count` 不会变。

### Node.js 中怎么区分

- `.mjs` 按 ESM 处理，`.cjs` 按 CommonJS 处理
- `.js` 看最近的 `package.json` 中的 `"type"` 字段：`"module"` 按 ESM 处理，`"commonjs"` 按 CommonJS 处理，不写时默认是 CommonJS。Node.js 20.19、22.7 起，不写 `"type"` 的 `.js` 文件如果含有 `import` / `export` 等 ESM 语法，会自动改按 ESM 解析（有额外开销，最好明确写上 `"type"`）
- ESM 可以 `import` CommonJS 模块。Node.js 20.19、22.12 起，CommonJS 也能直接 `require` 不含顶层 await 的 ES 模块，得到它的模块命名空间对象；在不支持的版本中，只能用 `import()` 加载

### 循环依赖

- **CommonJS**：`require` 一个还没执行完的模块时，拿到的是它当前的 `module.exports`，也就是已经执行的那部分导出
- **ESM**：执行前就建立好了绑定。如果在对方的变量初始化之前访问它，会抛出 ReferenceError，原理和 `let` / `const` 的[暂时性死区](/basics/javascript/09-var-let-const)一样

```js
// a.mjs（入口）
import { b } from './b.mjs'
export const a = 'a'

// b.mjs
import { a } from './a.mjs'
export const b = 'b'
console.log(a) // ReferenceError：b.mjs 先执行，这时 a 还没有初始化
```

如果导出的是函数声明就不会报错，因为函数声明在模块代码执行前就已经初始化好了。

## 面试官可能追问

::: details 为什么 tree-shaking 依赖 ESM？
tree-shaking 要在打包时、不执行代码的情况下判断哪些导出没被用到。ESM 的 `import` / `export` 只能出现在顶层，导入导出的名字都是固定的，静态分析就能得到完整的依赖关系。CommonJS 的 `require` 可以动态拼接路径、写在条件里，`module.exports` 也能在运行时随意修改，打包工具无法安全地判断哪些代码没用。删除代码前还要确认它没有副作用，所以库通常会在 `package.json` 中用 `sideEffects` 字段声明。
:::

::: details 在 ES Module 中怎么获取当前文件所在的目录？
ESM 中没有 `__dirname`、`__filename` 和 `require`。Node.js 20.11 起可以直接用 `import.meta.dirname` 和 `import.meta.filename`；更早的版本这样写：

```js
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
```

需要 `require` 时，可以用 `node:module` 提供的 `createRequire(import.meta.url)` 创建一个。
:::

::: details 打包工具怎么处理两种模块混用？
- webpack 的运行时自己实现了 `require`、`module`、`exports`，两种模块可以互相引用；Rollup 则通过插件先把 CommonJS 转成 ESM 再打包
- 用 ESM 的默认导入引入 CommonJS 模块时，拿到的一般是整个 `module.exports`
- Babel、TypeScript 把 ESM 编译成 CommonJS 时，会加上 `__esModule` 标记。导入方的兼容代码看到这个标记，就取 `exports.default` 作为默认导入，否则取整个 `module.exports`
- CommonJS 的部分很难 tree-shaking，所以很多库同时发布 ESM 版本，用 `package.json` 的 `exports` 字段分别提供给 `import` 和 `require`
:::

## 易错点

- 不要简单地说"CommonJS 导出的是值的拷贝"：`require` 拿到的是导出对象本身，解构或赋值给变量后才与原模块断开
- ESM 导入的绑定不能重新赋值，但如果导入的是对象，可以修改它的属性，所有导入方都会看到变化
- `exports = { a: 1 }` 不会生效，因为 `exports` 只是 `module.exports` 的一个引用；要整体替换必须写 `module.exports = ...`
