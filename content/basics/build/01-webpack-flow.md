---
difficulty: 2
tags: [高频, 原理]
---

# Webpack 的构建流程是怎样的？

::: tip 一句话回答
webpack 的构建可以分成三段：**初始化**（合并配置和命令行参数，创建 **Compiler**，注册插件）、**编译**（从入口出发，对每个模块先用 **loader** 转换，再解析成 AST 找出依赖，递归处理，得到完整的**模块依赖图**）、**输出**（按入口和动态导入把模块组装成 **chunk**，生成带运行时的代码，写入输出目录）。整个过程由 **Tapable** 钩子串起来，插件就是在这些钩子上插入逻辑。
:::

## 详细解析

### 三个阶段

1. **初始化**：读取 `webpack.config.js`，和命令行参数、默认配置合并成最终配置；创建 Compiler 对象，依次调用每个插件的 `apply(compiler)`，再根据配置注册内置插件（比如根据 `entry` 注册入口插件）
2. **编译（make）**：`compiler.run()` 后创建一个 Compilation，从每个入口开始构建模块：
   - 解析模块路径（resolve），找到对应的文件
   - 按 `module.rules` 匹配 loader，把文件内容转换成 JavaScript
   - 用 JavaScript 解析器（webpack 内部用 acorn）把代码解析成 AST，找出 `import`、`require`、`import()` 等依赖
   - 对每个依赖重复上面的过程，直到所有模块都处理完
3. **输出（seal 和 emit）**：
   - 根据入口和 `import()` 把模块分配到 chunk，再按 `splitChunks` 等规则优化（见 [代码分割](/basics/build/05-code-splitting)）
   - 做 tree shaking 标记、模块合并（scope hoisting）、压缩等优化
   - 为每个 chunk 生成最终代码，和运行时代码一起变成输出资源（asset）
   - 写入 `output.path`，触发 `done` 钩子

```text
config + CLI 参数
      │ 合并
      ▼
  Compiler ── 调用每个插件的 apply()
      │ run
      ▼
 Compilation ── make：入口 → resolve → loader → 解析 AST → 收集依赖 → 递归
      │            得到模块依赖图
      │ seal：模块 → chunk → 优化 → 生成代码 → processAssets
      ▼
   emit：写入磁盘 → done
```

### Compiler 和 Compilation

| | Compiler | Compilation |
| --- | --- | --- |
| 生命周期 | 整个 webpack 进程只有一个 | 每次构建创建一个，watch 模式下每次文件变化都会新建 |
| 持有的内容 | 最终配置、文件系统、全局钩子 | 本次构建的模块、chunk、资源、错误和警告 |
| 常用钩子 | `run`、`compile`、`thisCompilation`、`make`、`emit`、`done` | `buildModule`、`finishModules`、`seal`、`processAssets` |

插件一般先在 Compiler 的 `thisCompilation` 或 `compilation` 钩子里拿到 Compilation，再去 tap Compilation 的钩子，写法见 [Loader 和 Plugin](/basics/build/02-loader-plugin)。

### Tapable 钩子

webpack 的钩子都来自 Tapable 库，按执行方式分成几类：

| 钩子类型 | 行为 | 例子 |
| --- | --- | --- |
| `SyncHook` | 同步，依次调用 | `compiler.hooks.compilation` |
| `SyncBailHook` | 同步，某个回调返回非 `undefined` 就停止 | `compiler.hooks.shouldEmit` |
| `AsyncSeriesHook` | 异步，串行执行 | `compiler.hooks.run`、`emit` |
| `AsyncParallelHook` | 异步，并行执行 | `compiler.hooks.make` |

同步钩子只能用 `tap` 注册；异步钩子还可以用 `tapAsync`（回调风格）或 `tapPromise`（返回 Promise）。

### 产物里的运行时

浏览器不认识 webpack 的模块图，所以输出的代码里会带一段**运行时**：所有模块被包成函数放进一张模块表，由 `__webpack_require__` 按 id 加载并缓存。下面是简化后的样子，结构和真实产物一致：

```js
;(() => {
  // 模块表：key 是模块 id（开发模式下是路径，生产模式下是数字），value 是包装后的模块函数
  const modules = {
    './src/math.js': (module, exports, require) => {
      require.d(exports, { cube: () => cube }) // ESM 导出被改写成 getter，实现活绑定
      function cube(x) {
        return x * x * x
      }
    },
    './src/index.js': (module, exports, require) => {
      const math = require('./src/math.js') // import 被改写成 __webpack_require__
      console.log(math.cube(3))
    },
  }

  const cache = {}
  function __webpack_require__(id) {
    if (cache[id]) return cache[id].exports // 每个模块只执行一次
    const module = (cache[id] = { exports: {} })
    modules[id](module, module.exports, __webpack_require__)
    return module.exports
  }
  __webpack_require__.d = (exports, getters) => {
    for (const key in getters) {
      Object.defineProperty(exports, key, { enumerable: true, get: getters[key] })
    }
  }

  __webpack_require__('./src/index.js') // 从入口开始执行
})()
```

异步 chunk 由运行时里的 `__webpack_require__.e` 负责：插入 `script` 标签加载 chunk 文件，chunk 加载后把自己的模块注册进模块表，再执行。生产模式下开启 scope hoisting 后，能合并的 ESM 模块会被拼进同一个函数作用域，模块表会小很多。

## 面试官可能追问

::: details loader 和 plugin 分别在流程的哪一步起作用？
loader 只在编译阶段构建单个模块时起作用，负责把文件内容转换成 webpack 能解析的 JavaScript。plugin 通过钩子介入整个生命周期，从初始化到输出都能参与，比如在 `processAssets` 阶段修改或新增输出文件。
:::

::: details 为什么 webpack 开发环境冷启动慢？
webpack 的 dev server 要先把整个模块依赖图构建完、打包到内存里才能提供服务，项目越大，启动越慢。Vite 开发时不打包，浏览器请求哪个模块才编译哪个，所以启动时间基本不随项目规模增长，见 [Vite 为什么快](/basics/build/03-vite)。
:::

::: details webpack 5 的持久化缓存是什么？
配置 `cache: { type: 'filesystem' }` 后，webpack 会把模块构建结果、解析结果等缓存到磁盘（默认在 `node_modules/.cache/webpack`），下次启动时没有变化的模块直接复用。配置文件和 loader 变化时缓存需要失效，一般在 `cache.buildDependencies` 里加上 `config: [__filename]`。
:::

::: details 怎么看一次构建里各个模块的大小和依赖关系？
用 `webpack --json > stats.json` 导出构建信息，再交给 webpack-bundle-analyzer 之类的工具看各个 chunk 里有哪些模块、各占多大。stats 里也有每个模块的引用来源，可以查清某个大依赖是从哪里引进来的。
:::

## 易错点

- Compiler 只有一个，Compilation 每次构建都会新建；在 watch 模式下把状态存在 Compilation 上，下次构建就丢了
- 依赖收集靠的是解析 AST，不是执行代码。`import('./locale/' + lang)` 这类带表达式的路径，webpack 会把整个目录下匹配的文件都打包进来；路径完全是变量时，只能给出警告，无法打包
- loader 处理完的结果必须是 webpack 能解析的模块（JavaScript，或 webpack 5 支持的 asset、JSON 等类型），否则会报 "Module parse failed"
