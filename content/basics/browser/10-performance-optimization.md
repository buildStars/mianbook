---
difficulty: 2
tags: [高频, 性能优化, 综合]
---

# 前端性能优化有哪些手段？

::: tip 一句话回答
**先测量，再优化**：用 Lighthouse、Performance 面板和线上监控找到瓶颈，再按**网络加载 → 资源体积 → 渲染 → 运行时**分层优化。网络层靠缓存、CDN、HTTP/2 和压缩让资源更快到达；资源层靠代码分割、tree-shaking 和图片优化让资源更小；渲染层靠关键资源优先、减少回流和 SSR 让页面更早显示；运行时靠拆分长任务、防抖节流和 Web Worker 让交互不卡。
:::

## 详细解析

### 先测量，再定位

- **实验室工具**：Lighthouse 给出整体评分和改进建议；DevTools 的 Performance 面板看主线程上的长任务，Network 面板看请求瀑布和资源体积
- **真实用户数据**：关注 [Core Web Vitals](/basics/browser/09-web-vitals)，通过[前端监控](/basics/browser/20-monitoring)采集线上数据
- 先判断瓶颈在哪：是网络慢、资源太大，还是主线程被占满，再对症下药

### 网络加载：让资源更快到达

- **缓存**：带 hash 的静态资源长期强缓存，HTML 走协商缓存（见 [HTTP 缓存](/basics/network/01-http-cache)）
- **CDN**：静态资源从离用户近的节点返回（见 [CDN 的原理](/basics/network/12-cdn)）
- **HTTP/2 和 HTTP/3**：多路复用，减少连接开销和队头阻塞（见 [HTTP 各版本的区别](/basics/network/07-http-versions)）
- **压缩**：文本资源开启 gzip 或 Brotli
- **资源提示**：用 preconnect、preload、prefetch 提前建立连接、加载资源（见[资源提示](/basics/browser/11-resource-hints)）
- **减少关键请求的数量和体积**：减少重定向，首屏用不到的资源延后加载

### 资源体积：让资源更小

- **代码分割与路由懒加载**：用动态 `import()` 拆分代码，访问到某个页面时才加载对应的代码
- **tree-shaking**：基于 ES Module 的静态结构，移除没有用到的代码
- **组件库按需引入**：只打包用到的组件和样式
- **图片优化**：使用 WebP / AVIF，用 `srcset` 提供响应式图片，非首屏图片懒加载（见[图片懒加载](/basics/browser/12-lazy-loading)）
- **字体子集化**：中文字体动辄几 MB，只保留页面用到的字符

### 渲染：让页面更早显示

- **关键 CSS 内联**：首屏需要的样式直接写进 HTML，其余 CSS 异步加载；非关键 JS 加 `defer`，不阻塞 HTML 解析
- **减少回流和重绘**：批量修改 DOM，动画用 `transform`（见[回流和重绘](/basics/browser/02-reflow-repaint)）
- **长列表虚拟滚动**：只渲染可视区域内的元素（见[长列表渲染](/basics/browser/13-long-list)）
- **SSR / SSG**：服务端直接返回带内容的 HTML，改善首屏（见 [SSR 和水合](/basics/vue/18-ssr-hydration)）

### 运行时：让交互更流畅

- **拆分长任务**：超过 50 毫秒的任务要拆开，及时让出主线程
- **防抖节流**：控制 `scroll`、`input` 等高频事件的处理频率（见[防抖和节流](/basics/javascript/13-debounce-throttle)）
- **Web Worker**：把繁重计算移出主线程（见 [Web Worker](/basics/browser/15-web-worker)）
- **避免内存泄漏**：及时清理定时器、事件监听和全局引用（见[内存泄漏](/basics/javascript/16-memory-leak)）

框架层面的优化，比如组件懒加载、减少不必要的更新，见 [Vue 项目的性能优化](/basics/vue/19-performance)。

### 串起来看

| 阶段 | 主要手段 | 主要改善的指标 |
| --- | --- | --- |
| 网络加载 | 缓存、CDN、HTTP/2、压缩、资源提示 | TTFB、FCP、LCP |
| 资源体积 | 代码分割、tree-shaking、图片和字体优化 | FCP、LCP、TBT |
| 渲染 | 关键 CSS、`defer`、SSR、虚拟列表、预留元素尺寸 | FCP、LCP、CLS |
| 运行时 | 拆分长任务、防抖节流、Web Worker | INP、TBT |

## 面试官可能追问

::: details 首屏优化具体怎么做？
- 先看指标：FCP、LCP 慢在哪一段，是 TTFB、资源下载，还是渲染被阻塞
- 缩短 TTFB：CDN、缓存，必要时用 SSR 或 SSG
- 缩短关键路径：关键 CSS 内联，JS 加 `defer`，路由级代码分割，首屏只加载必要的代码
- 优先加载 LCP 资源：preload、`fetchpriority="high"`，首屏图片不懒加载
- 首屏以外的内容延后：图片懒加载，非关键组件异步加载
- 提升感知速度：使用骨架屏
:::

::: details 怎么分析打包体积？
用可视化工具查看每个模块占了多少体积：Vite / Rollup 用 rollup-plugin-visualizer，webpack 用 webpack-bundle-analyzer。重点找体积大的依赖、被重复打包的依赖（比如同一个库的两个版本），以及没有按需引入的库。

```js
// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  // 构建后生成 stats.html，并自动在浏览器中打开
  plugins: [vue(), visualizer({ open: true })],
})
```
:::

::: details 怎么证明优化有效？
用数据做前后对比。实验室数据要在相同的设备和网络条件下多次测量，取中位数；线上数据比较优化前后的分位数（如第 75 百分位），并按页面、设备类型分别看，避免被平均值掩盖。如果能关联到跳出率、转化率等业务指标，说服力更强。
:::

## 易错点

- 不要一上来就罗列手段，先讲怎么测量、怎么定位瓶颈
- 优化有代价：代码块拆得太碎会增加请求数，preload 用多了会抢占关键资源的带宽，都要以数据为准
- 首屏的 LCP 图片不能懒加载，否则 LCP 会变差
