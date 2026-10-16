---
difficulty: 2
tags: [原理]
---

# 行内元素的 line-height 和 vertical-align 是怎么工作的？

::: tip 一句话回答
行内内容排成一行行的**行框**（line box），行框里的每段文字、每个行内元素都生成一个**行内框**，非替换行内框的高度就是它的 **`line-height`**，行框的高度是从最高的框顶到最低的框底。行内元素默认按**基线**（baseline，小写字母 x 的底边）对齐，`vertical-align` 就是调整这个对齐方式，只对行内、`inline-block` 和表格单元格生效。`line-height` 推荐写**无单位数字**，子元素继承的是这个系数，各自按自己的字号计算。图片底部的空隙来自基线对齐留出的下沉空间，`inline-block` 之间的缝隙来自 HTML 里的换行符。
:::

## 详细解析

### 行框、行内框和基线

```text
───────────────────────────────── 行框顶部：最高那个框的顶部
             ┌───────┐
  Hxgy 文字   │  img  │
═════════════╧═══════╧═══════════ 基线：文字和图片的底边默认对齐到这里
  g、y 的尾巴伸到基线下面          基线下方还留着一段下沉空间
───────────────────────────────── 行框底部
```

1. 每个行内框的高度：文字和非替换行内元素是 `line-height`；图片、`inline-block` 是它们的 margin box 高度
2. 字形本身的高度（ascent + descent）和 `line-height` 的差叫**行距**（leading），一半加在字形上方，一半加在下方，所以单行文字在自己的行高里是垂直居中的
3. 所有行内框按 `vertical-align` 排好位置后，行框的高度 = 最高的框顶到最低的框底
4. 每个行框开头都有一个看不见的、宽度为 0 的"支柱"（规范里叫 strut），它带着**父元素**的字体和行高。即使一行里只有一张图片，这个支柱也在，这是后面几个"诡异空隙"的根源

### line-height 的写法和继承

| 写法 | 计算方式 | 子元素继承到的 |
| --- | --- | --- |
| `normal` | 浏览器按字体决定，桌面浏览器大约 1.2 | `normal` |
| `1.5`（无单位） | 自身字号 × 1.5 | 系数 1.5，子元素按自己的字号再算 |
| `150%` | 自身字号 × 150%，算成像素 | 算好的像素值 |
| `1.5em` | 同上，算成像素 | 算好的像素值 |
| `24px` | 固定值 | 24px |

```css
.article {
  font-size: 14px;
  line-height: 1.5em; /* 算成 21px 后继承 */
}
.article h2 {
  font-size: 28px; /* 行高还是 21px，比字还矮，多行标题会挤在一起 */
}
```

改成 `line-height: 1.5`，`h2` 的行高就是 28 × 1.5 = 42px。所以全局行高写无单位数字，正文至少 1.5，对阅读和放大页面都更友好。

### vertical-align 的取值

- **相对父元素**：`baseline`（默认，基线对基线）、`middle`（元素的中点对齐父元素基线上方半个 x 高度的位置）、`text-top` / `text-bottom`（对齐父元素字体的顶部 / 底部）、`sub` / `super`、长度和百分比（相对基线上下偏移，百分比参照自身的 `line-height`）
- **相对整个行框**：`top`、`bottom`，元素的顶部 / 底部贴到行框的顶部 / 底部
- **表格单元格**：`top`、`middle`、`bottom` 控制内容在单元格里的位置，这是少数"真正的垂直居中"用法

`vertical-align` 写在块级元素上没有任何效果，它也不能让块级元素在父元素里居中，那是 Flex 和 Grid 的工作，见 [水平垂直居中](/basics/css/04-center)。

### inline-block 的基线

`inline-block` 元素的基线是它**最后一行文字**的基线；如果它里面没有文字，或者 `overflow` 不是 `visible`，基线就是它的**底部 margin 边缘**。所以两个并排的 `inline-block`，一个有文字一个没有，或者文字行数不同，就会上下错开。统一加 `vertical-align: top` 就能对齐。

## 代码示例

```html
<style>
  .box { border: 1px solid #999; }
  .box img { width: 100px; height: 60px; }

  /* 问题一：图片坐在基线上，基线下面还有支柱的下沉空间，底部多出几像素 */
  /* 解法：让图片不再按基线对齐，或者不再是行内元素 */
  .fix-a img { vertical-align: bottom; } /* 图片比行高更高时，middle、top 也行 */
  .fix-b img { display: block; }

  /* 问题二：inline-block 之间的缝隙，是标签之间的换行被渲染成了一个空格 */
  .tabs .tab { display: inline-block; padding: 8px 16px; }
  /* 解法：父元素用 flex，空白文本不再参与排版 */
  .tabs-flex { display: flex; }
</style>

<div class="box"><img src="a.png" alt="" /></div>
<div class="box fix-a"><img src="a.png" alt="" /></div>

<div class="tabs">
  <span class="tab">首页</span>
  <span class="tab">分类</span>
</div>
```

缝隙的宽度就是一个空格的宽度，随父元素字号变化。旧的做法有删掉标签之间的空白、父元素 `font-size: 0` 再给子元素恢复字号，现在直接用 Flex。

## 面试官可能追问

::: details 单行文字为什么设 line-height 等于高度就能垂直居中？
文字的行距是上下各加一半的，字形本身在行内框里垂直居中。行框高度等于 `line-height`，再让它等于容器高度，文字就在容器中间。它只适用于单行：文字一换行，每行都有这么高，容器会被撑开。另外字体的上下留白（ascent 和 descent）不一定对称，个别字体看起来会偏上或偏下一点。
:::

::: details vertical-align: middle 为什么看起来不是正中间？
它对齐的是"父元素基线往上半个 x 高度"的位置，大约是小写字母的中线，而不是行框的正中间。x 高度是按西文字母定义的，和中文字形的视觉中心不一定重合，所以图标和中文并排时常常差一两个像素，需要微调可以用长度值，比如 `vertical-align: -0.125em`。要精确居中，改用 Flex 加 `align-items: center`。
:::

::: details 一行里有个字号很大的 span，为什么整行都变高了？
行框的高度取最高的行内框。大字号的 `span` 的行内框高度是它自己的 `line-height`（无单位时随字号放大），把整行撑高了。另外大字号和小字号的文字基线对齐后，上下伸出的部分不一样，行框也会被撑开。可以给这个 `span` 单独设一个较小的 `line-height`（比如 1），缩小它的行内框。
:::

## 易错点

- `line-height` 写成 `1.5em` 或 `150%`，子元素继承的是算好的像素值，字号大的子元素行高反而不够
- 图片底部的空隙不是 margin 或 padding，而是基线对齐留出的空间，用 `vertical-align` 或 `display: block` 解决
- `vertical-align` 只对行内、`inline-block` 和表格单元格生效，写在 `div` 上不会让它垂直居中
- 内容不同的 `inline-block` 并排时上下错位，是因为各自的基线位置不同，统一 `vertical-align: top` 即可
