---
difficulty: 2
tags: [高频, 原理, 对比]
---

# Vite 为什么快？开发环境和生产环境分别怎么构建？

::: tip 一句话回答
Vite 开发时**不打包**：dev server 直接以**原生 ES Module** 的形式提供源码，浏览器请求到哪个模块才**按需编译**哪个，启动时间基本不随项目规模增长。第三方依赖在启动时做一次**依赖预构建**（CommonJS 转 ESM、把内部文件很多的包合并成一个模块），并配合强缓存。生产环境仍然**打包**，因为未打包的 ESM 嵌套 import 会带来大量请求和网络往返。早期 Vite 开发时用 esbuild 预构建、生产用 Rollup 打包；Vite 8 起换成 Rust 编写的 **Rolldown**（预构建、打包）和 **Oxc**（转译、压缩），开发和生产用同一套底层工具。
:::

## 详细解析

### 和 webpack dev server 的差别

```text
webpack dev server：
  入口 → 构建整个模块图 → 打包 → 启动服务（项目越大越慢）

Vite dev server：
  启动服务（几乎立即）→ 浏览器请求 /src/main.ts → 编译这一个文件返回
                       → 浏览器解析其中的 import，再请求下一个模块
```

webpack 必须先把所有模块构建完才能提供服务，改一个文件后还要重新生成受影响的 chunk。Vite 把"找依赖、加载模块"这件事交给浏览器：页面里 `script type="module"` 引入入口，浏览器遇到 `import` 就发请求，Vite 收到请求再编译对应文件（如 TS 转 JS、Vue 单文件组件转 JS）。没有访问到的路由页面，根本不会被编译。

### 依赖预构建

源码按需编译，第三方依赖则在首次启动时预构建，结果放在 `node_modules/.vite`：

1. **兼容 CommonJS 和 UMD**：浏览器只认 ESM，很多包仍然只发布 CommonJS，需要先转成 ESM，并让 `import { x } from 'cjs-pkg'` 这类具名导入能用
2. **减少请求数**：有些 ESM 包内部有几百个文件（官方文档举的例子是 lodash-es），不合并的话一个 `import` 就会触发几百个请求
3. **重写裸模块路径**：源码里的 `import vue from 'vue'` 会被改写成 `/node_modules/.vite/deps/vue.js?v=xxx` 这样浏览器能请求的地址

预构建只在开发环境做。lock 文件、`vite.config` 中相关配置、`NODE_ENV` 等发生变化时会重新预构建；也可以用 `vite --force` 或删除 `node_modules/.vite` 强制重来。

### HTTP 缓存

- 预构建后的依赖带上版本查询参数，响应头是 `Cache-Control: max-age=31536000,immutable`，缓存后不再请求 dev server
- 源码模块用协商缓存（`304 Not Modified`），文件没改就不重新传输

所以刷新页面时，大部分请求都不会真正到达 dev server。

### 生产环境为什么还要打包

开发环境在本机，请求延迟几乎为零；生产环境中，未打包的 ESM 会形成"请求入口 → 解析出依赖 → 再请求依赖"的瀑布，即使有 HTTP/2 也会多出很多网络往返。打包还能做 tree shaking、代码分割、压缩、按内容生成哈希文件名，这些都是生产环境需要的。

早期 Vite 开发用 esbuild（预构建、转译 TS），生产用 Rollup 打包，两套工具的转换行为和插件体系不同，偶尔会出现"开发正常、打包后出问题"。Vite 8 把依赖预构建和生产打包都换成了 Rolldown，JS 转译和压缩换成了 Oxc，esbuild 变成可选依赖，就是为了减少两套工具带来的差异。配置上 `build.rollupOptions` 改名为 `build.rolldownOptions`（旧名已弃用，暂时还能用），`esbuild` 配置项也已弃用、会自动转换成 `oxc`，升级时以官方迁移指南为准。

### 开发和生产不一致的风险

| 场景 | 开发环境 | 生产环境 |
| --- | --- | --- |
| 模块加载 | 浏览器原生 ESM，逐个请求 | 打包后的 chunk |
| CommonJS 依赖 | 预构建时转换 | 打包时转换，处理方式可能不同 |
| CSS 顺序 | 按模块执行顺序插入 `style` | 提取成独立文件，顺序可能变化 |
| 环境变量 | `import.meta.env.DEV` 为 true | 被静态替换，死代码会被删掉 |

上线前一定要用 `vite build` 加 `vite preview` 在本地验证一遍生产产物。

## 面试官可能追问

::: details 项目很大时，Vite 开发环境会不会也变慢？
会在另一个地方变慢：首次打开页面时，浏览器要发出成百上千个模块请求，请求数成了瓶颈，尤其是大量小文件的组件库没有被预构建时。缓解办法是控制模块数量、避免从大量文件的入口文件（barrel 文件）整体导入，必要时把依赖加进 `optimizeDeps.include`。Vite 官方也在探索开发时打包的模式来解决这个问题。
:::

::: details Vite 的插件和 Rollup 插件是什么关系？
Vite 的插件接口扩展自 Rollup 的插件接口，`resolveId`、`load`、`transform` 等钩子在开发和生产都会调用，所以很多 Rollup 插件能直接用。Vite 另外加了 `config`、`configureServer`、`transformIndexHtml` 等专有钩子，只在 Vite 中生效。
:::

::: details 开发时新加了一个依赖，Vite 会怎么处理？
Vite 启动时会扫描源码里的裸模块导入作为预构建的入口。运行中发现了没有预构建过的新依赖，会重新执行预构建，必要时刷新页面。如果依赖是动态导入、扫描不到的，可以手动写进 `optimizeDeps.include`，避免首次访问时触发重新预构建。
:::

::: details Vite 为什么启动快，但首屏有时不如 webpack 快？
Vite 把编译工作从启动阶段挪到了请求阶段：启动不打包，但页面首次加载时要按需编译模块，还要发出大量请求。webpack 启动慢，但打包好以后一次返回少量文件。热更新时 Vite 只需要重新编译改动的那个模块，见 [热更新的原理](/basics/build/06-hmr)。
:::

## 易错点

- Vite 不是"开发和生产都不打包"，生产环境一定会打包
- 依赖预构建只处理 `node_modules` 里的依赖，源码依然是按需编译的
- 开发环境靠浏览器原生 ESM 运行，不代表产物只能在支持 ESM 的浏览器运行，需要兼容旧浏览器时可以用官方的 `@vitejs/plugin-legacy`
- 不要把"开发环境能跑"当成验收标准，开发和生产走的是不同的流程
