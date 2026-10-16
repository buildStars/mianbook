---
difficulty: 2
tags: [新特性]
---

# 容器查询是什么？和媒体查询有什么区别？

::: tip 一句话回答
媒体查询根据**视口**的尺寸和特性改样式，容器查询根据**父级容器**的尺寸改样式。同一个卡片组件放在宽的主栏里横排，放进窄的侧栏里自动竖排，组件不需要知道自己被放在页面的哪里。用法分两步：给容器声明 **`container-type: inline-size`**（可以再用 `container-name` 起名），再用 **`@container (width > 400px)`** 给容器的**后代**写样式；尺寸还可以用 **`cqi`、`cqw`** 这类相对容器的单位。容器不能根据自己的尺寸改自己的样式，并且声明后它在该方向上**不再由内容撑开**，尺寸要来自外部。现代主流浏览器已支持。
:::

## 详细解析

### 和媒体查询的区别

| | 媒体查询 `@media` | 容器查询 `@container` |
| --- | --- | --- |
| 参照物 | 视口，以及设备和用户偏好 | 最近的查询容器的内容区 |
| 适合 | 页面级布局：几栏、导航是否折叠 | 可复用组件的内部排版 |
| 能查询的条件 | 宽高、方向、`prefers-color-scheme`、`hover` 等 | `width`、`inline-size`；`height`、`aspect-ratio`、`orientation` 等需要 `size` 类型；另有样式查询 |
| 前提 | 无 | 祖先上要声明 `container-type` |

两者不是替代关系：用户偏好只能用媒体查询判断，组件内部的响应式交给容器查询更合适。基础概念在 [现代 CSS 新特性](/basics/css/10-modern-css) 里提过，这里展开语法和坑。

### 声明容器

```css
.sidebar {
  container-type: inline-size; /* 只按内联方向（横排文字时就是宽度）查询 */
  container-name: sidebar;
}

/* 简写：名字 / 类型 */
.main {
  container: main / inline-size;
}
```

| `container-type` | 能查询 | 副作用 |
| --- | --- | --- |
| `inline-size` | 宽度方向 | 宽度不再由子元素决定 |
| `size` | 宽度和高度 | 宽高都不再由子元素决定，没有明确高度时会塌成 0 |
| `normal`（默认） | 不能做尺寸查询 | 无，仍可用于样式查询 |

绝大多数场景用 `inline-size`。`size` 只在容器有明确高度时才用，比如固定高度的面板。

### 写查询条件

```css
/* 不写名字：找最近的、container-type 能满足这个条件的祖先 */
@container (width > 400px) { /* … */ }

/* 写名字：只匹配叫 sidebar 的容器 */
@container sidebar (400px <= width < 700px) { /* … */ }

/* 取反；and、or 组合的写法和媒体查询一样 */
@container not (width > 400px) { /* … */ }
```

- 规则只作用于容器的**后代**，容器自己的样式不会因为自己的查询改变
- 比较的是容器的**内容区**尺寸，不包括 padding 和边框
- 组件嵌套在多层容器里时，不写名字只会命中最近的那个，跨层查询要靠名字

### 容器查询单位

| 单位 | 含义 |
| --- | --- |
| `cqw` / `cqh` | 容器宽度 / 高度的 1% |
| `cqi` / `cqb` | 容器内联方向 / 块方向尺寸的 1% |
| `cqmin` / `cqmax` | `cqi` 和 `cqb` 中较小 / 较大的那个 |

找不到合适的容器时，这些单位按小视口单位（`svw`、`svh` 等）计算。横排文字时 `cqi` 等于 `cqw`，推荐用 `cqi`，竖排文字时也能正确工作。标题字号可以写成 `clamp(1rem, 4cqi, 1.5rem)`，随卡片宽度变化，`clamp` 的用法见 [响应式单位](/basics/css/09-responsive-units)。

## 代码示例

卡片在窄容器里上下排列，容器宽度超过 420px 时改成左图右文：

```html
<style>
  .card-wrap {
    container: card / inline-size;
  }
  .card {
    display: grid;
    gap: 12px;
  }
  .card img {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
  }
  .card h3 {
    font-size: clamp(1rem, 4cqi, 1.5rem); /* 跟着容器宽度变化 */
  }

  @container card (width > 420px) {
    .card {
      grid-template-columns: 160px 1fr;
      align-items: start;
    }
    .card img {
      aspect-ratio: 1;
    }
  }
</style>

<!-- 同一个组件，放在主栏和侧栏里各自适配 -->
<main class="card-wrap"><article class="card">…</article></main>
<aside class="card-wrap"><article class="card">…</article></aside>
```

这里用了外层 `.card-wrap` 作为容器，而不是把 `.card` 自己设成容器，因为 `.card` 要根据宽度改变自己的 `grid-template-columns`。

## 面试官可能追问

::: details 为什么容器不能根据自己的尺寸改自己的样式？
会形成循环：容器的尺寸决定查询结果，查询结果又改变容器的样式和尺寸，尺寸变了查询结果可能又翻转回去。所以规范让 `container-type` 给容器加上尺寸隔离，它的尺寸只由外部决定，查询里的样式只作用于后代。要改"组件根元素"的布局，就像上面的例子一样多包一层作为容器。
:::

::: details 设置了 container-type 后元素宽度变成 0 了，怎么回事？
`inline-size` 隔离后，元素的宽度不再参考子元素。普通块级元素会自动占满父元素，没有问题；但如果容器是 flex 子项、浮动元素、`inline-block` 或绝对定位元素，它的宽度原本是按内容收缩的，现在内容不算数了，宽度就塌成 0。解决办法是给它明确的宽度或 `flex: 1`，或者把容器设在外层的块级元素上。`size` 类型同理，高度也会塌掉。
:::

::: details 样式查询是什么？
`@container style(--variant: compact)` 根据容器的**计算样式**来匹配，目前浏览器只支持查询自定义属性，查询普通属性还没有实现：父组件设置一个 CSS 变量，子元素按变量值切换整组样式，比如主题、密度。它不需要声明 `container-type`，默认值 `normal` 就能用于样式查询。支持它的浏览器版本比尺寸查询新，需要兼容旧浏览器时先查一下 caniuse。
:::

::: details 不支持容器查询的浏览器怎么办？
把默认样式写成窄屏的样子（通常也是移动端的样子），容器查询里只放"变宽之后"的增强样式。不支持的浏览器只是一直显示窄版布局，功能不受影响。需要更精细的控制时，可以用 `@supports (container-type: inline-size)` 区分。
:::

## 易错点

- 在 `@container` 里写容器自身的选择器，期望改变容器的布局，结果不生效
- 用 `container-type: size` 却没有给容器明确高度，容器高度塌成 0
- 容器是 flex 子项或 `inline-block`，声明 `inline-size` 后宽度塌成 0
- 不写容器名时命中的是最近的查询容器，组件嵌套在别的容器里时可能查到错误的那一层
