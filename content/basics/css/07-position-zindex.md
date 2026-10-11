---
difficulty: 2
tags: [高频, 原理]
---

# position 有哪些取值？z-index 为什么有时不生效？

::: tip 一句话回答
`position` 有五个值：`static`（默认，普通流）、`relative`（相对自身原位置偏移，仍占位）、`absolute`（相对最近的定位祖先，脱离文档流）、`fixed`（相对视口）、`sticky`（滚动到阈值前像 relative，之后像 fixed，但不会离开父元素）。z-index 不生效通常有两个原因：一是元素**没有创建层叠上下文的条件**（比如 `static` 元素直接写 z-index）；二是**z-index 只在同一个层叠上下文里比较**，父元素的层级低，子元素 z-index 写得再大也盖不过父元素外面的兄弟。
:::

## 详细解析

### 五种定位的参照物

| 值 | 是否脱离文档流 | 偏移参照 |
| --- | --- | --- |
| `static` | 否 | 不生效，`top` 等属性无效 |
| `relative` | 否，原位置仍然占着 | 自己原来的位置 |
| `absolute` | 是 | 最近的 `position` 不为 `static` 的祖先的 padding 区域；没有就是初始包含块 |
| `fixed` | 是 | 视口；祖先有 `transform` 等属性时例外 |
| `sticky` | 否 | 最近的滚动容器，活动范围限制在父元素内 |

`absolute` 和 `fixed` 的元素，如果某个祖先设置了 `transform`（包括独立的 `translate`、`rotate`、`scale`）、`perspective`、`filter`、`backdrop-filter` 不为 `none`，或者 `will-change: transform`、`contain: layout / paint`、`content-visibility: auto` 等，这个祖先就会成为它们的包含块。`filter`、`perspective` 在不同浏览器里的表现曾经不一致，遇到问题以实测为准。这就是 **fixed 弹窗放在有 `transform` 的父元素里，不再相对视口定位** 的原因。常见解决办法是把弹窗挂到 `body` 下，比如 Vue 的 `<Teleport>`、React 的 Portal。

### sticky 为什么失效

1. **没设阈值**：必须至少设置 `top`、`bottom`、`left`、`right` 中的一个
2. **祖先有 `overflow: hidden / auto / scroll`**：sticky 会把这个祖先当成滚动容器，如果真正滚动的是更外层的页面，就看不到效果。只想裁剪内容时可以改用 `overflow: clip`，它不创建滚动容器
3. **父元素高度不够**：sticky 不会离开父元素，父元素和它一样高时就没有可"粘"的距离。典型情况是 flex 容器默认 `align-items: stretch`，侧边栏被拉得和父元素一样高，加上 `align-self: flex-start` 即可

### 层叠上下文

层叠上下文可以理解为一个独立的"图层组"。常见的创建条件：

- 根元素 `html`
- `position` 为 `relative` / `absolute`，且 `z-index` 不是 `auto`
- `position` 为 `fixed` / `sticky`（不需要 z-index）
- flex / grid 的子项，且 `z-index` 不是 `auto`
- `opacity` 小于 1
- `transform`、`filter`、`perspective`、`clip-path`、`mask`、`backdrop-filter` 不为 `none`
- `mix-blend-mode` 不为 `normal`
- `isolation: isolate`
- `will-change` 指定了上面这些属性，`contain` 为 `layout` / `paint` 等

在同一个层叠上下文里，从下到上的绘制顺序是：上下文自身的背景和边框 → z-index 为负的子元素 → 普通流的块级元素 → 浮动元素 → 行内内容 → z-index 为 `auto` 或 0 的定位元素 → z-index 为正的元素。

### z-index 为什么不生效

- **元素不满足条件**：普通流里 `static` 的元素写 z-index 无效。flex / grid 子项是例外，即使是 `static` 也能用 z-index
- **跨上下文比较**：子元素的 z-index 只在父级层叠上下文内部有意义。父元素 A（`z-index: 1`）里的子元素即使设成 `z-index: 9999`，也永远在兄弟元素 B（`z-index: 2`）下面
- **无意中创建了层叠上下文**：给父元素加了 `transform` 动画、`opacity` 过渡，或者 `will-change`，就把子元素"关"在了里面

## 代码示例

```html
<style>
  .a { position: relative; z-index: 1; height: 60px; }
  .b { position: relative; z-index: 2; margin-top: -40px; background: #bfdbfe; }
  .a .popup { position: absolute; z-index: 9999; background: #fecaca; }
</style>

<div class="a">
  A
  <!-- 被 B 盖住：9999 只在 A 内部比较，A 整体的层级是 1 -->
  <div class="popup">A 里的弹层</div>
</div>
<div class="b">B</div>
```

## 面试官可能追问

::: details 怎么排查 z-index 不生效？
从目标元素往上找祖先，看哪一层创建了层叠上下文，再比较这一层和"挡住它的元素"所在层的 z-index。Chrome DevTools 的 Layers 面板可以看合成层，但层叠上下文还是要靠检查祖先的样式。根本的办法是给弹窗、下拉菜单这类浮层统一挂到 `body` 下，并约定一套 z-index 层级。
:::

::: details isolation: isolate 有什么用？
它只做一件事：创建一个新的层叠上下文，没有任何视觉副作用。组件内部的 z-index 用它隔离后，就不会和外部元素互相干扰，比用 `transform: translateZ(0)` 或 `z-index: 0` 这类"偏方"更明确。
:::

::: details absolute 元素的百分比宽度相对谁？
相对它的包含块，也就是最近的定位祖先的 padding 区域。`left: 50%` 也是相对这个区域的宽度。这也是绝对定位居中写法的基础，见 [水平垂直居中](/basics/css/04-center)。
:::

## 易错点

- `fixed` 不一定相对视口，祖先有 `transform`、`filter` 时会相对这个祖先
- `opacity` 小于 1 也会创建层叠上下文，淡入淡出的父元素会把子元素的 z-index "困住"
- sticky 不生效时先检查祖先的 `overflow`，以及父元素是不是被 stretch 成和自己一样高
