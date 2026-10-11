---
difficulty: 2
tags: [高频, 性能优化, 实践]
---

# 代码分割怎么做？chunk 应该怎么拆？

::: tip 一句话回答
代码分割有三种手段：**多入口**、**动态 `import()`**（最常用，路由级懒加载就是它）、**`splitChunks`** 把第三方库和公共模块抽成独立的 chunk。拆分的目标是两个：首屏只加载需要的代码，以及让不常变的代码（框架、第三方库、webpack 运行时）文件名稳定，充分利用**长期缓存**。拆得太碎会增加请求数和重复的模块包装代码，拆得太粗则一处改动就让整个大文件缓存失效，需要按项目权衡。
:::

## 详细解析

### 三种分割方式

| 方式 | 写法 | 适用场景 |
| --- | --- | --- |
| 多入口 | `entry: { app: './app.js', admin: './admin.js' }` | 多页应用，每个页面一个入口 |
| 动态导入 | `import('./pages/admin.js')` | 路由页面、弹窗、编辑器、图表等非首屏功能 |
| splitChunks | `optimization.splitChunks` | 抽出第三方库和多个 chunk 共用的模块 |

多个入口共用的模块，可以用 `entry` 的 `dependOn` 或者 splitChunks 抽出来，否则每个入口都会打包一份。

### 动态导入和路由懒加载

`import()` 返回 Promise，打包工具遇到它就会把目标模块及其依赖拆成一个异步 chunk，运行到这里时才去加载。

```js
// Vue Router：访问到这个路由才加载页面组件
const routes = [
  { path: '/', component: () => import('./pages/Home.vue') },
  { path: '/admin', component: () => import('./pages/Admin.vue') },
]

// React：lazy 从 react 中导入，配合 Suspense 显示加载状态
const Admin = lazy(() => import('./pages/Admin'))
```

按路由拆分是收益最大、最好控制的做法。路由内部再按"用户点了才需要"的功能继续拆，比如富文本编辑器、导出 Excel。

### splitChunks 的默认规则

webpack 5 生产模式下的默认值：`chunks: 'async'`，只拆分异步 chunk；新 chunk 要满足"被多处共用或来自 `node_modules`"，并且压缩前大于 20KB（`minSize: 20000`），按需加载和首屏加载时的并行请求数都不超过 30。内置两个缓存组：`defaultVendors`（`node_modules` 中的模块）和 `default`（至少被 2 个 chunk 共用的模块）。

大多数项目会改成 `chunks: 'all'`，让入口 chunk 里的第三方库也参与拆分，再按变化频率自定义缓存组，配置见下面的代码示例。

### 拆分粒度的权衡

| 拆得细 | 拆得粗 |
| --- | --- |
| 改一个模块，只有一个小文件缓存失效 | 改一行代码，整个大文件都要重新下载 |
| 请求数多，每个文件都有包装代码，压缩率也会下降 | 请求数少，压缩效果好 |
| 首屏可能要等很多个小文件 | 首屏可能下载了很多用不到的代码 |

HTTP/2 的多路复用降低了多个请求的成本，所以现在一般可以拆得比 HTTP/1.1 时代更细，但请求数并不是没有代价，文件过多时浏览器的调度和解析开销仍然存在（见 [HTTP 各版本的区别](/basics/network/07-http-versions)）。常见的拆法：

- **framework**：vue、react、router 等，几乎不变，单独一个文件
- **vendors**：其他第三方库；如果有特别大又只在部分页面用到的库（如图表、编辑器），让它跟着异步 chunk 走，不要放进首屏的 vendors
- **common**：被多个页面共用的业务代码
- **页面 chunk**：每个路由一个

### 稳定哈希与长期缓存

文件名带上 `[contenthash]`，内容不变哈希就不变，可以设置很长的强缓存（见 [HTTP 缓存](/basics/network/01-http-cache)）。要让哈希真正稳定，还要注意：

