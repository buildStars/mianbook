---
difficulty: 2
tags: [高频, 对比]
---

# Webpack、Rollup、esbuild、Rspack 这些构建工具有什么区别？

::: tip 一句话回答
**webpack** 用 JavaScript 编写，loader 和 plugin 生态最完整，什么都能配，代价是配置复杂、大项目构建慢。**Rollup** 以 ESM 为核心，产物干净、能同时输出多种模块格式，适合**打包库**。**esbuild** 用 Go 编写，速度快，但**不做类型检查**，插件和代码分割能力相对简单，常被其他工具当作转译器使用。**Rspack** 用 Rust 重写了 webpack 的核心，**兼容 webpack 的配置和大部分 loader、插件**，适合想提速又不想推倒重来的 webpack 项目。**Vite** 是组合方案：开发时基于浏览器原生 ESM 按需编译，生产构建交给打包器，Vite 8 起依赖预构建和生产打包都改用 Rust 编写的 Rolldown。
:::

## 详细解析

### 定位对比

| | webpack | Rollup | esbuild | Rspack | Vite |
| --- | --- | --- | --- | --- | --- |
| 实现语言 | JavaScript | JavaScript | Go | Rust | JavaScript，底层打包器另选 |
| 主要用途 | 应用 | 库 | 转译、简单打包 | 应用，webpack 项目迁移 | 应用、库模式 |
| 配置 | 灵活但复杂 | 简洁 | 很少 | 与 webpack 基本一致 | 约定优于配置 |
| 生态 | 最丰富 | 插件生态成熟 | 插件 API 较简单 | 复用 webpack 生态 | 兼容 Rollup 风格的插件 |
| 开发体验 | 先打包再启动 | 以 watch 为主 | watch、简单的 serve | 先打包再启动，编译快 | 按需编译，启动快 |

### webpack：什么都能打包

webpack 把一切资源都看作模块，从入口出发构建依赖图，loader 负责转换文件，plugin 介入构建的各个阶段（流程见 [Webpack 构建流程](/basics/build/01-webpack-flow)、[Loader 和 Plugin](/basics/build/02-loader-plugin)）。

- 优点：生态最完整，代码分割、Module Federation、各种老旧场景都有成熟方案
- 缺点：配置项多，学习成本高；单线程的 JavaScript 实现，项目大了以后冷启动和 HMR 都会变慢

### Rollup：适合打包库

- 以 ESM 为核心，tree shaking 做得彻底，产物几乎没有运行时代码，读起来接近手写
- 一次构建可以输出 ESM、CommonJS、UMD 等多种格式，正好满足库的发布需求
- 处理 CommonJS 依赖、CSS、图片都要靠插件，开发服务器和 HMR 不是它的重点
- Rolldown 是用 Rust 编写、API 兼容 Rollup 的打包器，Vite 8 用它同时替换了开发时的 esbuild 预构建和生产时的 Rollup 打包

### esbuild：快，但能力有取舍

- Go 编写，并行处理，没有 JavaScript 工具的启动开销
- **只转译、不做类型检查**：TypeScript 的类型错误不会让构建失败，需要另外跑 `tsc --noEmit`（见 [tsc、Babel、esbuild 编译 TypeScript 的区别](/basics/typescript/20-transpile)）
- 不注入 polyfill，`const`、async 函数等 ES6+ 语法不支持降级到 ES5；代码分割目前只支持 ESM 输出格式；插件 API 只有 resolve、load 等少数钩子
- 很多工具把它当作内部组件：Vite 8 之前的依赖预构建和生产压缩、tsup 等库打包工具都用了 esbuild

### Rspack 和 Vite

- **Rspack**：核心用 Rust 实现，配置格式与 webpack 基本一致，大部分 loader 和插件可以直接复用，还内置了 SWC loader、CSS 处理等常用能力。想要开箱即用的体验，可以用基于它的 Rsbuild
- **Vite**：开发时不打包，浏览器请求哪个模块就编译哪个，依赖提前预构建；生产环境再完整打包。Vite 8 之前是开发用 esbuild、生产用 Rollup，两套工具的行为可能不一致；Vite 8 起统一使用 Rolldown 和 Oxc（原理见 [Vite 为什么快](/basics/build/03-vite)）

### 怎么选

1. **新的应用项目**：优先用 Vite 或框架自带的构建方案（Nuxt、Next.js 等），配置最少
2. **已有的大型 webpack 项目**：构建慢就评估迁移到 Rspack，改动远小于换成 Vite；重度依赖某些 webpack 插件时，先确认 Rspack 是否支持
3. **写一个 npm 库**：Rollup，或者基于 Rollup、esbuild 封装的工具（例如 tsup、Vite 的库模式）
4. **脚本、Node.js 服务、简单的转译**：esbuild 足够

选型时看团队熟悉度、插件生态和迁移成本，不要只看速度对比，不同项目测出来的差距可能很大。

## 代码示例

用 Rollup 打包一个同时提供 ESM 和 CommonJS 的库：

```js
// rollup.config.js
export default {
  input: 'src/index.js',
  // 依赖不打进产物，由使用方安装
  external: ['dayjs'],
  output: [
    { file: 'dist/index.mjs', format: 'es' },
    { file: 'dist/index.cjs', format: 'cjs' },
  ],
}
```

Rspack 的配置和 webpack 几乎一样，TypeScript 用内置的 SWC loader 转译：

```js
// rspack.config.mjs
import { defineConfig } from '@rspack/cli'
import { rspack } from '@rspack/core'

export default defineConfig({
  entry: './src/index.ts',
  resolve: { extensions: ['.ts', '.js'] },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [/node_modules/],
        loader: 'builtin:swc-loader',
        options: { detectSyntax: 'auto' },
      },
    ],
  },
  plugins: [new rspack.HtmlRspackPlugin()],
})
```

## 面试官可能追问

::: details 为什么 Rust、Go 写的工具比 JavaScript 写的快？
主要有三点：编译成本地代码，没有 JIT 预热；能用多线程共享内存并行解析和转换，JavaScript 只能借助 worker，线程之间传数据要序列化，成本高；内存布局更紧凑，大量 AST 操作时 GC 压力小。另外，新工具通常一开始就把解析、转换、压缩放在同一个进程里，减少了反复生成和序列化 AST 的开销。
:::

::: details Rspack 能完全替代 webpack 吗？
大部分常见场景可以，但不是百分之百兼容。少数依赖 webpack 内部 API 的插件无法使用，需要找替代方案或者用 Rspack 的内置能力。迁移时先跑通构建，再对比产物和线上行为，必要时按页面或子应用逐步切换。
:::

::: details 既然 esbuild 这么快，为什么不直接用它打包应用？
esbuild 的定位是快速、简单。大型应用需要的精细 chunk 拆分、HMR、CSS 的复杂处理、丰富的插件生态，它不提供或者能力有限，自己补齐的成本很高。所以它更多被用作其他工具的"引擎"，或者用于结构简单的项目。
:::

## 易错点

- 认为用 esbuild 或 SWC 编译 TypeScript 就会做类型检查，CI 里漏掉 `tsc --noEmit`
- 把 Vite 当成"不打包的工具"：它只是开发时不打包，生产环境照样完整打包
- 说 Rspack 是"Rust 版的 Vite"：Rspack 对标的是 webpack，兼容的是 webpack 的配置和生态
- 背各家宣传的性能倍数，实际差距取决于项目规模和配置，面试时讲清原因比报数字更有说服力
