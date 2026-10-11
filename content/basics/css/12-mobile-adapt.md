---
difficulty: 2
tags: [高频, 实践]
---

# 移动端适配要注意哪些问题？1px 边框怎么实现？

::: tip 一句话回答
移动端适配先写好 **viewport meta**，让布局视口等于设备宽度；再用 rem 或 vw 方案按设计稿缩放。**1px 问题**来自设备像素比（DPR）：CSS 的 1px 在 2 倍屏上是 2 个物理像素，看起来偏粗，常用**伪元素加 `transform: scale(0.5)`** 画出物理 1px 的线。另外要处理刘海屏的**安全区域**、保证**点击区域**足够大，以及 iOS 上输入框字号小于 16px 时聚焦会自动放大的问题。
:::

## 详细解析

### viewport meta

没有 viewport meta 时，移动浏览器会假设页面是给桌面设计的，用一个 980px 左右的布局视口渲染，再整体缩小显示，文字很小。标准写法是：

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

`width=device-width` 让布局视口等于设备的 CSS 宽度，`viewport-fit=cover` 让页面铺满刘海屏的整个屏幕，配合下面的安全区域使用。单位选择和 rem/vw 方案见 [响应式单位](/basics/css/09-responsive-units)。

### 设备像素比和 1px 问题

**DPR**（`window.devicePixelRatio`）是物理像素和 CSS 像素的比值。2 倍屏上 1 个 CSS 像素占 2×2 个物理像素。设计稿通常按 2 倍图出（例如 750 宽），设计师画的 1px 线换算到 CSS 是 0.5px，而我们写 `border: 1px` 实际占了 2 个物理像素，所以显得粗。

常见方案：

| 方案 | 做法 | 优缺点 |
| --- | --- | --- |
| `0.5px` 边框 | 直接写 `border: 0.5px solid` | 最简单；iOS 上支持较好，部分旧版安卓 WebView 会当成 0（不显示）或 1px，要在目标机型上实测 |
| 伪元素缩放 | 伪元素宽高 200%，画 1px 边框，再 `scale(0.5)` | 兼容性最好，支持圆角，最常用；占用了伪元素 |
| `box-shadow` | `box-shadow: 0 0 0 0.5px #ddd` | 写法短，颜色会偏淡 |
| viewport 缩放 | 按 DPR 把 `initial-scale` 设成 `1/dpr` | 全局生效；页面所有尺寸都要跟着放大，早期 lib-flexible 用过，现在少用 |

### 安全区域

刘海屏、底部有横条的手机，屏幕边缘有一部分会被遮挡。设置 `viewport-fit=cover` 后，用 `env(safe-area-inset-top/right/bottom/left)` 读出被遮挡的距离，加到吸顶、吸底元素的内边距里。不支持的浏览器里 `env()` 取第二个参数作为回退值。

### 点击区域和输入框

- **点击区域**：手指比鼠标粗得多，按钮太小容易点错。WCAG 2.2 的 2.5.8（AA 级）要求点击目标至少 24×24 CSS 像素，或者和相邻目标留出足够间距；2.5.5（AAA 级）要求 44×44。移动端一般按 44×44 左右设计。图标按钮视觉上可以小，用 `padding` 或伪元素把可点区域扩大
- **iOS 输入框放大**：iOS Safari 中输入框计算后的字号小于 16px 时，聚焦会自动放大页面，失焦后通常也不会自动缩回。把输入框的 `font-size` 设为 16px 及以上就能避免，注意根字号改小后 `1rem` 可能不到 16px。有人用 `maximum-scale=1` 禁止缩放，这会影响需要放大阅读的用户，不推荐

## 代码示例

```css
/* 伪元素实现物理 1px 下边框 */
.cell {
  position: relative;
}
.cell::after {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  width: 200%;
  height: 200%;
  border-bottom: 1px solid #e5e5e5;
  transform: scale(0.5);
  transform-origin: 0 0;
  pointer-events: none; /* 不挡住点击 */
  box-sizing: border-box;
}

/* 吸底操作栏避开底部横条 */
.action-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

/* 避免 iOS 聚焦放大 */
input,
textarea,
select {
  font-size: 16px;
}
```

## 面试官可能追问

::: details 伪元素方案怎么只在高倍屏上生效？
用分辨率媒体查询，例如 `@media (min-resolution: 2dppx)`，只在 DPR 大于等于 2 时启用缩放；3 倍屏可以再写一条，用 300% 尺寸和 `scale(0.333)`。不过 2 倍的写法在 3 倍屏上效果也可以接受，很多项目只写一套。
:::

::: details 软键盘弹出会带来什么问题？
键盘弹出时，可视区域变小，但不同浏览器处理方式不同：有的缩小视觉视口，`fixed` 吸底元素可能被顶起或被遮住；输入框也可能被键盘挡住。常见做法是监听 `window.visualViewport` 的 `resize` 事件拿到真实可视高度，或者在聚焦时调用 `scrollIntoView()` 把输入框滚到可见区域。
:::

::: details 移动端的 300ms 点击延迟还存在吗？
早期移动浏览器为了判断是不是双击缩放，会把 `click` 延迟约 300ms。现在只要设置了 `width=device-width` 的 viewport，主流浏览器就不再延迟，也可以用 `touch-action: manipulation` 明确禁用双击缩放。所以 FastClick 这类库在新项目里已经不需要了。
:::

## 易错点

- 1px 问题不是"边框画错了"，而是 CSS 像素和物理像素的比例问题，只在高 DPR 屏上明显
- 伪元素缩放方案要给宿主加 `position: relative`，伪元素加 `pointer-events: none`，否则会挡住点击
- 没有在 viewport meta 里设置 `viewport-fit=cover` 时，页面不会延伸到被遮挡的区域，`safe-area-inset-*` 通常是 0，写了 `env()` 也看不出效果
