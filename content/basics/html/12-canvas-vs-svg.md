---
difficulty: 1
tags: [高频]
---

# Canvas 和 SVG 有什么区别？各适合什么场景？

::: tip 一句话回答
**Canvas 是位图**，用 JS 一笔一笔画到像素上，画完浏览器只记得像素，不记得图形；**SVG 是矢量**，每个图形都是 DOM 节点，浏览器一直保留着它们。所以 SVG 缩放不失真、可以直接给图形绑事件、能用 CSS 控制，但节点多了会变慢；Canvas 放大会模糊、交互要自己算点击位置，但图形数量多时性能稳定。图标、交互图表、元素不多的图形用 SVG；游戏、大量数据点、频繁重绘、图像处理用 Canvas。
:::

## 详细解析

### 本质区别：即时模式和保留模式

- **Canvas（即时模式）**：调用 `ctx.fillRect()` 时，像素立刻被画到画布上，然后就没有"这个矩形"了。想移动它，要清掉画布，在新位置重画
- **SVG（保留模式）**：`<rect>` 是文档里的一个元素，改它的 `x` 属性，浏览器会自己重新渲染。图形一直以对象的形式存在

后面的所有差异，基本都是从这一点推出来的。

### 对比

| | Canvas | SVG |
| --- | --- | --- |
| 图像类型 | 位图 | 矢量 |
| 绘制方式 | JS 调用绘图 API | 标签声明，也可以用 JS 操作 DOM |
| 缩放 | 放大会模糊，高清屏要按 `devicePixelRatio` 放大画布 | 任意缩放都清晰 |
| 事件 | 只能绑在整个 canvas 上，自己判断点中了哪个图形 | 每个图形都能直接绑事件 |
| 样式 | 在代码里设置 | 可以用 CSS，包括 `:hover` 和动画 |
| 元素很多时 | 性能主要取决于画布大小和重绘频率 | 每个图形都是 DOM 节点，节点多了布局和渲染都变慢 |
| 可访问性和 SEO | 内容对屏幕阅读器不可见，要额外提供替代内容 | 文本可选中、可被读取 |
| 导出 | `toDataURL` / `toBlob` 导出图片 | 本身就是文本，可以直接保存 |

### 怎么选

- **用 SVG**：图标、Logo、插画；节点数量不多的交互图表，如柱状图、流程图；需要无级缩放的地图、示意图
- **用 Canvas**：游戏、粒子动画；成千上万的数据点，如大规模散点图、热力图；图片滤镜、裁剪、像素级处理；需要每帧重绘的场景
- 很多图表库两种渲染方式都支持，数据量小时用 SVG，数据量大时切换成 Canvas

需要更高性能的 3D 或大规模图形，可以用 WebGL，它也是画在 canvas 元素上的。

### OffscreenCanvas

普通 canvas 只能在主线程绘制，复杂绘制会阻塞交互。`OffscreenCanvas` 可以通过 `transferControlToOffscreen()` 交给 Web Worker，在 Worker 里绘制，主线程不受影响。Worker 的用法见 [Web Worker](/basics/browser/15-web-worker)。

## 代码示例

```html
<!-- SVG：图形是元素，直接绑事件、用 CSS -->
<svg width="120" height="80">
  <rect id="box" x="10" y="10" width="100" height="60" fill="steelblue" />
</svg>

<!-- Canvas：只有一块画布 -->
<canvas id="cv" width="120" height="80"></canvas>

<script>
  document.getElementById('box').addEventListener('click', () => alert('点中了 SVG 矩形'))

  const cv = document.getElementById('cv')
  const ctx = cv.getContext('2d')
  const rect = { x: 10, y: 10, w: 100, h: 60 }
  ctx.fillStyle = 'steelblue'
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)

  // Canvas 要自己判断点中了哪个图形
  cv.addEventListener('click', (e) => {
    const { left, top } = cv.getBoundingClientRect()
    const x = e.clientX - left
    const y = e.clientY - top
    if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
      alert('点中了 Canvas 矩形')
    }
  })
</script>
```

## 面试官可能追问

::: details Canvas 在高清屏上模糊怎么办？
canvas 的 `width`/`height` 属性是画布的像素数，CSS 宽高是显示尺寸。把画布像素设为显示尺寸乘以 `devicePixelRatio`，再用 `ctx.scale(dpr, dpr)` 缩放坐标系，CSS 尺寸保持不变，就能清晰显示。
:::

::: details Canvas 里图形很多时，点击检测怎么做才高效？
逐个判断是 O(n)，图形多时可以按区域分块，或用四叉树这类空间索引，只检查点击位置附近的图形。另一种做法是离屏画一张"颜色拾取图"，每个图形用唯一颜色画，点击时读这个位置的像素颜色就知道是哪个图形。
:::

::: details SVG 节点多了很卡，除了换 Canvas 还能怎么办？
减少节点：合并路径，把多个图形画进一个 `path`；不可见的部分不渲染；减少会引起重排的属性变化，动画尽量用 `transform`。但数量级上去之后，换 Canvas 仍然是最有效的办法。
:::

## 易错点

- 用 CSS 改 canvas 的宽高不会增加画布像素，只是拉伸显示，图像会变形或模糊
- 以为 SVG 一定比 Canvas 慢。图形少时 SVG 开发效率更高、性能也够，慢是在节点数量很多时才出现
- 每次重绘 Canvas 忘了 `clearRect`，新旧图形叠在一起
