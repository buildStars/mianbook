---
difficulty: 1
tags: [高频, 实践]
---

# 水平垂直居中有哪些实现方式？

::: tip 一句话回答
要先分场景：**单行文本**用 `text-align: center` 加 `line-height` 等于容器高度；**定宽块级元素水平居中**用 `margin: 0 auto`；**通用方案**首选 **flex**（`justify-content` + `align-items` 都设 `center`）或 **grid**（`place-items: center`），不需要知道子元素尺寸。需要脱离文档流时，用**绝对定位 + `transform: translate(-50%, -50%)`**，或者定宽高时用**绝对定位 + `inset: 0` + `margin: auto`**。
:::

## 详细解析

### 行内内容和文本

```css
.box {
  height: 40px;
  line-height: 40px; /* 只适用于单行文本 */
  text-align: center; /* 让行内内容水平居中 */
}
```

`text-align` 作用在**容器**上，控制里面的行内内容（文字、`inline-block`、图片）怎么对齐，不是让容器自己居中。多行文本用 `line-height` 会让每一行都变成 40px 高，不适合。

### 块级元素水平居中

```css
.child {
  width: 200px;
  margin: 0 auto; /* 左右 auto 平分剩余空间 */
}
```

前提是**块级元素、宽度小于父元素**。普通流里 `margin: auto` 只能处理水平方向，垂直方向的 auto 会算成 0。

### flex 和 grid

```css
/* flex */
.parent {
  display: flex;
  justify-content: center; /* 主轴 */
  align-items: center; /* 交叉轴 */
}

/* grid：一行搞定 */
.parent {
  display: grid;
  place-items: center;
}
```

flex 和 grid 子项上的 `margin: auto` 在**两个方向**都生效，所以父元素 `display: flex`、子元素 `margin: auto` 也能居中。

### 绝对定位的两种写法

```css
.parent {
  position: relative;
}

/* 写法一：不需要知道子元素尺寸 */
.child {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%); /* 百分比相对自身尺寸，往回拉一半 */
}

/* 写法二：需要子元素有确定的宽高 */
.child {
  position: absolute;
  inset: 0; /* 等价于 top/right/bottom/left 都是 0 */
  width: 200px;
  height: 100px;
  margin: auto; /* 四个方向平分剩余空间 */
}
```

`top: 50%` 的百分比相对包含块，`translate(-50%)` 的百分比相对元素自身，组合起来正好居中。

### 方案对比

| 方案 | 前提 | 适用场景 |
| --- | --- | --- |
| `text-align` + `line-height` | 单行文本，容器高度固定 | 按钮、标签里的文字 |
| `margin: 0 auto` | 块级、定宽，只能水平 | 页面主体内容区 |
| flex | 无 | 通用首选，尤其是还要排列多个子元素 |
| grid `place-items` | 无 | 通用，代码最短 |
| 绝对定位 + `transform` | 父元素是定位元素 | 弹窗、浮层，尺寸不固定 |
| 绝对定位 + `inset: 0` + `margin: auto` | 子元素有确定宽高 | 尺寸固定的弹窗、图标 |

日常开发推荐 flex 或 grid，语义清楚、不脱离文档流，也不依赖子元素尺寸。

## 面试官可能追问

::: details transform 居中有什么缺点？
`transform` 计算出的位置可能落在半像素上，文字或细边框偶尔会发虚。另外它占用了 `transform` 属性，元素如果还要做缩放、旋转动画，要把 `translate` 一起写进去，否则会把居中的位移覆盖掉。现代浏览器支持独立的 `translate` 属性，居中写成 `translate: -50% -50%`，就不会和 `transform` 里的动画互相覆盖。
:::

::: details 弹窗内容比视口还高时，flex 居中有什么问题？
`align-items: center` 会让超出的部分在上下两边同时溢出，顶部的内容会被推到视口外面，滚动也看不到。可以改成在子元素上用 `margin: auto`，空间不足时 auto 会算成 0，内容从顶部开始排列；也可以用 `align-items: safe center`，空间不足时自动退回 `start` 对齐。它是较晚才普及的写法，部分旧版浏览器会接受这个值但忽略 `safe`，要先确认目标浏览器支持。
:::

::: details 图片和文字怎么垂直对齐？
`inline-block` 或图片和文字在一行时，默认按基线对齐，图片底部会和文字基线对齐，下面留出一点空隙。可以给图片设 `vertical-align: middle`，或者直接把父元素改成 flex 加 `align-items: center`。
:::

## 易错点

- `text-align: center` 要写在父元素上，它对块级子元素本身不起作用
- 普通流里 `margin: auto` 不能垂直居中，在 flex、grid 子项或 `inset: 0` 的绝对定位元素上才能
- `line-height` 方案只适合单行，文本一换行就会撑高容器
