---
difficulty: 3
tags: [原理, 实践]
---

# Vite 插件怎么写？和 Rollup 插件是什么关系？

::: tip 一句话回答
Vite 插件就是一个带 `name` 和若干钩子的对象，接口**沿用 Rollup 的插件约定**：`resolveId`、`load`、`transform` 这些通用钩子在开发和构建时都会调用，所以相当多的 Rollup 插件能直接用（Vite 后来把底层打包器换成了 Rolldown，它兼容同一套插件 API，这些钩子的写法基本不变，个别钩子的行为有差异）。在此之上，Vite 加了 **`config`、`configResolved`、`configureServer`、`transformIndexHtml`、`handleHotUpdate`** 等专有钩子。插件用 **`enforce: 'pre' | 'post'`** 调整顺序，用 **`apply: 'serve' | 'build'`** 限定生效环境。虚拟模块约定用户侧写 `virtual:` 前缀，内部 id 加 `\0` 前缀。开发时没有打包，输出阶段的钩子不会执行，这是写插件时最大的差异。
:::

## 详细解析

### 钩子一览

| 钩子 | 来源 | 什么时候调用 | 常见用途 |
| --- | --- | --- | --- |
| `config` | Vite | 解析配置之前 | 返回一部分配置，和用户配置合并 |
| `configResolved` | Vite | 配置解析完成后 | 保存最终配置，读取 `command`、`mode` |
| `configureServer` | Vite | 创建开发服务器时 | 加中间件、保存 server 实例；构建时不调用 |
| `transformIndexHtml` | Vite | 处理 HTML 入口时 | 注入标签、替换 HTML 内容 |
| `handleHotUpdate` | Vite | 文件变化、准备热更新时 | 缩小受影响的模块范围、发送自定义事件 |
| `buildStart` / `buildEnd` | 通用 | 构建开始 / 结束；开发服务器启动 / 关闭时 | 初始化、清理 |
| `resolveId` | 通用 | 遇到一个导入路径时 | 把路径解析成模块 id |
| `load` | 通用 | 加载模块时 | 返回模块源码，虚拟模块靠它 |
| `transform` | 通用 | 模块加载之后 | 转换代码，比如编译 Vue、JSX |
| `renderChunk` / `generateBundle` | 通用（输出阶段） | 只在构建时 | 修改 chunk 和产物文件 |

`resolveId`、`load` 是"first"类型的钩子：按插件顺序调用，第一个返回非 `null` 的结果生效，后面的插件不再处理；返回 `null` 或不返回就交给下一个插件。`transform` 是串行的，每个插件都能在上一个的结果上继续改。

### 开发和构建时的差异

开发时 Vite 不打包（原因见 [Vite 为什么快](/basics/build/03-vite)），它创建一个"插件容器"，按打包器的方式调用钩子：服务器启动时调用一次 `options`、`buildStart`；浏览器每请求一个模块，就对它调用 `resolveId`、`load`、`transform`；服务器关闭时调用 `buildEnd`、`closeBundle`。`moduleParsed` 不调用（开发时不做完整的 AST 解析），输出阶段的钩子除了 `closeBundle` 也都不调用。

所以一个依赖 `generateBundle` 的插件开发时毫无效果，依赖"所有模块都处理完"的插件在开发时也拿不到完整的模块图。一个 Rollup 插件只要不用 `moduleParsed`、构建阶段和输出阶段的钩子之间没有强耦合，一般就能直接当 Vite 插件用。只在构建时有意义的 Rollup 插件，可以放进构建配置里传给底层打包器的 `plugins`，效果等同于 `apply: 'build'` 加 `enforce: 'post'`。

### 顺序和生效环境

插件最终的顺序是：别名处理 → `enforce: 'pre'` 的用户插件 → Vite 核心插件 → 没写 `enforce` 的用户插件 → Vite 的构建插件 → `enforce: 'post'` 的用户插件 → Vite 的后置构建插件（压缩、manifest、报告）。

需要在 Vite 处理之前拿到原始源码，就用 `pre`；需要处理编译后的 JS，就用 `post`。另外每个钩子还能写成 `{ order: 'pre', handler() {} }` 单独调整顺序，和 `enforce` 互不影响。

`apply` 默认两种场景都生效；写 `'serve'` 或 `'build'` 只在开发或构建时生效；也可以写成函数，比如 `apply: (config, { command }) => command === 'build' && !config.build.ssr` 排除 SSR 构建。

### 虚拟模块

虚拟模块在磁盘上不存在，内容由插件生成，常用来注入构建信息、自动生成的路由表。约定是：

