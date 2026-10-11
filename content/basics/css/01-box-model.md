---
difficulty: 1
tags: [高频, 原理]
---

# CSS 盒模型是什么？box-sizing 有什么作用？

::: tip 一句话回答
每个元素在布局时都被看成一个矩形盒子，从内到外依次是 **content、padding、border、margin**。`box-sizing` 决定 `width`、`height` 指的是哪一层：默认的 **`content-box`** 只算内容区，padding 和 border 会往外撑大；**`border-box`** 把 padding 和 border 算在 `width` 里，内容区自动缩小。项目里通常全局设成 `border-box`，写尺寸更直观。
:::

## 详细解析

### 盒子的四层

| 层 | 作用 | 是否有背景 |
| --- | --- | --- |
| content | 放文字、图片等内容 | 有 |
| padding | 内容和边框之间的留白 | 有，背景默认延伸到 padding |
| border | 边框 | 背景默认也画到边框下面，虚线、半透明边框时能看出来 |
| margin | 和其他盒子之间的距离 | 没有，永远透明 |

margin 可以是负值，padding 不行。相邻块级元素的垂直 margin 还会合并，这一点放在 [BFC](/basics/css/02-bfc) 里讲。

### content-box 和 border-box 的宽度计算

同样一段样式：

```css
.box {
  width: 200px;
  padding: 20px;
  border: 5px solid #333;
  margin: 10px;
}
```

| | `content-box`（默认） | `border-box` |
| --- | --- | --- |
| 内容区宽度 | 200px | 200 - 20×2 - 5×2 = 150px |
| 元素可见宽度（含边框） | 200 + 40 + 10 = 250px | 200px |
| 占据的水平空间（含 margin） | 270px | 220px |

两种模式下 margin 都不算进 `width`。`border-box` 只是把 padding 和 border "收"进去，margin 永远在外面。

### 为什么项目里常全局设 border-box

- **尺寸符合直觉**：设计稿上一个按钮宽 120px，就写 `width: 120px`，加 padding 不用再心算减法
- **百分比布局不溢出**：两栏各 `width: 50%` 再加 padding，`content-box` 下会超过 100% 导致换行，`border-box` 不会
- 很多 CSS 重置库和 UI 框架都默认这样做

常见写法是让所有元素继承根元素的设置，第三方组件需要 `content-box` 时可以在局部改回来：

```css
html {
  box-sizing: border-box;
}
*,
*::before,
*::after {
  box-sizing: inherit;
}
```

### 行内元素的盒模型

`span`、`a` 这类**行内非替换元素**也有四层，但表现不同：

- `width`、`height` 不生效，尺寸由内容决定
- **水平方向**的 padding、border、margin 正常生效，会推开左右的内容
- **垂直方向**的 margin 完全不生效；垂直的 padding 和 border 会画出来（背景会变高），但**不影响行高**，不会把上下行推开，可能和相邻行重叠

想让行内元素的垂直方向尺寸参与布局，改成 `display: inline-block`。`img` 这类**替换元素**，以及 `input`、`button` 等表单控件，虽然也是行内级元素，但宽高和垂直 margin 都生效，会把所在的行撑高。

## 代码示例

```html
<p style="line-height: 20px">
  第一行文字
  <span style="padding: 10px; margin: 10px; background: #fde68a">行内元素</span>
  第一行文字
  <br />
  第二行文字：上一行 span 的黄色背景会向上下溢出，但这一行的位置没有被推开
</p>
```

## 面试官可能追问

::: details 怎么用 JS 拿到元素的各种尺寸？
`offsetWidth` 是 content + padding + border；`clientWidth` 是 content + padding，不含边框和滚动条；`scrollWidth` 是内容实际宽度，包括溢出部分。`getBoundingClientRect().width` 和 `offsetWidth` 接近，但它会计入 `transform` 缩放、并且返回小数。这几个都不包含 margin。
:::

::: details padding 和 margin 设成百分比时参照什么？
参照**包含块的宽度**，上下方向也一样参照宽度，不是高度。利用这一点，以前常用 `padding-top: 56.25%` 做 16:9 的固定比例容器。现在直接用 `aspect-ratio: 16 / 9` 更清晰。
:::

::: details box-sizing: border-box 时，padding 比 width 还大会怎样？
内容区宽度不会变成负数，最小为 0。这时元素的实际宽度是 padding + border 的总和，超过了设定的 `width`。
:::

## 易错点

- `border-box` 不包括 margin，margin 在两种模式下都在 `width` 之外
- 背景默认会画到 border 下面（`background-clip` 默认值是 `border-box`），不是只画在 content 区
- 给行内元素设垂直 margin 没效果，设垂直 padding 只是看起来变大，不会撑开行
