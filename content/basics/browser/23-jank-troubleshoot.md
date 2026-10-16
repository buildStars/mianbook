---
difficulty: 3
tags: [场景题]
---

# 页面卡顿怎么定位？Performance 面板怎么看？

::: tip 一句话回答
卡顿基本都是**主线程被占住**了。定位分三步：先**复现并录制** Performance，看主线程上的**长任务**（超过 50ms，带红色三角标记）；再展开**火焰图**找到最耗时的函数，区分是 JS 计算、样式布局还是绘制；最后对症处理，常见的是**强制同步布局**、大量 DOM 操作、频繁 GC 和内存泄漏。线上用 **Long Tasks / Long Animation Frames API** 采集，知道哪些页面、哪些脚本在卡。
:::

## 详细解析

### 先确认是哪种卡

- **交互卡**：点了没反应、输入延迟。对应 INP 指标，通常是事件回调里的长任务
- **滚动、动画掉帧**：画面一顿一顿。每帧预算约 16.7ms（60Hz），超了就掉帧
- **越用越卡**：刚打开流畅，用久了变慢。大概率是内存泄漏引起频繁 GC

指标的含义和优化方向见 [Core Web Vitals](/basics/browser/09-web-vitals)，这里只讲怎么找到问题。

### 本地排查步骤

1. 用无痕窗口打开，排除浏览器扩展的干扰
2. 在 Performance 面板开启 **CPU 降速**（如 4x），模拟中低端手机，问题会更明显
3. 点录制，复现卡顿操作，停止录制。只录关键的几秒，录太长不好看
4. 看顶部的 **CPU 图表和 Frames 轨道**：被标记为掉帧或明显偏长的帧就是卡顿的位置
5. 看 **Main** 轨道：灰色块是任务，带红色三角的是长任务，框选这一段
6. 展开火焰图，横轴是时间，纵轴是调用栈，**越宽越耗时**；从上往下找到自己代码里最宽的那个函数
7. 切到底部 **Bottom-Up** 标签，按 Self Time 排序，直接看到"自身"最耗时的函数和它所在的文件行号

### 火焰图里颜色代表什么

| 颜色 | 类型 | 常见原因 |
| --- | --- | --- |
| 黄色 | Scripting（JS 执行） | 大循环、大 JSON 解析、框架重复渲染 |
| 紫色 | Rendering（样式计算、布局） | 改了大量 DOM、强制同步布局 |
| 绿色 | Painting（绘制、合成） | 大面积重绘、阴影滤镜太多 |
| 灰色 | 其他系统任务 | 浏览器内部工作 |

### 几种典型问题在面板里的样子

- **强制同步布局**：一个 JS 函数里夹着很多紫色的 Layout 小块，上面带红色三角警告 "Forced reflow"。原因是写了样式马上读 `offsetHeight` 这类布局属性，原理和改法见 [回流和重绘](/basics/browser/02-reflow-repaint)
- **单个长计算**：一大块黄色。考虑拆分任务、放进 [Web Worker](/basics/browser/15-web-worker)
- **动画逻辑放错地方**：在 `setTimeout` 或 scroll 回调里改样式。改成在 `requestAnimationFrame` 里做，见 [rAF 和 rIC](/basics/browser/14-raf-ric)
- **节点太多**：每次布局都很久，配合 Elements 看 DOM 规模，长列表用 [虚拟列表](/basics/browser/13-long-list)
- **GC 频繁**：Main 上反复出现 `Minor GC` / `Major GC` 块（归在 Scripting 类别里），同时勾选 Memory 复选框能看到 JS 堆呈锯齿状且整体上涨

### 内存导致的卡顿

在 Performance 里勾选 **Memory**，重复操作几轮，看 JS 堆和 DOM 节点数是不是每轮都涨、回不去。确认有涨后到 **Memory** 面板拍两次 **Heap Snapshot**，用 Comparison 视图看多出来的对象，重点找 `Detached` 开头的 DOM 节点。泄漏的常见原因见 [内存泄漏](/basics/javascript/16-memory-leak)。

## 代码示例：线上采集长任务

```js
// Long Tasks：只知道有个长任务，归因比较粗
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    report('longtask', { duration: entry.duration, start: entry.startTime })
  }
}).observe({ type: 'longtask', buffered: true })

// Long Animation Frames：以帧为单位，能看到是哪些脚本拖慢了这一帧
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    const scripts = entry.scripts.map((s) => ({ src: s.sourceURL, duration: s.duration }))
    report('loaf', { duration: entry.duration, scripts })
  }
}).observe({ type: 'long-animation-frame', buffered: true })
```

Long Animation Frames API 目前只有 Chromium 系浏览器支持，使用前用 `PerformanceObserver.supportedEntryTypes` 判断。数据上报的整体方案见 [前端监控](/basics/browser/20-monitoring)。

## 面试官可能追问

::: details 为什么长任务的阈值是 50ms？
来自 RAIL 模型：用户操作后 100ms 内有反馈会感觉是即时的。主线程任务控制在 50ms 内，即使用户在任务中间输入，加上处理时间也能在 100ms 内响应。
:::

::: details 线上用户说卡，本地复现不了怎么办？
先看线上数据：按页面、设备、浏览器分组看 INP 和长任务，找出集中的场景。LoAF 上报的脚本来源能直接指向某个文件甚至第三方脚本。再用 CPU 降速和同类型低端机复现，必要时让用户录 Performance 文件发过来，面板可以直接加载。
:::

::: details 长任务怎么拆？
把大循环切成小块，每块处理完让出主线程：用 `setTimeout(0)`、`MessageChannel`，或者支持时用 `scheduler.yield()`。React 的并发渲染就是这个思路。纯计算且不需要 DOM 的，直接放 Worker。
:::

## 易错点

- 不开 CPU 降速，在开发机上看起来不卡，不代表用户不卡
- 看火焰图要找"自己代码里最宽的函数"，别停在框架或浏览器内部函数上
- 开发环境带 Source Map 和开发模式的框架，比生产慢很多，结论最好在生产构建上再确认一次
