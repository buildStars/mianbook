---
difficulty: 2
tags: [高频, 原理]
---

# Flex 布局的核心属性有哪些？flex: 1 是什么意思？

::: tip 一句话回答
Flex 是**一维布局**，沿主轴排列子项，交叉轴负责对齐。容器上用 `flex-direction`、`justify-content`、`align-items`、`flex-wrap`、`gap`；子项上用 `flex-grow`、`flex-shrink`、`flex-basis`（合写为 `flex`）、`align-self`、`order`。**`flex: 1` 等于 `flex: 1 1 0%`**：初始尺寸当作 0，所有空间按比例分，所以几个 `flex: 1` 的子项通常一样宽；**`flex: auto` 是 `1 1 auto`**，先按内容尺寸放，再分剩余空间。
:::

## 详细解析

### 主轴和交叉轴

`flex-direction: row`（默认）时主轴是水平方向，交叉轴是垂直方向；设成 `column` 后反过来。`justify-content` 永远管主轴，`align-items` 永远管交叉轴，方向一变，两者控制的方向也跟着变。

### 容器属性和子项属性

| 容器属性 | 作用 |
| --- | --- |
| `flex-direction` | 主轴方向：`row`、`column` 及其反向 |
| `flex-wrap` | 是否换行，默认 `nowrap` |
| `justify-content` | 主轴对齐：`flex-start`、`center`、`space-between`、`space-around`、`space-evenly` |
| `align-items` | 交叉轴对齐，默认 `stretch`（子项没设高度时拉满） |
| `align-content` | 多行时各行在交叉轴上的分布；`flex-wrap: nowrap` 的单行容器上无效 |
| `gap` | 子项之间的间距，不会在首尾多出空白 |

| 子项属性 | 作用 |
| --- | --- |
| `flex-grow` | 有剩余空间时按比例放大，默认 0 |
| `flex-shrink` | 空间不足时按比例缩小，默认 1 |
| `flex-basis` | 分配空间前的初始尺寸，默认 `auto`（取 `width` 或内容尺寸） |
| `align-self` | 单独覆盖 `align-items` |
| `order` | 视觉顺序，默认 0，越小越靠前 |

### 剩余空间怎么分

**放大**：容器宽 600px，三个子项 `flex-basis` 都是 100px，`flex-grow` 分别是 1、2、3。剩余空间 600 - 300 = 300px，按 1:2:3 分成 50、100、150，最终宽度是 **150、200、250px**。

**缩小**：缩小量按 `flex-shrink × flex-basis` 加权，避免小元素被缩没。假设子项里内容很少，不受下面说的 `min-width: auto` 限制：容器宽 300px，两个子项 `flex-basis` 是 200px 和 400px，`flex-shrink` 都是 1。溢出 600 - 300 = 300px，权重 200 : 400 = 1 : 2，分别缩小 100px 和 200px，最终是 **100、200px**。

### flex 简写的几个常用值

| 写法 | 等价于 | 效果 |
| --- | --- | --- |
| `flex: initial`（默认） | `0 1 auto` | 不放大，可缩小，按内容尺寸 |
| `flex: 1` | `1 1 0%` | 忽略内容尺寸，按比例平分全部空间 |
| `flex: auto` | `1 1 auto` | 先按内容尺寸，再平分剩余空间 |
| `flex: none` | `0 0 auto` | 不放大不缩小，固定为内容尺寸 |

规范里 `flex: 1` 的 basis 写作 `0`，浏览器的计算值显示为 `0%`，效果相同。三个 `flex: 1` 的按钮，只要文字没有超过平分后的宽度，长短不同也一样宽；换成 `flex: auto`，文字长的按钮会更宽。

### min-width: auto 的坑

flex 子项的 `min-width` 默认是 `auto`，表示**不能缩得比内容的最小尺寸还小**。所以子项里有长单词、长链接、不换行的文本或宽表格时，即使设了 `flex: 1` 也不会收缩，直接把容器撑破，`text-overflow: ellipsis` 也不生效。解决办法是给子项设 `min-width: 0`（纵向布局时是 `min-height: 0`），或者 `overflow: hidden`。

## 代码示例

```html
<style>
  .row {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .avatar {
    flex: none; /* 头像固定尺寸，不被挤压 */
    width: 40px;
    height: 40px;
  }
  .content {
    flex: 1;
    min-width: 0; /* 关键：允许收缩到比文字内容更窄 */
  }
  .title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>

<div class="row">
  <img class="avatar" src="avatar.png" alt="" />
  <div class="content">
    <div class="title">一段很长很长、会超出容器宽度的标题文字</div>
  </div>
  <button>关注</button>
</div>
```

## 面试官可能追问

::: details flex-basis 和 width 同时设置，听谁的？
`flex-basis` 不是 `auto` 时优先于 `width`（纵向时是 `height`）。`flex-basis: auto` 才会去读 `width`，`width` 也是 `auto` 时按内容尺寸。不过最终尺寸仍然受 `min-width`、`max-width` 限制。
:::

::: details justify-content 里 space-between、space-around、space-evenly 有什么区别？
`space-between` 首尾贴边，中间间距相等；`space-around` 每个子项两侧的空白相等，所以首尾的空白是中间的一半；`space-evenly` 所有间隔（包括首尾）完全相等。
:::

::: details flex 布局下子项设 float 或 vertical-align 有用吗？
没用。flex 子项的 `float`、`clear`、`vertical-align` 都不生效。对齐要用 `align-items`、`align-self`，或者在子项上用 `margin: auto` 吸收剩余空间，比如 `margin-left: auto` 把最后一个按钮推到最右边。
:::

## 易错点

- `flex: 1` 的 basis 是 0，不是 `auto`，所以和 `flex: auto` 的分配结果不一样
- 子项内容不收缩、省略号不出现时，多半是缺了 `min-width: 0`
- `flex-shrink` 按 `shrink × basis` 加权，不是简单按 shrink 比例分；某个子项缩到内容最小尺寸后会被卡住，剩下的溢出量由其他子项承担
