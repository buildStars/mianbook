---
difficulty: 2
tags: [高频, 性能优化]
---

# CSS 动画怎么做才流畅？transition 和 animation 有什么区别？

::: tip 一句话回答
`transition` 是**过渡**，属性值变化时在两个状态之间补间，需要触发；`animation` 配合 `@keyframes` 定义**多个关键帧**，可以自动播放、循环、暂停。动画流畅的关键是**只动 `transform` 和 `opacity`**：它们可以只在合成阶段处理，不触发布局和绘制。`will-change` 只给真正要动的元素加，同时尊重用户的 `prefers-reduced-motion` 设置。
:::

## 详细解析

### transition 和 animation 的区别

| | `transition` | `animation` |
| --- | --- | --- |
| 触发方式 | 属性值变化时触发，如 `:hover`、切换 class | 样式生效就自动播放 |
| 关键帧 | 只有起点和终点 | `@keyframes` 定义任意多个 |
| 循环 | 不能 | `animation-iteration-count: infinite` |
| 控制 | 只能靠改属性值 | `animation-play-state` 暂停，`animation-direction` 反向，`animation-fill-mode` 保留首尾帧 |
| 事件 | `transitionend` | `animationstart`、`animationiteration`、`animationend` |
| 适用 | 交互反馈：悬停、展开、切换 | 加载动画、循环动画、复杂序列 |

### 为什么只动 transform 和 opacity

浏览器渲染一帧大致经过：样式计算 → 布局 → 绘制 → 合成。动画每一帧改的属性决定要重走哪几步：

1. 改 `width`、`height`、`top`、`left`、`margin`：重新**布局**，后面全部重来，代价最高
2. 改 `color`、`background`、`box-shadow`：跳过布局，但要重新**绘制**
3. 改 `transform`、`opacity`：元素在独立合成层上时，只需要**合成**，由合成线程处理

所以位移用 `transform: translate()` 代替 `left`，缩放用 `scale()` 代替改宽高，淡入淡出用 `opacity`。回流和重绘的细节见 [回流和重绘](/basics/browser/02-reflow-repaint)。

用 CSS（或 Web Animations API）声明的 `transform`、`opacity` 动画还有一个好处：主流浏览器可以把它交给合成线程独立运行，主线程被 JS 长任务卡住时动画照样流畅。用 JS 在 `requestAnimationFrame` 里每帧修改 `transform` 就没有这个好处，因为每一帧都要主线程参与。

### will-change 的正确用法

`will-change: transform` 提前告诉浏览器元素要变化，浏览器可以提前把它提升为合成层，避免动画开始那一下卡顿（基本概念见 [回流和重绘](/basics/browser/02-reflow-repaint) 的追问）。用法上要注意：

- 只给即将动画的元素加，比如在 `:hover` 的父元素上或动画开始前用 JS 加，结束后移除
- 不要写 `* { will-change: transform; }`，每个合成层都要额外的内存（尤其是显存）
- 它有副作用：值里写了哪个属性，就会产生那个属性非初始值时的效果。`will-change: transform` 会创建层叠上下文，还会让元素成为 `fixed` 后代的包含块，见 [position 与 z-index](/basics/css/07-position-zindex)

### 合成层与层爆炸

一个元素被提升为合成层后，层叠顺序在它上面、和它有重叠的元素，可能也要被提升，否则无法正确合成。大量元素被这样连带提升，就是**层爆炸**，内存暴涨，在移动端反而更卡。排查时用 DevTools 的 Layers 面板看层的数量和原因，解决办法是给动画元素设置较高的 `z-index`，减少被它"压住"的元素，或者缩小动画元素的范围。

### 尊重减少动画的偏好

有前庭障碍的用户可能会在系统里开启"减少动态效果"，页面应通过 `prefers-reduced-motion` 关闭或减弱大幅度的动画。

## 代码示例

```css
/* ❌ 改 left：每帧都要布局 */
.toast-bad { position: relative; left: -100%; transition: left 0.3s; }
.toast-bad.show { left: 0; }

/* ✅ 改 transform 和 opacity：只需合成 */
.toast {
  transform: translateY(100%);
  opacity: 0;
  transition: transform 0.3s ease-out, opacity 0.3s ease-out;
}
.toast.show {
  transform: translateY(0);
  opacity: 1;
}

/* 循环的加载动画 */
@keyframes spin {
  to { transform: rotate(360deg); }
}
.spinner { animation: spin 1s linear infinite; }

/* 用户开启减少动态效果时，关掉动画 */
@media (prefers-reduced-motion: reduce) {
  .spinner { animation: none; }
  .toast { transition: none; }
}
```

## 面试官可能追问

::: details 必须用 JS 做的动画怎么写？
用 `requestAnimationFrame`，回调在每次绘制前执行，和屏幕刷新同步，页面在后台时会暂停，不像 `setTimeout` 那样可能掉帧或白白耗电，见 [requestAnimationFrame](/basics/browser/14-raf-ric)。也可以用 Web Animations API 的 `el.animate()`，写法和 `@keyframes` 类似，还能拿到动画对象来暂停、反向、监听结束；它和 CSS 动画一样，动 `transform`、`opacity` 时可以交给合成线程。
:::

::: details height 从 0 过渡到 auto 为什么没有动画？
`auto` 不是一个可以插值的具体数值，浏览器不知道中间帧该是多少，所以直接跳变。常见解法：过渡 `max-height` 到一个足够大的值（缺点是时长不准）；用 Grid 把 `grid-template-rows` 从 `0fr` 过渡到 `1fr`；或者用 JS 先测出实际高度再设置具体像素值。较新的 `interpolate-size: allow-keywords` 能让 `auto` 直接参与过渡，但浏览器支持还不全，只能作为渐进增强。
:::

::: details 怎么判断动画是否掉帧？
在 Performance 面板录制，看帧条里有没有长帧，以及每帧里是否出现紫色的 Layout 和绿色的 Paint；Rendering 面板可以打开帧率统计和 Paint flashing，查看实时帧率和被重绘的区域。
:::

## 易错点

- 只切换 `display: none` 和 `block` 时过渡不会生效，元素从无到有，没有起始状态。较新的 `@starting-style`（定义首次渲染时的起始值）配合给 `display` 加上 `transition-behavior: allow-discrete` 可以解决，用前查兼容性；传统做法是改用 `opacity` 加 `visibility`
- `will-change` 不是越多越好，滥用会占用大量内存，还会改变层叠上下文和包含块
- 用 `transform` 也不一定只合成：元素没有被提升为合成层时，变化仍可能触发重绘
