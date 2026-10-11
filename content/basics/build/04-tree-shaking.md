---
difficulty: 2
tags: [高频, 原理, 性能优化]
---

# Tree Shaking 的原理是什么？什么情况下会失效？

::: tip 一句话回答
Tree shaking 依赖 **ES Module 的静态结构**：打包工具不执行代码就能知道每个模块导出了什么、被用到了什么。webpack 分两步做：构建时**标记**没被使用的导出，压缩阶段由 terser 等压缩器把这些**死代码删掉**。删之前还要确认代码没有**副作用**，所以库要用 `package.json` 的 **`sideEffects`** 声明哪些文件可以整体跳过。常见的失效原因有：用了 CommonJS、Babel 把 ESM 转成了 CommonJS、动态访问导出、模块顶层有副作用。
:::

## 详细解析

### 为什么依赖 ESM

ESM 的 `import` / `export` 只能写在模块顶层，导入导出的名字是固定的，静态分析就能得到完整的依赖和使用关系。CommonJS 的 `require` 可以写在条件里、路径可以拼接，`module.exports` 也能在运行时修改，打包工具很难确定哪些导出一定用不到。两者的区别见 [ES Module 和 CommonJS](/basics/javascript/17-esm-vs-cjs)。

### webpack 的两步

1. **标记**（`optimization.usedExports`，生产模式默认开启）：分析每个导出有没有被用到，没用到的导出不再生成导出代码。开发模式下手动开启，产物里能看到 `/* unused harmony exports square */` 这样的注释，但函数本身还在
2. **删除**（`optimization.minimize`）：压缩器发现这些函数没人引用、也没有副作用，就把它们删掉

另外两个相关优化：

- **`optimization.sideEffects`**：读取 `package.json` 的 `sideEffects` 字段。被标记为无副作用的模块，如果导出一个都没被用到，**整个模块和它的依赖子树**都会被跳过，比逐个删除导出有效得多
- **`optimization.innerGraph`**：分析模块内部顶层变量之间的引用，比如未使用的导出函数里引用的另一个函数，也能一起删掉

### 副作用和 sideEffects

副作用指模块执行时除了导出以外还做了别的事，比如修改全局变量、注册 polyfill、插入样式。打包工具无法判断这些代码能不能删，只能保守地保留。

```json
{
  "name": "my-lib",
  "sideEffects": ["*.css", "./src/polyfill.js"]
}
```

`"sideEffects": false` 表示包里所有文件都没有副作用；用数组列出有副作用的文件。最常见的坑是写了 `false`，结果 `import './style.css'` 这种只为副作用而导入的 CSS 在生产环境被删掉了。

### `/*#__PURE__*/` 注释

```js
export const store = /*#__PURE__*/ createStore()
```

压缩器不知道 `createStore()` 有没有副作用，默认会保留这次调用。加上 `/*#__PURE__*/` 是告诉它"这次调用没有副作用，结果没人用就可以删"。很多编译器会自动加，比如 Babel 把 class 降级成函数时、Vue 编译 SFC 生成的 `defineComponent(...)` 调用。注释只覆盖这一次调用，参数里的调用需要单独标注。

### 常见的失效场景

| 场景 | 原因 |
| --- | --- |
| 依赖只发布了 CommonJS 版本 | 无法可靠地静态分析，大多会整体保留 |
| Babel 把 ESM 转成了 CommonJS | `@babel/preset-env` 的 `modules` 设为 `'commonjs'`；Babel 7 在没有调用方信息时（比如直接用 `@babel/cli` 编译库）默认也会转。通过 babel-loader 调用时会保留 ESM |
| 动态访问导出 | `import * as utils` 后用 `utils[name]()`，打包工具不知道用了哪个，只能全部保留 |
| 模块顶层有副作用 | 顶层的函数调用、修改全局对象、给原型挂方法（如 `Object.defineProperty(Foo.prototype, ...)`）都可能让整段代码被保留 |
| `sideEffects` 没写或写错 | 没写时模块不能被整体跳过，顶层代码和它的依赖都会保留；错写成 `false` 则可能把有副作用的文件删掉 |
| 从入口文件整体再导出 | `index.js` 里 `export * from` 一大堆，其中某个文件有副作用，就会被连带打包 |

webpack 5 能识别一部分写法简单的 CommonJS（如 `exports.foo = ...`），但不要依赖这一点，库还是应该提供 ESM 版本。

### 怎么验证

- 开发模式下打开 `usedExports`，看产物里的 `unused harmony export` 注释，确认标记是否正确
- 在没被使用的函数里写一个独特的字符串，生产构建后在产物里搜它
- 用 webpack-bundle-analyzer、`rollup-plugin-visualizer` 之类的工具看哪个依赖占了大头，再查原因，见 [打包体积优化](/basics/build/09-bundle-size)

## 代码示例

```js
// utils.js
export function used() {
  return 'used'
}
export function unused() {
  return 'UNUSED_FN' // ✅ 生产构建后被删除
}
export const pureVal = /*#__PURE__*/ createThing('PURE_CALL') // ✅ 被删除
export const impureVal = createThing('IMPURE_CALL') // ❌ 调用保留：createThing 修改了全局变量

function createThing(name) {
  globalThis.registry = (globalThis.registry || []).concat(name)
  return { name }
}

// index.js
import { used } from './utils.js'
console.log(used())
```

## 面试官可能追问

::: details 为什么 lodash 要换成 lodash-es？
`lodash` 是 CommonJS 包，`import { debounce } from 'lodash'` 往往会把整个库打进来。`lodash-es` 是 ESM 版本，每个方法一个文件，能按需打包。也可以写成 `import debounce from 'lodash/debounce'`，只引入单个文件。
:::

::: details Tree shaking 能删掉没用到的 CSS 吗？
不能。tree shaking 处理的是 JS 模块的导出，CSS 文件只能整体保留或整体删除（取决于 `sideEffects`）。删除没用到的 CSS 规则要靠 PurgeCSS 这类工具扫描模板中用到的类名；Tailwind CSS 这类原子化方案本身就只生成用到的类。
:::

::: details 类的方法没用到能被删掉吗？
不能。tree shaking 的粒度是模块的导出和顶层声明，一个类只要被用到，它的所有方法都会保留，因为打包工具无法确定运行时会调用哪些方法（比如 `obj[name]()`）。想要更细的粒度，可以把功能拆成独立导出的函数，这也是很多工具库改成函数式 API 的原因之一。
:::

## 易错点

- tree shaking 不是 webpack 一步完成的，`usedExports` 只负责标记，真正删除靠压缩器，开发模式下看不到删除效果
- `"sideEffects": false` 写在应用的 `package.json` 里也会生效，项目里直接导入的 CSS 会被删掉
- 只用了一个导出，不代表只会打包这个导出：被导入模块的顶层副作用代码、它依赖的其他模块都可能被带进来
- Babel 转 ESM 的问题现在大多由 babel-loader 自动处理，但手动配置 `modules: 'commonjs'` 或单独编译的库产物仍然会踩到
