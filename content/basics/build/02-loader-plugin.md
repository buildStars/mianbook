---
difficulty: 2
tags: [高频, 手写题, 对比]
---

# Webpack 的 Loader 和 Plugin 有什么区别？怎么写一个？

::: tip 一句话回答
**loader 是一个转换函数**：输入文件内容，输出转换后的内容，作用在单个模块上，让 webpack 能处理 JS 以外的文件（如 TS、Vue、CSS）。多个 loader 组成**链**，按配置**从右往左（从下往上）**执行。**plugin 是一个带 `apply` 方法的对象**：通过 Compiler 和 Compilation 上的**钩子**介入整个构建生命周期，能做 loader 做不到的事，比如生成 HTML、提取 CSS 文件、压缩、输出文件清单。
:::

## 详细解析

### 对比

| | Loader | Plugin |
| --- | --- | --- |
| 本质 | 导出一个函数 | 一个有 `apply(compiler)` 方法的类或对象 |
| 作用范围 | 单个模块的源码 | 整个构建过程：模块、chunk、输出资源 |
| 执行时机 | 编译阶段构建模块时 | 在注册的钩子触发时 |
| 配置位置 | `module.rules[].use` | `plugins` 数组 |
| 例子 | babel-loader、ts-loader、css-loader、vue-loader | HtmlWebpackPlugin、MiniCssExtractPlugin、DefinePlugin |

### loader 链的执行顺序

以 `use: ['style-loader', 'css-loader', 'sass-loader']` 为例，数组里的 loader 从右往左执行：sass-loader 把 Sass 编译成 CSS，css-loader 处理 `@import` 和 `url()` 并转成 JS 模块，style-loader 生成把样式插入页面的代码。上一个 loader 的输出是下一个的输入，最后一个（最左边）必须输出 JavaScript。

### pitch 阶段

loader 还可以导出一个 `pitch` 方法。真正执行时分两个阶段：先**从左往右**依次调用各个 loader 的 `pitch`，再**从右往左**调用 loader 本身。如果某个 `pitch` 返回了非 `undefined` 的值，就跳过它右边的 loader 和读取文件，直接回到左边的 loader 继续执行。style-loader 就是在 pitch 阶段返回结果的：它生成的代码里用内联 loader 的方式 `require` 后面的 loader 处理结果，自己不需要拿到 CSS 字符串。

### loader 的几个要点

- loader 运行在 Node.js 中，`this` 是 webpack 提供的 loader 上下文；`this.getOptions(schema)` 读取配置里的 `options`（webpack 5 内置，传入 schema 会校验）
- 同步 loader 直接 `return`；异步时先 `const callback = this.async()`，再 `callback(err, content, sourceMap)`
- 默认接收 UTF-8 字符串；处理图片等二进制文件时设置 `module.exports.raw = true`，拿到的是 Buffer
- webpack 5 默认会缓存 loader 的结果，依赖了其他文件时用 `this.addDependency(file)` 声明，文件变化后才会重新执行

### plugin 的几个要点

- 在 `apply` 里通过 `compiler.hooks.xxx.tap(name, fn)` 注册回调；要处理本次构建的产物，先拿到 Compilation，再 tap 它的钩子
- webpack 5 里修改或新增输出文件，应该用 `compilation.hooks.processAssets` 加上合适的 `stage`，而不是在 `emit` 钩子里直接改 `compilation.assets`（会有弃用警告）

## 代码示例：手写 loader 和 plugin

去掉 `console.log` 的 loader（示意用的正则写法，只处理独占一行的调用）：

```js
// loaders/remove-console-loader.js
module.exports = function (source) {
  // webpack 5 内置 getOptions，传入 schema 时会顺带校验参数
  const { methods = ['log', 'debug'] } = this.getOptions({
    type: 'object',
    properties: { methods: { type: 'array', items: { type: 'string' } } },
  })
  // 只处理独占一行的简单调用；复杂场景用 AST（见 Babel 插件）或 terser 的 drop_console
  const re = new RegExp(`^\\s*console\\.(${methods.join('|')})\\(.*\\);?\\s*$`, 'gm')
  return source.replace(re, '')
}
```

输出文件清单的 plugin：

```js
// plugins/file-list-plugin.js
class FileListPlugin {
  static name = 'FileListPlugin'

  constructor({ filename = 'filelist.md' } = {}) {
    this.filename = filename
  }

  apply(compiler) {
    // 用 compiler 上挂的 webpack，避免和项目里的 webpack 版本不一致
    const { Compilation, sources } = compiler.webpack

    compiler.hooks.thisCompilation.tap(FileListPlugin.name, (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: FileListPlugin.name,
          // SUMMARIZE 阶段：其他资源都已生成、优化完
          stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
        },
        (assets) => {
          const lines = Object.keys(assets).map(
            (file) => `- ${file} (${assets[file].size()} bytes)`
          )
          compilation.emitAsset(
            this.filename,
            new sources.RawSource(`# 文件清单\n\n${lines.join('\n')}\n`)
          )
        }
      )
    })
  }
}

module.exports = FileListPlugin
```

```js
// webpack.config.js：使用上面的 loader 和 plugin
const path = require('node:path')
const FileListPlugin = require('./plugins/file-list-plugin')

module.exports = {
  mode: 'production',
  module: {
    rules: [{
      test: /\.js$/,
      exclude: /node_modules/,
      loader: path.resolve(__dirname, 'loaders/remove-console-loader.js'), // 本地 loader 直接写路径
      options: { methods: ['log'] },
    }],
  },
  plugins: [new FileListPlugin()],
}
```

## 面试官可能追问

::: details 怎么调试自己写的 loader？
可以用 loader-runner 单独运行 loader，不必启动完整构建；在配置里用 `path.resolve` 直接引用本地文件（如上例），或者配置 `resolveLoader.modules` 让 webpack 去本地目录找 loader。需要断点时用 `node --inspect-brk` 启动 webpack。
:::

::: details 同一个文件要被多条 rule 匹配，执行顺序怎么定？
可以用 `enforce: 'pre'` 或 `enforce: 'post'` 调整。所有匹配的 loader 分成 pre、normal、inline、post 四组，loader 函数按 pre → normal → inline → post 的顺序执行，pitch 顺序相反。代码检查类的 loader 常用 `enforce: 'pre'`，最先拿到源码，保证检查的是未经其他 loader 转换的代码。同一组里仍然遵守从右往左（从下往上）的规则。
:::

::: details 插件里的异步操作怎么写？
对异步钩子（如 `emit`、`processAssets`）用 `tapPromise` 返回一个 Promise，或者用 `tapAsync` 在完成后调用 callback。webpack 会等它完成再进入下一步。同步钩子（如 `compilation`）只能用 `tap`，在里面做异步操作 webpack 不会等待。
:::

## 易错点

- loader 的执行顺序是从右往左，pitch 才是从左往右，两者容易记反
- loader 应该是无状态的纯转换，不要在模块级变量里保存状态，否则缓存和并行构建会出问题
- 插件里不要从 `require('webpack')` 拿 `sources`、`Compilation`，而是用 `compiler.webpack`，否则项目和插件各装了一份 webpack 时会出现类型对不上的问题
- 用正则处理源码只适合演示，遇到跨行调用、字符串里的内容就会出错，正式的代码转换应该基于 AST，见 [Babel 的原理](/basics/build/07-babel)
