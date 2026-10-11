---
difficulty: 2
tags: [高频, 实践]
---

# 两栏、三栏布局怎么实现？圣杯布局和双飞翼布局是什么？

::: tip 一句话回答
两栏布局（一侧定宽、一侧自适应）可以用 **float + BFC**、**flex**（自适应栏 `flex: 1`）或 **grid**（`grid-template-columns: 200px 1fr`）。三栏中间自适应同理。**圣杯布局**和**双飞翼布局**是 flex 普及之前用 float + 负 margin 实现三栏的经典方案，共同目标是**中间栏写在 HTML 最前面、优先渲染**；区别在于圣杯靠**容器 padding + 相对定位**给两侧留位置，双飞翼靠**中间栏内层 div 的 margin**。现在直接用 flex 或 grid 即可。
:::

## 详细解析

### 两栏布局

```css
/* 方案一：float + BFC */
.aside { float: left; width: 200px; }
.main { display: flow-root; } /* 创建 BFC，不与浮动元素重叠，宽度自动占满剩余 */

/* 方案二：flex */
.wrap { display: flex; }
.aside { width: 200px; flex: none; }
.main { flex: 1; min-width: 0; }

/* 方案三：grid */
.wrap { display: grid; grid-template-columns: 200px 1fr; }
```

方案一的原理是"BFC 区域不会和浮动元素重叠"，见 [BFC](/basics/css/02-bfc)。

### 三栏布局：中间自适应

```css
/* HTML 顺序是 main、left、right */
.wrap { display: flex; }
.main { flex: 1; min-width: 0; }
.left { width: 200px; order: -1; } /* 视觉上排到最左边 */
.right { width: 150px; }

/* 或者 grid：用 grid-column 指定位置，和 HTML 顺序无关 */
.wrap { display: grid; grid-template-columns: 200px 1fr 150px; }
.main { grid-column: 2; grid-row: 1; }
.left { grid-column: 1; grid-row: 1; }
/* .right 不写位置：自动放置会跳过已被占用的格子，落到第 1 行第 3 列 */
```

flex 和 grid 都能改变视觉顺序，所以 HTML 里中间栏写在最前面也没问题。

### 圣杯布局

HTML 顺序是 main、left、right，三者都左浮动：

```css
.container { padding: 0 150px 0 200px; } /* 两侧留出左右栏的位置 */
.container > div { float: left; }
.main { width: 100%; }
.left {
  width: 200px;
  margin-left: -100%; /* 拉回到上一行，和 main 左边对齐 */
  position: relative;
  left: -200px; /* 再挪进容器左侧的 padding */
}
.right {
  width: 150px;
  margin-right: -150px; /* 占位宽度变 0，挤上第一行，显示在右侧 padding 里 */
}
```

### 双飞翼布局

在圣杯的基础上去掉了相对定位，给中间栏多套一层：

```html
<div class="main"><div class="main-inner">内容</div></div>
<div class="left"></div>
<div class="right"></div>
```

```css
.main, .left, .right { float: left; }
.main { width: 100%; }
.main-inner { margin: 0 150px 0 200px; } /* 内层留出两侧的位置 */
.left { width: 200px; margin-left: -100%; }
.right { width: 150px; margin-left: -150px; }
```

### 两者的差异和历史背景

| | 圣杯 | 双飞翼 |
| --- | --- | --- |
| 两侧留空 | 外层容器的 padding | 中间栏内层元素的 margin |
| 左右栏定位 | 负 margin + `position: relative` | 只用负 margin |
| 额外 DOM | 无 | 中间栏多一层 |
| 缺点 | 容器很窄时布局会错乱，需要设最小宽度 | 多一层嵌套 |

这两种方案出现在只能靠 float 布局的年代。中间栏写在前面，是为了让主要内容在 HTML 里先出现，先解析、先渲染，也对搜索引擎更友好。负 margin 是让后面的浮动元素"爬"回第一行的关键。现在 flex 和 grid 可以随意调整视觉顺序，不再需要这些技巧，面试问到主要考的是对浮动和负 margin 的理解。

### 粘性页脚（sticky footer）

内容少时页脚贴在视口底部，内容多时被正常推到下面：

```css
/* flex 写法 */
body { min-height: 100vh; display: flex; flex-direction: column; margin: 0; }
main { flex: 1; }

/* grid 写法：header、main、footer 三行 */
body { min-height: 100vh; display: grid; grid-template-rows: auto 1fr auto; margin: 0; }
```

这和 `position: sticky` 无关，后者见 [position 与 z-index](/basics/css/07-position-zindex)。

## 面试官可能追问

::: details 圣杯布局里 margin-left: -100% 的百分比相对谁？
相对包含块的宽度，也就是 `.container` 的内容区宽度，正好等于 `.main` 的宽度。左栏向左移动这么多后，就从第二行回到第一行的最左边，和 main 的左边缘对齐，再靠相对定位挪到 padding 区。
:::

::: details 等高三栏怎么做？
flex 和 grid 默认就是等高的：flex 的 `align-items` 默认是 `stretch`，grid 同一行的格子高度一致。float 时代要靠"大 padding-bottom + 等量负 margin-bottom + 父元素 overflow: hidden"或者 `display: table-cell` 模拟，现在没必要再用。
:::

::: details 移动端要怎么调整三栏布局？
窄屏时一般改成上下堆叠，用媒体查询把 flex 改成 `flex-direction: column`，或者把 grid 的列改成一列，再用 `order` / `grid-template-areas` 决定先显示哪一栏。grid 的写法见 [Grid 布局](/basics/css/06-grid)。
:::

## 易错点

- 圣杯和双飞翼的目的都是"中间栏优先渲染"，不只是"实现三栏"
- float + BFC 的两栏方案里，自适应栏不能设宽度，否则就不会自动占满剩余空间
- flex 的自适应栏记得加 `min-width: 0`，否则长内容会把布局撑破
