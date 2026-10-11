---
difficulty: 2
tags: [高频, 对比]
---

# Grid 布局怎么用？和 Flex 怎么选？

::: tip 一句话回答
Grid 是**二维布局**，在容器上同时定义行和列，再把子项放进格子里；Flex 是**一维布局**，只沿一条轴排列。Grid 的核心是 `grid-template-columns` / `grid-template-rows`，配合 **`fr`、`repeat()`、`minmax()`、`auto-fill` / `auto-fit`**，一行代码就能写出自适应的卡片列表。选择上：**内容决定布局、单方向排列用 Flex；先有整体框架、需要行列对齐用 Grid**，两者经常嵌套使用。
:::

## 详细解析

### 基本概念和单位

```css
.grid {
  display: grid;
  grid-template-columns: 200px 1fr 2fr; /* 三列：固定 200px，剩下的按 1:2 分 */
  grid-template-rows: 60px auto;
  gap: 16px; /* 行列间距 */
}
```

- **`fr`**：按比例分配**剩余空间**，先扣掉固定尺寸和间距再分
- **`repeat(n, 轨道)`**：重复，`repeat(4, 1fr)` 就是四等分
- **`minmax(min, max)`**：轨道尺寸在一个范围内，比如 `minmax(200px, 1fr)` 至少 200px，有空间就伸展
- 子项用 `grid-column: 1 / 3`（从第 1 条线到第 3 条线）或 `grid-column: span 2` 跨列

### auto-fill 和 auto-fit

两者都是"能放几列就放几列"，用在 `repeat()` 的第一个参数：

```css
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}
```

这就是常说的**一行代码响应式卡片列表**：容器变窄，每行列数自动减少，不用写媒体查询。

区别只在**子项数量不足以填满一行**时才看得出来：

| | `auto-fill` | `auto-fit` |
| --- | --- | --- |
| 空出的轨道 | 保留，占着位置 | 折叠为 0 |
| 3 个卡片放在能容纳 5 列的容器里 | 卡片保持单列宽度，右边留空 | 3 个卡片拉伸占满整行 |

希望卡片宽度稳定用 `auto-fill`，希望少量卡片铺满用 `auto-fit`。

### grid-template-areas

用"画图"的方式定义区域，适合页面骨架：

```css
.layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  grid-template-rows: 60px 1fr 40px;
  grid-template-areas:
    "header header"
    "aside  main"
    "footer footer";
  min-height: 100vh;
}
.header { grid-area: header; }
.aside { grid-area: aside; }
.main { grid-area: main; }
.footer { grid-area: footer; }

/* 窄屏时只改区域排布，HTML 不用动 */
@media (max-width: 768px) {
  .layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
    grid-template-areas: "header" "main" "aside" "footer";
  }
}
```

每一行的列数必须一致，区域必须是矩形，空格子用 `.` 表示。

### 显式网格和隐式网格

`grid-template-*` 定义的是**显式网格**。子项多于格子数时，浏览器会自动加行（或列），这部分叫**隐式网格**，尺寸由 `grid-auto-rows` / `grid-auto-columns` 控制，默认是 `auto`。`grid-auto-flow` 决定自动放置的方向，加上 `dense` 会回头填补前面留下的空洞，但视觉顺序可能和 DOM 顺序不一致。

### Grid 和 Flex 怎么选

| | Flex | Grid |
| --- | --- | --- |
| 维度 | 一维，一行或一列 | 二维，行列同时控制 |
| 思路 | 内容优先，子项尺寸决定布局 | 布局优先，先画格子再放内容 |
| 换行后对齐 | 每行独立，上下行列不对齐 | 行列天然对齐 |
| 典型场景 | 导航栏、按钮组、工具条、居中 | 页面骨架、卡片列表、仪表盘、表单 |

常见做法是外层用 Grid 搭骨架，组件内部用 Flex 排列。

## 面试官可能追问

::: details 1fr 一定是等分吗？
不一定。`1fr` 实际是 `minmax(auto, 1fr)`，最小值是内容的最小尺寸。某一列有长单词或宽图片时，这一列会比别的列宽。想强制等分，写成 `repeat(3, minmax(0, 1fr))`。
:::

::: details subgrid 是什么？
嵌套的 Grid 默认和父网格无关，各算各的轨道。给子网格写 `grid-template-columns: subgrid`，它就直接沿用父网格的列线，适合卡片里的标题、正文、按钮跨卡片对齐。主流现代浏览器已经支持，项目要兼容老浏览器时先查 caniuse。
:::

::: details Grid 子项的居中和对齐怎么写？
`justify-items` / `align-items` 在容器上统一控制子项在格子内的对齐，`place-items` 是两者的简写；`justify-self` / `align-self` 单独控制某个子项。`justify-content` / `align-content` 则是整个网格在容器里的对齐，网格总尺寸小于容器时才有效果。居中写法见 [水平垂直居中](/basics/css/04-center)。
:::

## 易错点

- `auto-fill` 和 `auto-fit` 只有在子项不够填满一行时才有区别
- `grid-column: 1 / 3` 指的是网格线编号，跨的是 2 列，不是 3 列
- `1fr` 有内容最小尺寸的下限，等分要用 `minmax(0, 1fr)`
