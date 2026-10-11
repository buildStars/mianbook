---
difficulty: 2
tags: [高频, 性能优化, 实践]
---

# 前端打包体积怎么分析和优化？

::: tip 一句话回答
先**分析**再动手：用 webpack-bundle-analyzer、rollup-plugin-visualizer 这类工具生成依赖体积图，找出最大的几个模块。优化手段按收益排序：组件库和工具库**按需引入**、**替换臃肿的依赖**（例如 moment 换成 dayjs）、保证 **tree shaking** 生效、按路由**代码分割**、**压缩**（JS 压缩加 gzip / brotli），再处理图片和字体。最后在 CI 里设置**体积预算**，防止体积悄悄涨回去。
:::

## 详细解析

### 先分析：看清楚体积花在哪

| 工具 | 适用 | 用法 |
| --- | --- | --- |
| webpack-bundle-analyzer | webpack | 作为插件使用，或分析 `webpack --json` 输出的 stats 文件 |
| rollup-plugin-visualizer | Rollup、Vite | 作为插件使用，构建后生成 HTML 矩形树图 |
| Rsdoctor | Rspack、webpack | 除了体积，还能看 loader 耗时、重复依赖 |
| source-map-explorer | 任意工具 | 根据 source map 反推每个源文件占了多少字节 |

看图时关注三件事：

1. **最大的几个依赖**：一个日期库或图表库就可能占掉一半体积
2. **重复打包**：同一个库出现了多个版本，或者同时打进了 ESM 和 CommonJS 两份
3. **不该出现的东西**：只在某个页面用到的库进了首屏 chunk，开发用的 mock 数据被打进了生产包

体积要看**压缩后**（gzip / brotli）的大小，那才是网络上实际传输的量；解析和执行的开销则和压缩前的大小有关，两个数都要看。

### 依赖层面：按需引入和替换

- **组件库按需引入**：只注册用到的组件。Vue 项目常用 unplugin-vue-components 自动按需导入，React 组件库大多提供 ESM 产物，直接具名导入就能被 tree shaking
- **工具库**：`import _ from 'lodash'` 会引入整个库，改成 lodash-es 的具名导入，或按方法引入
- **替换大依赖**：例如 moment 体积大，而且默认会带上所有语言包，可以换成 API 相近、体积小得多的 dayjs；只用到简单功能的库（深拷贝、UUID）可以考虑用浏览器原生 API 替代
- **检查重复版本**：`npm ls <包名>` 或 `pnpm why <包名>` 查看是谁引入了多个版本，必要时用 overrides 统一（见 [包管理器](/basics/node/10-package-managers)）

### 构建层面：tree shaking、分割和压缩

- **tree shaking**：依赖 ESM 和正确的 `sideEffects` 声明，失效的常见原因见 [Tree Shaking](/basics/build/04-tree-shaking)
- **代码分割**：路由懒加载、大组件 `import()` 按需加载，第三方库单独拆 chunk 以便长期缓存，见 [代码分割](/basics/build/05-code-splitting)
- **JS 压缩**：webpack 生产模式默认用 Terser；Vite 8 起默认用 Oxc 压缩，之前的版本默认用 esbuild。压缩会删除空白、缩短变量名、去掉死代码
- **gzip / brotli**：可以在构建时预压缩，生成 `.gz`、`.br` 文件，由服务器直接返回（nginx 的 `gzip_static`）；也可以交给服务器或 CDN 实时压缩。brotli 压缩率一般比 gzip 高，现代浏览器在 HTTPS 下都支持，服务器根据请求头 `Accept-Encoding` 选择返回哪种
- **去掉开发代码**：确保 `process.env.NODE_ENV` 被替换成 `'production'`，框架的开发警告才会被当作死代码删掉

### 资源层面：图片和字体

- 图片转成 WebP 或 AVIF，按显示尺寸提供多种分辨率（`srcset`），非首屏图片懒加载（见 [图片懒加载](/basics/browser/12-lazy-loading)）
- 小图标用 SVG 或雪碧图；构建工具会把小于阈值的图片内联成 base64（Vite 的 `build.assetsInlineLimit` 默认 4 KB），阈值不要调得太大，否则会撑大 JS 和 CSS
- 中文字体动辄几 MB，只用到少量文字时做**字体子集化**，格式用 woff2，加上 `font-display: swap` 避免文字长时间不显示

### externals + CDN 的取舍

把 Vue、React 这类大库配置成 externals，从公共 CDN 用 `<script>` 引入，可以让主包变小，但要权衡：

- 现代浏览器按站点**分区缓存**，用户在别的网站加载过同一个 CDN 文件，到你的网站也不会命中缓存，"共享缓存"的收益基本不存在
- 多了一个第三方域名：DNS 和连接开销、可用性风险、供应链安全风险（需要配合 SRI 校验）
- external 的库无法 tree shaking，版本也要在 HTML 和 `package.json` 两处手动同步

所以更常见的做法是：依赖照常打包，把第三方库拆成单独的 chunk，放到**自己的 CDN** 上长期缓存。

## 代码示例

Vite 项目里生成体积分析图，并用 size-limit 在 CI 里检查体积预算：

```js
// vite.config.js
import { defineConfig } from 'vite'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [
    // 构建后生成 stats.html，同时显示 gzip 和 brotli 后的体积
    visualizer({ filename: 'stats.html', gzipSize: true, brotliSize: true }),
  ],
})
```

```json
[
  { "path": "dist/assets/index-*.js", "limit": "150 kB" }
]
```

上面是 `.size-limit.json`。安装 `size-limit` 和 `@size-limit/file` 后，在 CI 里 `vite build` 之后执行 `npx size-limit`，超出预算时退出码非 0，流水线失败。webpack 也有内置的检查：`performance: { hints: 'error', maxAssetSize: 250000 }`，单位是字节。

## 面试官可能追问

::: details 体积预算设多少合适？
没有统一标准，从现状出发：先测出当前各入口压缩后的体积，在这个基础上留一点余量作为上限，只允许变小、不允许悄悄变大。超出时由 PR 作者说明原因，评审通过后再调高。比起一个绝对数字，更重要的是让每次体积变化都被看见。
:::

::: details 打包体积小了，页面就一定变快吗？
不一定。首屏还受请求数量和依赖链、接口耗时、渲染方式、图片和字体加载等因素影响。拆得过碎的 chunk 会增加请求数和瀑布式加载。体积优化之后要用 Lighthouse 或线上的 Web Vitals 数据验证效果，见 [Core Web Vitals](/basics/browser/09-web-vitals)。
:::

::: details 怎么发现同一个库被打包了两份？
分析图里同一个包名出现在多个位置，通常就是重复了。原因一般是依赖的版本范围不兼容，包管理器装了两个版本；或者一部分代码引用了 ESM 入口，另一部分引用了 CommonJS 入口。用 `npm ls`、`pnpm why` 找到来源，升级依赖或用 overrides 统一版本，webpack 也可以用 `resolve.alias` 强制指向同一份。
:::

## 易错点

- 只看压缩前的体积下结论，或者只看 gzip 后的体积而忽略了 JS 的解析执行开销
- 以为"用了 ESM 就会自动 tree shaking"，忘了检查 `sideEffects` 和 Babel 是否把模块转成了 CommonJS
- 为了减小主包把大库放到公共 CDN，却忽略了浏览器缓存分区和第三方域名的稳定性风险
- 一次性做完优化却没有设置预算，几个版本之后体积又涨了回去
