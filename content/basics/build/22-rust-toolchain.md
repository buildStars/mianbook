---
difficulty: 2
tags: [新技术, 对比]
---

# 前端工具链为什么都在用 Rust 重写？Rolldown、Oxc、Biome 分别是什么？

::: tip 一句话回答
JS 写的构建工具在大项目里受限于单线程和 GC，解析、转换、打包都慢；用 Rust 这样的原生语言加多线程重写，能快很多，同时对外**保留 JS 生态熟悉的接口**。**Rolldown** 是兼容 Rollup 插件接口的 Rust 打包器，目前已经是 Vite 默认的唯一打包器，统一了原来"开发用 esbuild、生产用 Rollup"的两套管线；**Oxc** 是一整套底层工具（解析、转换、压缩、模块解析、lint、格式化）；**Biome** 是一个工具同时做格式化和 lint，对标 Prettier 加 ESLint。
:::

## 详细解析

### 为什么要用 Rust 重写

- Babel、ESLint、Terser、webpack 这些工具都是 JS 写的，每个工具各自解析一遍 AST，单线程执行，项目一大，构建和 lint 动辄几十秒甚至几分钟
- 原生语言没有 GC 停顿，内存布局可控，还能把文件分给多个线程并行处理
- esbuild（Go）和 SWC（Rust）先证明了这条路可行，后来的工具大多选 Rust
- 关键是**接口不变**：配置、插件 API、CLI 用法尽量和老工具一致，迁移成本低，用户感知到的只是变快了

### Rolldown：统一 Vite 的两套打包器

过去 Vite 开发时用 esbuild 做依赖预构建和 TS/JSX 转换，生产用 Rollup 打包（原理见 [Vite 为什么快](/basics/build/03-vite)）。两套工具带来的问题：

- 两条转换管线，插件要兼容两边，需要大量胶水代码
- 模块处理不一致的边界情况越积越多，出现"开发正常、打包后出错"
- 在一边修好对齐问题，可能在另一边引入新的差异

Rolldown 用 Rust 实现，JS API 和插件 API 与 Rollup 兼容，大多数 Rollup 插件可以直接复用，功能范围又接近 esbuild。目前 Vite 已经把它作为唯一的打包器：生产构建和依赖预构建都由 Rolldown 完成，Vite 不再直接使用 esbuild。Rolldown 本身已经发布稳定版，官方建议大多数应用通过 Vite 使用它，而不是单独用。

### Oxc：一整套底层工具

Oxc 不是一个工具，而是一组用 Rust 写的 JS 基础设施，各个部分可以单独用：

| 组件 | 做什么 | 状态 |
| --- | --- | --- |
| Parser | 解析 JS/TS/JSX | 文档未标注 |
| Transformer | TS 类型擦除、JSX、语法降级 | 文档未标注 |
| Resolver | 实现 Node.js 的模块解析算法 | 文档未标注 |
| Minifier | 压缩、混淆 | 官方标为 Alpha |
| oxlint | 兼容 ESLint 规则的 linter | 已发布稳定版 |
| oxfmt | 兼容 Prettier 输出的格式化器 | 官方标为 Beta |

Rolldown 底层就用 Oxc。Vite 目前用 Oxc 做 JS 转换，默认的 JS 压缩也换成了 Oxc Minifier。oxlint 覆盖了 ESLint 核心规则和 typescript-eslint、React、import 等常用插件的规则，类型感知的规则也已经可用；但加载 ESLint 的 JS 插件目前还是 alpha。

### Biome：格式化和 lint 合成一个工具

- 一个二进制、一份配置 `biome.json`，同时做格式化和 lint，能处理 JS、TS、JSON、CSS 等
- 格式化以 Prettier 为参照，官方称兼容度很高，但有一些故意不同的地方，比如解析更严格，有语法错误时出错部分原样输出
- lint 规则来自 ESLint、typescript-eslint 等，每条规则标明和来源"相同"还是只是"受启发"
- 提供 `biome migrate eslint` 和 `biome migrate prettier` 迁移命令，但 ESLint 插件里的规则要手动配置，迁移后行为不会和原来完全一致

### Rspack：另一条路线

Rspack 也是 Rust 写的打包器，目标是**兼容 webpack 的配置、loader 和插件**，让老的 webpack 项目改动很少就能提速。和 Rolldown 是两条路线：一个接 Rollup/Vite 生态，一个接 webpack 生态。各打包器的对比见 [构建工具有什么区别](/basics/build/10-bundlers)。

## 面试官可能追问

::: details Rust 工具有什么代价？
用 JS 写的插件仍然在 JS 里执行，每次调用都要跨语言传数据，插件多了会吃掉一部分性能优势。规则和插件生态也不如老工具全，一些冷门的 ESLint 插件、Babel 插件没有对应实现。出了问题要看 Rust 源码，前端团队自己改起来门槛高。
:::

::: details 老项目要不要马上换？
按痛点来。新项目跟随框架默认，比如用 Vite 就自然用上了 Rolldown 和 Oxc。老项目可以从风险小的地方开始：lint 慢就先上 oxlint，和 ESLint 并用（`eslint-plugin-oxlint` 能关掉重叠的规则）；webpack 构建慢可以试 Rspack。不要一次全换，每换一个都对比产物和检查结果。
:::

::: details Biome 和 ESLint + Prettier 怎么选？
Biome 的优势是快、配置少、一个工具搞定。如果项目重度依赖某些 ESLint 插件（比如框架专用规则），或者团队有大量自定义规则，继续用 ESLint 更稳。ESLint 和 Prettier 的分工见 [代码规范](/basics/build/13-code-standards)。
:::

## 易错点

- 认为 Rust 工具是"全新的东西"，其实它们刻意兼容老工具的接口，迁移成本主要在边界差异上
- 把 Oxc 当成一个打包器，它是一组底层工具，打包是 Rolldown 的事
- 说 Biome 和 Prettier、ESLint 完全一致，实际上有故意不同的格式化规则，lint 规则也不是一一对应
- 把各个组件当成同样成熟，Oxc 的压缩器、格式化器官方仍标为 Alpha、Beta
