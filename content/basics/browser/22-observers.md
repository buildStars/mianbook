---
difficulty: 2
tags: [实践, 性能优化]
---

# 浏览器有哪些 Observer API？IntersectionObserver、MutationObserver、ResizeObserver 分别用来做什么？

::: tip 一句话回答
三个 Observer 都是"浏览器在合适的时机批量通知你"，用来替代高频事件和轮询。**IntersectionObserver** 监听元素和视口（或某个祖先）的**交叉情况**，用于懒加载、曝光埋点、无限滚动；**MutationObserver** 监听 **DOM 结构和属性变化**，回调在**微任务**里批量执行；**ResizeObserver** 监听**元素自身尺寸变化**，用于自适应组件。另外还有 `PerformanceObserver`，用来采集性能数据。
:::

## 详细解析

### 三者对比

| | IntersectionObserver | MutationObserver | ResizeObserver |
| --- | --- | --- | --- |
| 观察什么 | 元素与根的交叉比例 | 子节点增删、属性、文本变化 | 元素的内容框或边框尺寸 |
| 替代什么 | scroll 事件 + `getBoundingClientRect` | 定时轮询 DOM、已废弃的 Mutation Events | `window.resize` 事件 |
| 回调时机 | 渲染流程中计算交叉，然后排一个任务回调 | 微任务，同一轮多次变化合并成一批 | 渲染流程中布局之后、绘制之前 |
| 典型场景 | 懒加载、曝光埋点、吸顶判断 | 监听第三方脚本改 DOM、编辑器 | 图表自适应、容器查询的 JS 兜底 |

共同的用法：`new XxxObserver(callback)`，`observe(target, options)` 开始观察，`unobserve` 取消某个目标，`disconnect` 全部停止。

### 为什么比事件监听好

- **不用在主线程里频繁算位置**。scroll 一秒触发几十次，每次调 `getBoundingClientRect` 还可能触发 [强制同步布局](/basics/browser/02-reflow-repaint)；IntersectionObserver 由浏览器在渲染流程里统一计算
- **批量回调**。MutationObserver 把一轮里的所有变化攒成一个数组一次给你，不会每改一个节点回调一次
- **粒度对**。`window.resize` 只知道窗口变了，组件真正关心的是自己的容器变了没有，侧边栏收起时窗口没变、容器变了，只有 ResizeObserver 能感知

## 代码示例

```js
// 曝光埋点：元素露出一半以上算一次曝光，只报一次
const io = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        report('exposure', entry.target.dataset.id)
        io.unobserve(entry.target)
      }
    }
  },
  { threshold: 0.5 },
)
document.querySelectorAll('.card').forEach((el) => io.observe(el))

// MutationObserver：监听列表子节点变化
const mo = new MutationObserver((records) => {
  console.log('本批变化数', records.length)
})
mo.observe(list, { childList: true, subtree: true })

// ResizeObserver：图表跟着容器尺寸重绘
const ro = new ResizeObserver(([entry]) => {
  const { width, height } = entry.contentRect
  chart.resize(width, height)
})
ro.observe(chartContainer)
```

图片懒加载的完整实现和降级方案见 [图片懒加载](/basics/browser/12-lazy-loading)，这里不展开。

## 面试官可能追问

::: details MutationObserver 的回调为什么是微任务？
DOM 修改往往是一连串的，放到微任务里，等当前同步代码全部改完再一次性通知，既能合并变化，又能在渲染之前处理完。所以在回调里读到的是这一批修改后的最终状态。微任务的执行时机见 [事件循环](/basics/javascript/01-event-loop)。
:::

::: details ResizeObserver 报 "loop completed with undelivered notifications" 是什么？
回调里又改了被观察元素的尺寸，浏览器在同一帧里再次检测到变化，为了防止无限循环会把剩下的通知推到下一帧，并报这个错误。它通常无害，但说明回调里有改尺寸的逻辑，可以把修改放进 `requestAnimationFrame`，或者确保尺寸收敛。
:::

::: details IntersectionObserver 的 rootMargin 有什么用？
它扩大或缩小根的判定区域。懒加载时设 `rootMargin: '200px'`，元素离视口还有 200px 时就开始加载，用户滚到时图片已经好了。做吸顶判断时也常配合负值使用。
:::

::: details 用完不 disconnect 会怎样？
Observer 会一直持有回调和观察目标的引用。组件卸载了不断开，回调还可能被触发，访问已经销毁的状态，也会妨碍回收。框架里在 `onUnmounted` 或 `useEffect` 的清理函数里调用 `disconnect`。
:::

## 易错点

- IntersectionObserver 在 `observe` 之后会立刻回调一次初始状态，要用 `isIntersecting` 判断，不能默认回调就是"进入视口"
- MutationObserver 回调是微任务，不是每次改 DOM 后同步触发
- ResizeObserver 观察的是元素尺寸，不是窗口尺寸