- **把运行时单独拆出来**：`optimization.runtimeChunk: 'single'`。运行时里有 chunk id 到文件名的映射，任何 chunk 的哈希变化都会改动它；不拆出来的话，这个变化会让入口 chunk 的哈希跟着变
- **模块 id 要稳定**：webpack 5 生产模式默认 `moduleIds: 'deterministic'`，新增一个模块不会让其他模块的 id 整体移位
- HTML 文件不要强缓存，每次发布由它引用新的文件名

### 预加载

动态 chunk 在用户点击时才开始下载，会有一个等待。可以用魔法注释提前加载：

- `import(/* webpackPrefetch: true */ './Admin.js')`：父 chunk 加载完后插入 `link rel="prefetch"`，浏览器空闲时下载，适合"之后很可能用到"的页面
- `import(/* webpackPreload: true */ './Chart.js')`：和父 chunk 并行加载，优先级更高，适合当前页面马上要用的模块，滥用会挤占首屏带宽

两者的区别见 [资源提示](/basics/browser/11-resource-hints)。Vite 构建时会自动为入口依赖的 chunk 生成 `modulepreload`。

## 代码示例

```js
// webpack.config.js
const path = require('node:path')

module.exports = {
  mode: 'production',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].[contenthash:8].js',
    chunkFilename: '[name].[contenthash:8].js',
    clean: true,
  },
  optimization: {
    runtimeChunk: 'single', // 运行时单独一个文件，避免它的变化影响业务 chunk 的哈希
    splitChunks: {
      chunks: 'all', // 同步和异步引入的模块都参与拆分
      cacheGroups: {
        framework: {
          test: /[\\/]node_modules[\\/](vue|vue-router|pinia|react|react-dom)[\\/]/,
          name: 'framework',
          priority: 20, // 优先级高于 vendors，先被匹配
        },
        vendors: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          priority: 10,
        },
        common: {
          minChunks: 2, // 被至少 2 个 chunk 共用的业务代码
          priority: 0,
          reuseExistingChunk: true,
        },
      },
    },
  },
}
```

## 面试官可能追问

::: details 所有 node_modules 都打进一个 vendors 有什么问题？
vendors 会变得很大，任何一个依赖升级都会让整个文件缓存失效；只在某个页面用到的大库也会进入首屏。可以把稳定的框架单独拆出来，大而少用的库通过动态导入留在异步 chunk 里。注意缓存组仍然受 `minSize` 等条件限制，体积太小的库不会被单独拆出来。
:::

::: details 动态加载的 chunk 加载失败怎么办？
常见原因是发版后旧页面去请求已经被删除的旧 chunk，或者网络抖动，webpack 会抛出 `ChunkLoadError`。可以在路由的懒加载函数外包一层重试；捕获到这个错误时提示用户或刷新页面；部署时保留上一个版本的静态资源一段时间，见 [前端部署](/basics/build/14-frontend-deploy)。
:::

::: details Vite 里怎么手动分包？
Vite 默认就会按动态导入拆分，并自动处理公共模块。需要手动控制时，通过构建配置传给底层打包器：Vite 7 及以前用 `build.rollupOptions.output.manualChunks`；Vite 8 改用 Rolldown 后，官方推荐 `build.rolldownOptions.output.codeSplitting`，`manualChunks` 的对象写法已不再支持，函数写法被标记为弃用。具体写法以项目所用版本的文档为准。
:::

## 易错点

- 默认 `chunks: 'async'` 只拆异步 chunk，入口里同步引入的第三方库不会被拆出来，很多人以为"配了 splitChunks 就会自动拆 vendors"
- 用 `[fullhash]`（整次构建的哈希，webpack 4 中叫 `[hash]`）而不是 `[contenthash]`，任何改动都会让所有文件名变化，长期缓存失效
- 只拆不测：拆分后要用打包分析工具确认首屏实际加载了哪些文件，避免大库被错误地放进首屏
- prefetch 的资源只是下载并缓存，不会执行；preload 用错会和首屏关键资源争抢带宽
