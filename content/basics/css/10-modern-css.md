---
difficulty: 2
tags: [新特性, 实践]
---

# 现代 CSS 有哪些值得关注的新特性？

::: tip 一句话回答
这几年 CSS 补上了很多过去要靠 JS 或预处理器才能做的事：**容器查询**让组件按自身容器的宽度响应式，**`:has()`** 能根据子元素或后续兄弟选中元素，**原生嵌套**和 **`@layer`** 改善了样式组织，`aspect-ratio`、**逻辑属性**、`color-mix()` 简化了日常写法。这些特性在主流现代浏览器中均已支持，项目里使用前查一下 caniuse，需要兼容旧浏览器时用 `@supports` 做渐进增强。
:::

## 详细解析

### 容器查询 @container

媒体查询看的是**视口**，容器查询看的是**组件所在的容器**。同一个卡片组件放在宽的主栏里横排、放在窄的侧栏里竖排，不需要知道页面布局。

用法分两步：给容器声明 `container-type`，再用 `@container` 写条件。规则只作用于容器的后代，容器不能根据自己的尺寸改自己的样式。还可以用 `cqw`、`cqi` 这类单位，相对容器尺寸取值。

### :has() 父选择器

`:has()` 匹配"满足条件的后代或兄弟存在"的元素，第一次让 CSS 能根据子元素选中父元素：

- `.card:has(img)`：包含图片的卡片
- `form:has(:invalid)`：有不合法输入的表单
- `h2:has(+ p)`：后面紧跟段落的标题

它的优先级取参数里最高的那个，规则和 `:is()` 一样，见 [选择器优先级](/basics/css/03-specificity)。

### 原生嵌套与 @layer

原生 CSS 支持嵌套，`&` 代表父选择器。和 Sass 的区别是：原生 `&` 不能拼接字符串，`&__title` 这种 BEM 拼接写法不会生成 `.block__title`；`&` 的优先级按 `:is()` 计算，父选择器是 `#a, .b` 这样的列表时，嵌套规则一律按其中最高的 ID 优先级算。

`@layer` 声明层叠层，层的顺序比选择器优先级更先比较，适合把重置样式、第三方库、组件样式分层管理，细节见 [选择器优先级](/basics/css/03-specificity)。

### 日常写法的简化

| 特性 | 解决的问题 |
| --- | --- |
| `aspect-ratio: 16 / 9` | 按比例定高，不再需要 `padding-top: 56.25%` 的老技巧 |
| 逻辑属性 | `margin-inline-start`、`padding-block`、`inset-inline` 按书写方向取值，RTL 语言和竖排文字自动适配 |
| `color-mix()` | 原生混色，从品牌色派生悬停色、半透明色 |
| `gap` 用于 Flex | Flex 子项间距不再需要负 margin |
| `:is()` / `:where()` | 合并选择器列表，`:where()` 优先级为 0，适合写可覆盖的默认样式 |

### 渐进增强 @supports

`@supports` 判断浏览器是否支持某个属性值或选择器，支持时才应用增强样式。旧浏览器拿到基础样式也能用，新浏览器体验更好。

## 代码示例

```css
/* 容器查询：卡片在宽容器里横排 */
.card-wrap {
  container-type: inline-size;
  container-name: card;
}

.card { display: grid; gap: 12px; }

@container card (min-width: 420px) {
  .card { grid-template-columns: 160px 1fr; }
}

/* 原生嵌套 + :has() */
.field {
  border: 1px solid #ccc;

  &:has(input:invalid) {
    border-color: crimson;
  }

  & label {
    font-weight: 600;
  }
}

/* 混色：悬停时比品牌色深一些 */
.btn {
  --brand: #3b82f6;
  background: var(--brand);
  &:hover { background: color-mix(in srgb, var(--brand) 80%, black); }
}

/* 渐进增强：支持 :has() 时才启用 */
@supports selector(:has(a)) {
  .menu:has(.item:hover) .item:not(:hover) { opacity: 0.6; }
}
```

## 面试官可能追问

::: details 有了容器查询，还需要媒体查询吗？
需要。两者分工不同：页面级的大布局（几栏、导航是否折叠）跟视口有关，用媒体查询；可复用组件内部的排版跟它分到的空间有关，用容器查询。另外 `prefers-color-scheme`、`prefers-reduced-motion` 这类用户偏好，在 CSS 里只能用媒体查询判断。
:::

::: details 为什么容器要声明 container-type？
容器查询的条件依赖容器的尺寸，如果容器尺寸又由内容决定，内容的样式又随容器尺寸变，就会形成循环。`container-type: inline-size` 给容器加上内联方向的尺寸隔离，它的宽度不再由子元素决定，只由外部布局决定，循环就断开了。所以容器本身需要有来自外部的宽度：普通块级元素自动占满父元素没问题，但如果容器是 flex 子项、浮动或 `inline-block` 这类按内容收缩宽度的元素，又没有显式宽度，它的宽度会塌成 0。
:::

::: details 原生嵌套能完全替代 Sass 吗？
嵌套这一项基本可以，自定义属性也能替代大部分变量用法。但 Sass 的 mixin、函数、循环、`&` 拼接类名这些编译期能力，原生 CSS 没有对应写法。新项目如果只用到嵌套和变量，可以不引入预处理器。
:::

## 易错点

- 容器查询的规则只作用于容器的后代，不能用来改容器自身的样式
- 原生嵌套里 `&-active`、`&__title` 这类拼接写法不成立，这是 Sass 的语法
- 新特性的兼容性以 caniuse 和 MDN 为准，面试中不要随口报具体的浏览器版本号
