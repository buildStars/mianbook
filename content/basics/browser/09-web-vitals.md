---
difficulty: 2
tags: [性能优化]
---

# Core Web Vitals 是什么？LCP、INP、CLS 怎么优化？

::: tip 一句话回答
Core Web Vitals 是 Google 提出的衡量真实用户体验的核心指标，目前有三个：**LCP**（最大内容绘制）衡量加载速度，**INP**（Interaction to Next Paint）衡量交互响应速度，**CLS**（累积布局偏移）衡量视觉稳定性。良好标准分别是 LCP ≤ 2.5 秒、INP ≤ 200 毫秒、CLS ≤ 0.1，按真实用户数据的第 75 百分位来评估。
:::

## 详细解析

### 三个核心指标

| 指标 | 衡量什么 | 良好 | 较差 |
| --- | --- | --- | --- |
| LCP（Largest Contentful Paint） | 从开始导航到视口内最大的图片或文本块渲染出来的时间 | ≤ 2.5 秒 | 超过 4 秒 |
| INP（Interaction to Next Paint） | 整个页面生命周期内，点击、触摸、按键等交互到下一帧画面的延迟，取接近最差的一次 | ≤ 200 毫秒 | 超过 500 毫秒 |
| CLS（Cumulative Layout Shift） | 页面内容意外移动的程度，是一个没有单位的分数 | ≤ 0.1 | 超过 0.25 |

INP 在 2024 年 3 月取代了 FID。评估时取真实用户数据的第 75 百分位，也就是至少 75% 的访问达到"良好"，这个页面才算达标。

CLS 的算法：单次布局偏移的分数 = 影响比例 × 距离比例；相邻偏移间隔不到 1 秒的归为同一个会话窗口（最长 5 秒），CLS 取分数总和最大的那个窗口。

其他常用指标：**FCP**（首次内容绘制）、**TTFB**（首字节时间），以及实验室指标 **TBT**（总阻塞时间，常作为 INP 在实验室中的参考）。

### 实验室数据与真实用户数据

| | 实验室数据 | 真实用户数据 |
| --- | --- | --- |
| 来源 | Lighthouse 等工具在模拟的设备和网络条件下测得 | CrUX（Chrome 用户体验报告），或者自己采集的 RUM 数据 |
| 优点 | 可复现，适合调试，也适合在 CI 中发现性能退化 | 反映真实的设备、网络和用户行为 |
| 局限 | 和真实体验有差距；页面加载测试中没有用户交互，测不了 INP | 能发现问题，但定位具体原因还要借助实验室工具 |

测量方法：用 `web-vitals` 库，或者直接用 `PerformanceObserver` 监听 `largest-contentful-paint`、`layout-shift` 等性能条目。

```js
import { onCLS, onINP, onLCP } from 'web-vitals'

function report(metric) {
  // rating 的取值是 'good'、'needs-improvement' 或 'poor'
  const body = JSON.stringify({ name: metric.name, value: metric.value, rating: metric.rating })
  navigator.sendBeacon('/analytics', body)
}

onCLS(report)
onINP(report)
onLCP(report)
```

### 优化 LCP

- **缩短 TTFB**：CDN、服务端缓存，减少重定向
- **让 LCP 资源尽早被发现和加载**：LCP 图片直接写在 HTML 里并加上 `fetchpriority="high"`；写在 CSS 背景里或由 JS 渲染的图片，用 preload 提前加载（见[资源提示](/basics/browser/11-resource-hints)）
- **首屏大图不要懒加载**：`loading="lazy"` 会推迟它的加载（见[图片懒加载](/basics/browser/12-lazy-loading)）
- **压缩图片**：使用 WebP、AVIF 等格式，按显示尺寸提供图片
- **减少阻塞渲染的 CSS 和 JS**：关键 CSS 内联，非关键 JS 加 `defer`
- **考虑 SSR**：首屏 HTML 直接带上内容，不用等 JS 下载执行完才渲染

### 优化 INP

一次交互的延迟由三部分组成：输入延迟（等主线程空闲）、事件处理耗时、渲染下一帧的耗时。优化的核心是让主线程尽快空出来：

- **拆分长任务**：执行时间超过 50 毫秒的任务就是长任务，执行期间页面无法响应输入
- **及时让出主线程**：用 `setTimeout` 分片，支持的浏览器中可以用 `scheduler.yield()`
- **减少不必要的渲染**：避免一次交互触发大范围的组件更新和 DOM 操作
- **繁重计算移到 Web Worker**（见 [Web Worker](/basics/browser/15-web-worker)）

```js
function yieldToMain() {
  if (globalThis.scheduler?.yield) return scheduler.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function processItems(items) {
  let start = performance.now()
  for (const item of items) {
    handle(item)
    // 连续执行超过 50ms 就让出一次主线程，让浏览器先响应输入、渲染页面
    if (performance.now() - start > 50) {
      await yieldToMain()
      start = performance.now()
    }
  }
}
```

### 优化 CLS

- 图片、视频设置 `width` 和 `height` 属性，或者用 CSS 的 `aspect-ratio`，让浏览器提前预留空间
- 为广告、嵌入内容和动态加载的模块预留位置
- 不要在已有内容的上方插入内容（用户操作触发的除外）
- 字体使用合适的 `font-display`，尽量减少字体替换前后的尺寸变化
- 动画使用 `transform`，不要改 `top`、`width` 这类会影响布局的属性

## 面试官可能追问

::: details 什么是长任务？
在主线程上连续执行超过 50 毫秒的任务。执行期间浏览器无法响应用户输入，也无法渲染，是 INP 差的主要原因。在 DevTools 的 Performance 面板里，长任务会用红色三角标出。实验室指标 TBT 统计的就是页面加载过程中，各个长任务超出 50 毫秒部分的总和。
:::

::: details 为什么 FID 被 INP 取代？
FID 只统计**第一次**交互的**输入延迟**，也就是从用户操作到事件处理函数开始执行的等待时间，不包含事件处理本身和之后渲染的耗时。很多网站的 FID 很好看，实际交互却明显卡顿。INP 统计整个页面生命周期内的所有交互，并且衡量从输入到下一帧画面的完整延迟，更能反映真实体验。
:::

::: details 如何在线上采集 Web Vitals？
用 `web-vitals` 库在用户的浏览器中采集，通过 `navigator.sendBeacon` 上报到自己的服务端。CLS 和 INP 要到页面隐藏时才能确定最终值，库会在合适的时机回调。服务端按页面、设备类型分组，计算第 75 百分位并观察趋势。完整的采集方案见[前端监控](/basics/browser/20-monitoring)。
:::

## 易错点

- Core Web Vitals 目前只有 LCP、INP、CLS 三个，FCP、TTFB、TBT 是辅助指标
- Lighthouse 分数高不代表真实用户体验好，Google 评估用的是真实用户数据
- CLS 不是时间，而是一个没有单位的分数；用户操作后很短时间内发生的布局变化不计入
