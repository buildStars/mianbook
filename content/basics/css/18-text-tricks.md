---
difficulty: 1
tags: [实践]
---

# 文本溢出省略、CSS 三角形这些常见效果怎么写？

::: tip 一句话回答
**单行省略**要三个属性一起用：`overflow: hidden`、`white-space: nowrap`、`text-overflow: ellipsis`，并且元素的宽度要受到限制。**多行省略**用 `display: -webkit-box` 加 `-webkit-box-orient: vertical`、`-webkit-line-clamp: N` 和 `overflow: hidden`，虽然带前缀，但主流浏览器都支持。省略号在 **Flex 子项**里不出现时，给子项加 **`min-width: 0`**。**三角形**可以用宽高为 0 的元素加透明边框，也可以用更直观的 `clip-path: polygon()`。渐变文字用 `background-clip: text`，固定宽高比用 `aspect-ratio`，毛玻璃用 `backdrop-filter`。
:::

## 详细解析

### 单行省略：每个属性管一件事

```css
.ellipsis {
  overflow: hidden; /* 超出的部分裁掉 */
  white-space: nowrap; /* 不换行，文字才会在水平方向溢出 */
  text-overflow: ellipsis; /* 在被裁掉的位置显示省略号 */
}
```

`text-overflow` 本身不会让文字溢出，它只决定"已经溢出的部分怎么提示"，所以前两个属性缺一不可。它作用在**块容器**上：直接写在 `span` 这类行内元素上无效，要改成 `block` 或 `inline-block` 并限制宽度。

### 多行省略：-webkit-line-clamp

```css
.clamp-2 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
```

这三个带前缀的属性必须一起出现，这种组合已经写进了规范，浏览器会长期支持。不带前缀的 `line-clamp` 还没有在所有主流浏览器里普及，目前还是写带前缀的版本。几个细节：

- 漏了 `overflow: hidden` 时，第 2 行末尾会出现省略号，但后面的文字照样显示出来
- 不要给这个元素加 `padding-bottom`：内容在 padding 区域里不会被裁掉，第 3 行的上半截会露出来，需要留白时把 padding 加在外层元素上

### Flex 子项里省略号不生效

Flex 子项的 `min-width` 默认是 `auto`，不能缩到比内容更窄。文字不换行时，内容的最小宽度就是整行文字的宽度，子项被撑开，自然没有溢出、也就没有省略号。给子项加 `min-width: 0`（或 `overflow: hidden`）即可，原理见 [Flex 布局](/basics/css/05-flex)。Grid 里 `1fr` 的列有同样的问题，改成 `minmax(0, 1fr)`。

### 三角形：border 和 clip-path

宽高为 0 的元素，四条边框在中心相交，每条边框都是一个三角形。把其中三条设成透明，就只剩一个：

```css
/* 尖朝下的三角形：宽 16px，高 8px */
.arrow-down {
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 8px solid #333; /* 只有上边框有颜色 */
}

/* clip-path：先画一个矩形，再按多边形裁剪 */
.arrow-down-2 {
  width: 16px;
  height: 8px;
  background: #333;
  clip-path: polygon(0 0, 100% 0, 50% 100%);
}
```

| | border 写法 | clip-path 写法 |
| --- | --- | --- |
| 尺寸 | 靠边框宽度推算，不直观 | 就是元素的宽高 |
| 颜色 | 只能纯色 | 可以用渐变、图片 |
| 形状 | 三角形、梯形 | 任意多边形 |
| 阴影、描边 | 难 | 也难，`box-shadow` 会被一起裁掉 |

带边框的提示气泡箭头，常见做法是用一个设了两条边框的小正方形，`transform: rotate(45deg)` 后一半藏在气泡里。

### 渐变文字、宽高比、毛玻璃

```css
/* 渐变文字：背景只画在文字形状里，文字本身透明 */
.gradient-text {
  display: inline-block; /* 渐变范围跟着文字宽度，而不是整行 */
  background: linear-gradient(90deg, #3b82f6, #a855f7);
  -webkit-background-clip: text; /* 兼容旧版浏览器 */
  background-clip: text;
  color: transparent;
}

/* 固定宽高比：只需要给宽度 */
.video {
  width: 100%;
  aspect-ratio: 16 / 9;
}

/* 毛玻璃：模糊的是元素后面的内容 */
.glass {
  background: rgb(255 255 255 / 0.6); /* 背景必须半透明，否则看不到后面的内容 */
  -webkit-backdrop-filter: blur(12px); /* 较旧的 Safari 只认带前缀的写法 */
  backdrop-filter: blur(12px);
}
```

- `aspect-ratio` 只在宽高至少有一个是 `auto` 时生效，两个都写死就被忽略。内容太多时元素会被撑高、超出比例，必须严格保持比例时加 `overflow: hidden`（或 `auto`），也可以写 `min-height: 0`，但多出的内容会溢出到盒子外面
- `backdrop-filter` 和 `filter` 一样会创建层叠上下文，还会让元素成为 `fixed` 后代的包含块，见 [position 与 z-index](/basics/css/07-position-zindex)。大面积使用在低端手机上可能掉帧

## 面试官可能追问

::: details 怎么只在文字真的被截断时显示完整内容的提示？
CSS 判断不了是否发生了截断，要用 JS 比较尺寸：单行看 `el.scrollWidth > el.clientWidth`，多行看 `el.scrollHeight > el.clientHeight`，为 true 时再设置 `title` 或显示自定义提示。窗口尺寸、字体加载完成后结果可能变化，可以在鼠标移入时再判断。
:::

::: details 表格单元格里的省略号为什么不生效？
表格默认按内容自动分配列宽，单元格会被不换行的文字撑宽，不会溢出。给表格设 `table-layout: fixed` 并指定宽度，列宽就由第一行或 `col` 决定，单元格再加上单行省略的三个属性就能生效。
:::

::: details 渐变文字有什么要注意的？
`color: transparent` 之后，如果浏览器不支持文字裁剪，文字会直接看不见，可以用 `@supports (background-clip: text)` 包住这组样式。渐变两端的颜色都要和页面背景保持足够的对比度。另外选中文字时的高亮效果也会和普通文字不一样，需要的话用 `::selection` 调整。
:::

## 易错点

- 只写了 `text-overflow: ellipsis`，没有 `overflow: hidden` 和 `white-space: nowrap`，省略号不会出现
- 在 flex 子项或 `1fr` 的 grid 列里做省略，忘了加 `min-width: 0` 或改用 `minmax(0, 1fr)`
- 多行省略的元素加了 `padding-bottom`，下一行文字露出半截
- 用 border 画三角形时没有把 `width`、`height` 设为 0，得到的是梯形或者带矩形的箭头
