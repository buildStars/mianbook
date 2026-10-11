---
difficulty: 1
tags: [高频, 对比]
---

# 隐藏元素有哪些方式？display: none、visibility: hidden、opacity: 0 有什么区别？

::: tip 一句话回答
`display: none` 让元素**不生成盒子**，不占位、不响应事件，切换会触发回流；`visibility: hidden` **保留占位**但看不见，不响应事件，只触发重绘，子元素还能设 `visibility: visible` 重新显示；`opacity: 0` 只是**完全透明**，仍然占位、**仍能被点击和聚焦**，读屏器也能读到。只想对视觉隐藏、保留给读屏器时，用 `.visually-hidden` 这类写法。
:::

## 详细解析

### 三种方式对比

| | `display: none` | `visibility: hidden` | `opacity: 0` |
| --- | --- | --- | --- |
| 占据空间 | 不占 | 占 | 占 |
| 响应点击 | 不响应 | 不响应 | **响应** |
| Tab 聚焦 | 不能 | 不能 | **能** |
| 切换的渲染代价 | 回流 + 重绘 | 只重绘 | 合成层上只需合成 |
| 过渡动画 | 一般不能 | 能，配合 `opacity` 做淡出 | 能 |
| 子元素能否单独显示 | 不能 | 能，子元素设 `visible` | 不能，透明度会叠乘 |
| 读屏器 | 读不到 | 读不到 | 能读到 |

回流和重绘的代价差异见 [回流和重绘](/basics/browser/02-reflow-repaint)。

### 其他隐藏方式

- **`hidden` 属性**：`<div hidden>`，浏览器默认样式里等价于 `display: none`。语义清晰，但这条规则来自浏览器默认样式，作者样式里写了 `display: flex` 就会把它覆盖掉，可以全局补一句 `[hidden] { display: none !important; }`
- **`aria-hidden="true"`**：和上面相反，视觉上可见，只对读屏器隐藏，常用于装饰性图标
- **`clip-path: inset(50%)`**：把元素裁剪到看不见，仍然占位，被裁掉的区域不响应点击
- **移出屏幕**：`position: absolute; left: -9999px`，不占位、读屏器可读，老式写法
- **`content-visibility: hidden`**：元素自身的盒子还在，但跳过内容的渲染，内容读屏器也读不到；它保留内容的渲染状态，再次显示时通常比从 `display: none` 恢复更快。它会给元素加上尺寸隔离，没写宽高或 `contain-intrinsic-size` 时高度会变成 0。它的 `auto` 值更常用于长页面的渲染优化
- **`transform: scale(0)`**、`width: 0; height: 0; overflow: hidden`：也能达到效果，但意图不清晰，不推荐作为常规手段

### 视觉隐藏但读屏可读

图标按钮旁边的说明文字、跳转到主内容的链接，需要读屏器能读到，但视觉上不显示。`display: none` 和 `visibility: hidden` 都会让读屏器也读不到，所以要用一组样式把元素缩到 1px 并裁掉：

```css
.visually-hidden {
  position: absolute !important;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  clip-path: inset(50%);
  white-space: nowrap; /* 防止文字被压成一列，读屏器逐字读 */
  border: 0;
}
```

`clip` 已经废弃，保留它是为了兼容旧浏览器，新浏览器用 `clip-path`。

## 代码示例

```css
/* 淡入淡出的浮层：同时过渡 opacity 和 visibility */
.popover {
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s, visibility 0.2s;
}
.popover.open {
  opacity: 1;
  visibility: visible;
}
```

只用 `opacity: 0` 隐藏的浮层看不见却还能被点到，会挡住下面的按钮。加上 `visibility` 后，淡出过程中元素保持可见，过渡结束才变成 `hidden`，不再响应点击。

## 面试官可能追问

::: details 单行和多行文本溢出省略号怎么写？
单行：`overflow: hidden; white-space: nowrap; text-overflow: ellipsis;`，元素宽度要受限（块级元素被父元素约束，或者设了宽度），在 flex 子项里还要加 `min-width: 0`。多行用 `-webkit-line-clamp`，虽然带前缀，但主流浏览器都支持：

```css
.clamp-2 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
```
:::

::: details visibility: hidden 的父元素里，子元素设 visible 会怎样？
子元素会正常显示，因为 `visibility` 是可继承属性，子元素可以覆盖。`display: none` 不行，父元素连盒子都不生成，子元素无论怎么设置都不会显示；`opacity` 也不行，子元素的最终透明度是父子相乘，父元素为 0 时子元素一定看不见。
:::

::: details 用 opacity: 0 隐藏元素有什么隐患？
元素看不见但仍在原位，会挡住下面的元素的点击；里面的按钮、链接仍能被 Tab 聚焦，键盘用户会聚焦到一个看不见的东西上；读屏器也会读出来。所以 `opacity: 0` 适合做动画的中间状态，动画结束后要配合 `visibility: hidden` 或 `display: none`。
:::

## 易错点

- `opacity: 0` 的元素仍然响应点击和聚焦，常见的"看不见的遮罩挡住按钮"就是这个原因
- `hidden` 属性会被作者样式里的 `display` 覆盖，写了 `display: flex` 的元素加 `hidden` 不会隐藏
- 用 `display: none` 隐藏的说明文字，读屏器也读不到，不能用来做无障碍文本
