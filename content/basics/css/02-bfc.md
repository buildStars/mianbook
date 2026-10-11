---
difficulty: 2
tags: [高频, 原理]
---

# BFC 是什么？怎么触发？能解决哪些问题？

::: tip 一句话回答
**BFC（块级格式化上下文）**是页面上一块独立的布局区域，里面的块级盒子按规则垂直排列，内外布局互不影响。常见触发方式有 `overflow` 不为 `visible`、`display: flow-root`、浮动、绝对定位、`inline-block`，以及 flex / grid 的子项。它能解决三类问题：**阻止父子外边距合并**、**包含浮动子元素（清除浮动）**、**不被旁边的浮动元素覆盖**。现在推荐用专门的 `display: flow-root` 触发，没有副作用。
:::

## 详细解析

### BFC 的布局规则

1. 内部的块级盒子从上到下一个接一个排列
2. 同一个 BFC 里相邻块级盒子的**垂直 margin 会合并**
3. 每个盒子的左外边缘紧贴包含块的左边缘（从右到左书写时是右边），即使旁边有浮动元素也是如此，只是里面的行盒会缩短、让文字绕开浮动
4. **BFC 的区域不会和浮动元素重叠**
5. **计算 BFC 的高度时，浮动的子元素也参与计算**
6. BFC 是隔离的容器，里面的元素不会影响外面的布局，反之亦然

后面三条就是 BFC 能解决问题的根源。

### 怎么触发

| 方式 | 副作用 |
| --- | --- |
| `display: flow-root` | 没有，专门为创建 BFC 设计，推荐 |
| `overflow: hidden / auto / scroll` | 内容溢出会被裁剪或出现滚动条 |
| `float: left / right` | 元素脱离普通流 |
| `position: absolute / fixed` | 脱离文档流 |
| `display: inline-block` | 变成行内级，受空白字符、基线对齐影响 |
| flex / grid 容器的直接子项 | 需要父元素本来就是 flex / grid |
| 表格单元格、`display: table-cell` 等 | 表格相关的布局行为 |
| 根元素 `html` | 整个页面本身就是一个 BFC |

注意 flex、grid 容器自己创建的是 flex / grid 格式化上下文，不是 BFC，但它的子项（本身是块容器时）会各自创建 BFC。`overflow: clip` 不会创建 BFC，这是它和 `overflow: hidden` 的区别之一。另外 `contain: layout / paint`、多列容器等也会创建 BFC，日常用得少。

### 外边距合并的三种情况

合并规则：两个都是正数取较大值，都是负数取绝对值较大的，一正一负则相加。

- **相邻兄弟**：上面元素的 `margin-bottom` 和下面元素的 `margin-top` 合并
- **父子之间**：父元素没有 border、padding、行内内容把它和第一个子元素隔开时，子元素的 `margin-top` 会"穿透"到父元素外面；底部同理（父元素还要没有固定高度）
- **空的块元素**：自身没有内容、padding、border、高度时，它的 `margin-top` 和 `margin-bottom` 合并成一个

只有普通流中块级盒子的**垂直** margin 会合并。浮动、绝对定位、`inline-block` 元素，以及 flex / grid 子项之间都不会。

### 能解决的三个问题

1. **父子 margin 合并**：给父元素创建 BFC，子元素的 margin 就留在父元素里面
2. **包含浮动（清除浮动）**：子元素全部浮动时父元素高度塌陷为 0；父元素成为 BFC 后，高度会把浮动子元素算进去
3. **不被浮动元素覆盖**：浮动元素旁边的普通块会钻到浮动元素下面（只有文字绕开）；让它创建 BFC，它就会缩窄自己，紧贴浮动元素排列，这就是 float 两栏布局的原理，见 [两栏、三栏布局](/basics/css/08-classic-layout)

## 代码示例

```html
<style>
  .parent {
    display: flow-root; /* 去掉这一行，父元素高度只算 .main 的 60px，浮动元素会溢出到父元素外 */
    background: #e0f2fe;
  }
  .float-child {
    float: left;
    width: 100px;
    height: 100px;
    background: #fca5a5;
  }
  .main {
    display: flow-root; /* 去掉这一行，.main 的背景会钻到浮动元素下面 */
    height: 60px;
    background: #bbf7d0;
  }
</style>

<div class="parent">
  <div class="float-child"></div>
  <div class="main">右侧自适应区域</div>
</div>
```

## 面试官可能追问

::: details 清除浮动还有哪些方法？和 BFC 有什么区别？
另一种是在父元素末尾用伪元素加 `clear: both`，也就是常说的 clearfix：`.clearfix::after { content: ""; display: block; clear: both; }`。它的原理是让一个末尾的块元素排到浮动元素下方，从而把父元素撑开，并没有创建 BFC。`display: flow-root` 一行就能同时解决包含浮动和 margin 穿透，是更现代的写法。
:::

::: details 两个相邻兄弟的 margin 合并了，给其中一个设 flow-root 有用吗？
没用。两个兄弟仍然处在父元素所在的同一个 BFC 里，它们之间的 margin 照样合并。BFC 只隔离"内部和外部"，要阻止兄弟合并，得把其中一个包进一个新的 BFC 容器，或者干脆只给一个元素设 margin。
:::

::: details 为什么 flex 布局里没有 margin 合并的问题？
外边距合并是块级格式化上下文里的规则。flex 容器内部是 flex 格式化上下文，子项之间的 margin 不合并，容器和子项之间也不合并。这也是很多人改用 flex 后就不再遇到这个问题的原因。
:::

## 易错点

- `overflow: hidden` 能触发 BFC，但会裁剪溢出内容（比如下拉菜单、阴影），不是没有代价
- 外边距合并只发生在垂直方向，水平 margin 永远不合并
- flex / grid 容器本身不是 BFC，它的子项才是
