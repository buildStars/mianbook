---
difficulty: 2
tags: [高频, 原理]
---

# Node.js 的模块是怎么加载和查找的？

::: tip 一句话回答
`require(X)` 先看 X 是不是**核心模块**（如 `fs`，带 `node:` 前缀的一定是核心模块）；以 `./`、`../`、`/` 开头的按**路径**查找，依次尝试原文件名、补 `.js` / `.json` / `.node` 扩展名，是目录就找 `package.json` 的 `main`，再找 `index.js`；剩下的裸模块名从当前目录的 `node_modules` 开始**逐级向上**查找。模块第一次加载后按完整路径**缓存**，再次 `require` 直接返回缓存的 `exports`，所以循环依赖时拿到的是对方**还没执行完**的 `exports`。`package.json` 的 `exports` 字段可以按 `import` / `require` 等条件指向不同文件，并且没有声明的子路径不允许导入。ESM 的相对导入必须写完整的扩展名，不会自动补全，也不会找目录下的 `index.js`。
:::

## 详细解析

### require 的查找顺序

```text
require(X)，调用方所在目录为 D
1. X 是核心模块 → 直接返回（node:fs、fs）
2. X 以 ./ ../ / 开头 → 按路径查找
   a. 当作文件：X → X.js → X.json → X.node
   b. 当作目录：X/package.json 的 main → X/index.js → X/index.json → X/index.node
3. X 以 # 开头 → 按最近 package.json 的 imports 字段映射（子路径导入）
   X 是当前包自己的名字且声明了 exports → 按自己的 exports 解析（自引用）
4. 裸模块名（lodash、@scope/pkg/sub）
   → D/node_modules → D/../node_modules → ... → 根目录的 node_modules
   → 找到包后，有 exports 字段按 exports 解析，否则按上面 2 的规则
5. 都找不到 → 抛出 MODULE_NOT_FOUND
```

- 每次查找前先看缓存。缓存的键是解析后的**绝对路径**（默认会把符号链接解析成真实路径）。在不区分大小写的文件系统上，`require('./foo')` 和 `require('./FOO')` 指向同一个文件，却会被当成两个模块各执行一次
- `require.resolve(X)` 只解析路径不执行，`require.resolve.paths(X)` 能看到会依次查找哪些 `node_modules` 目录
- 逐级向上查找就是 monorepo 和[幽灵依赖](/basics/node/10-package-managers)能"碰巧能用"的原因：上层目录的 `node_modules` 里有，就能找到

### 模块缓存和循环依赖

模块代码只在第一次 `require` 时执行一次，结果保存在 `require.cache` 中。Node.js 在**执行模块代码之前**就把它放进缓存，所以出现循环依赖时不会死循环，而是拿到对方当前的 `exports`：

```js
// a.js（入口）
exports.done = false
const b = require('./b')
console.log('a 中看到 b.done =', b.done) // true
exports.done = true

// b.js
const a = require('./a') // a 还停在 require('./b') 这一行，拿到的是未完成的 exports
console.log('b 中看到 a.done =', a.done) // false
exports.done = true
```

如果 a 后面写的是 `module.exports = {...}` 整体替换，b 手里拿着的仍是旧对象，永远看不到新导出。ESM 的循环依赖行为不同，见 [ES Module 和 CommonJS 的区别](/basics/javascript/17-esm-vs-cjs)。

### package.json 的 main、exports、type

| 字段 | 作用 |
| --- | --- |
| `main` | 包的入口文件，旧的写法，没有 `exports` 时生效 |
| `exports` | 包的公开入口，优先级高于 `main`；可以按条件区分，并且**封装**内部文件 |
| `imports` | 包内部的别名，键必须以 `#` 开头，如 `#utils` |
| `type` | 决定 `.js` 文件按 ESM（`"module"`）还是 CommonJS（默认）处理 |

```json
{
  "name": "my-lib",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.cjs"
    },
    "./utils": "./dist/esm/utils.js",
    "./package.json": "./package.json"
  }
}
```

- **条件导出**：`import` 匹配 `import` 和 `import()`，`require` 匹配 `require()`，`node` 匹配 Node.js 环境，`default` 兜底。Node.js 按对象里的**书写顺序**取第一个匹配的条件，所以 `default` 要放最后，TypeScript 用的 `types` 一般放最前
- **限制深层导入**：声明了 `exports` 后，`require('my-lib/src/internal.js')` 会抛出 `ERR_PACKAGE_PATH_NOT_EXPORTED`，连 `package.json` 本身都要显式导出才能读取。给已有的包加上 `exports` 可能让依赖深层路径的使用者报错，属于破坏性变更

### ESM 的解析规则

- 相对路径和绝对路径必须写**完整文件名**：`import './utils.js'`，写成 `'./utils'` 会报 `ERR_MODULE_NOT_FOUND`；也不会自动找目录下的 `index.js`
- 不支持 `NODE_PATH` 和 `require.extensions`，裸模块名同样从 `node_modules` 逐级向上查找，再按 `exports` 解析
- 在 ESM 里能 `import` CommonJS 模块；反过来，较新的 Node.js 中 `require()` 也能加载不含顶层 await 的 ES 模块，具体版本和限制见 [ES Module 和 CommonJS 的区别](/basics/javascript/17-esm-vs-cjs)，需要兼容旧版本时仍然用 `import()`

## 面试官可能追问

::: details 怎么让一个模块在测试里重新执行一次？
删除缓存后再 `require`：`delete require.cache[require.resolve('./config')]`。这只对 CommonJS 有效，ESM 的模块缓存没有公开的删除接口。测试中更常见的做法是用测试框架的模块 mock 功能，或者把模块改写成导出工厂函数，每次调用都创建新实例。
:::

::: details 为什么同一个包在项目里被加载了两份？
缓存按解析后的绝对路径区分。依赖树中同一个包有两个版本、或者同一个版本被装在两个不同的 `node_modules` 目录里（依赖分身），就会解析到两个路径、执行两次，模块级的单例和 `instanceof` 判断都会出问题。用 `npm ls <包名>` 查看依赖树，再通过调整依赖版本或包管理器的去重让它们合并。
:::

::: details 双模式包（同时提供 ESM 和 CJS）有什么坑？
同一个应用里，一部分代码 `import` 它、另一部分 `require` 它，会分别加载 ESM 版本和 CJS 版本，模块级状态各有一份，这叫"双包风险"（dual package hazard）。规避办法是让两个入口共用同一份状态，比如 ESM 入口只是对 CJS 实现的薄包装；或者只发布一种格式。
:::

## 易错点

- 认为 `require` 先找当前目录的同名文件：裸模块名只会去 `node_modules` 找，不会找 `./lodash.js`
- 在 ESM 中省略 `.js` 扩展名，或者写 `import './dir'` 期望加载 `index.js`
- `exports` 中把 `default` 写在 `import` / `require` 前面，导致后面的条件永远匹配不到
- 循环依赖中用 `module.exports = ...` 整体替换导出，对方拿到的还是旧的空对象