- 用户写的导入路径带 `virtual:` 前缀，比如 `import { buildTime } from 'virtual:build-info'`
- `resolveId` 把它解析成带 `\0` 前缀的内部 id，`\0` 告诉其他插件不要尝试按文件路径处理它
- `load` 看到这个内部 id 时返回代码。开发时浏览器里看到的地址是 `/@id/__x00__virtual:build-info`，Vite 收到请求后会还原成 `\0` 的形式再交给插件

## 代码示例

一个注入构建信息的插件，用到了虚拟模块和三个 Vite 专有钩子：

```js
// vite-plugin-build-info.js
const VIRTUAL_ID = 'virtual:build-info' // 用户写的导入路径
const RESOLVED_ID = '\0' + VIRTUAL_ID // 内部 id

export default function buildInfo() {
  let config
  const buildTime = new Date().toISOString()

  return {
    name: 'vite-plugin-build-info',
    configResolved(resolved) {
      config = resolved // 保存最终配置，load 里要用 mode
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
    },
    load(id) {
      if (id === RESOLVED_ID) {
        return `export const buildTime = ${JSON.stringify(buildTime)}\n` +
          `export const mode = ${JSON.stringify(config.mode)}\n`
      }
    },
    // 往 index.html 的 head 里插一个 meta 标签
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'build-time', content: buildTime }, injectTo: 'head' }]
    },
    // 只在开发服务器里加一个调试接口
    configureServer(server) {
      server.middlewares.use('/__build-info', (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ buildTime, mode: config.mode }))
      })
    },
  }
}
```

```js
// vite.config.js
import { defineConfig } from 'vite'
import buildInfo from './vite-plugin-build-info.js'
export default defineConfig({ plugins: [buildInfo()] })
// 业务代码：import { buildTime, mode } from 'virtual:build-info'
// TypeScript 项目在 .d.ts 里声明：declare module 'virtual:build-info' { export const buildTime: string; export const mode: string }
```

用 `transform` 把 `.md` 文件当作字符串导入：

```js
export default function markdownRaw() {
  return {
    name: 'vite-plugin-md-raw',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.md')) return null // 不相关的模块尽早返回
      // 整个文件被替换，没有可保留的位置映射；改动局部代码时要用 magic-string 等工具生成 source map
      return { code: `export default ${JSON.stringify(code)}`, map: null }
    },
  }
}
```

## 面试官可能追问

::: details 插件多了会拖慢开发服务器吗？怎么写得更快？
会。`transform` 对每个模块都会调用，插件里做了耗时操作，每次请求都要等。先用 `id` 快速判断，不相关的模块直接返回 `null`；需要的话在钩子上声明 `filter`（如 `transform: { filter: { id: /\.md$/ }, handler(code, id) {} }`），打包器可以直接跳过不匹配的模块，用 Rust 实现的打包器还能省掉调用 JS 的开销，不支持 `filter` 的旧版本则要在 handler 里再判断一次。`vite --debug plugin-transform` 和 vite-plugin-inspect 可以看每个插件的耗时和转换结果。
:::

::: details handleHotUpdate 能做什么？
它在文件变化、Vite 准备热更新时调用，参数里有变化的文件、受影响的模块列表和 server。返回一个过滤后的模块数组，可以缩小更新范围；返回空数组表示自己处理，再通过 `server.ws.send` 发送自定义事件，客户端用 `import.meta.hot.on` 接收。HMR 的整体流程见 [热更新原理](/basics/build/06-hmr)。Vite 还提供了按运行环境（Environment API）区分的 `hotUpdate` 钩子，官方计划将来用它取代 `handleHotUpdate`，但目前仍建议继续用 `handleHotUpdate`，写这类插件时以项目所用版本的文档为准。
:::

::: details Vite 插件和 webpack 插件的思路有什么不同？
webpack 把"转换文件"和"介入构建流程"分给 loader 和 plugin 两套机制（见 [Loader 和 Plugin](/basics/build/02-loader-plugin)），plugin 通过 Tapable 钩子介入几十个阶段。Vite 和 Rollup 只有插件一种机制，`transform` 承担了 loader 的工作，钩子数量少、语义清楚，所以写起来简单得多，代价是能介入的细节没有 webpack 多。
:::

## 易错点

- 在 `generateBundle`、`renderChunk` 里写逻辑，以为开发时也会执行，实际上开发时输出阶段的钩子都不调用
- 在 `config` 钩子里再注入别的插件：此时用户插件已经解析完，新加的插件不会生效
- 虚拟模块的内部 id 没加 `\0`，别的插件会把它当成普通文件继续处理，可能报错或产生意外的转换
- `resolveId`、`load` 对不相关的 id 返回了值，把本该交给后面插件处理的模块截住了
