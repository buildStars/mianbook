---
difficulty: 1
tags: [实践, 对比]
---

# Sass、Less 这类 CSS 预处理器解决了什么问题？和 PostCSS 有什么区别？

::: tip 一句话回答
预处理器给 CSS 加上**变量、嵌套、混入（mixin）、函数、条件循环和模块化**，写的是 `.scss`、`.less` 这类扩展语法，编译成普通 CSS。**PostCSS** 不是一门语言，而是一个**用 JS 插件处理 CSS 的平台**：先把 CSS 解析成 AST，再由插件改写，典型插件是 autoprefixer 加厂商前缀、px 转 rem。现在原生 CSS 已经有变量和嵌套，预处理器的价值主要剩在**编译期的计算、mixin、循环和老项目生态**。
:::

## 详细解析

### 预处理器提供了什么

```scss
// 变量和模块
@use 'sass:color';
@use 'tokens' as t;

// 混入：可复用的一段样式，可以带参数
@mixin ellipsis($lines: 1) {
  overflow: hidden;
  @if $lines == 1 {
    white-space: nowrap;
    text-overflow: ellipsis;
  } @else {
    display: -webkit-box;
    -webkit-line-clamp: $lines;
    -webkit-box-orient: vertical;
  }
}

.card {
  padding: t.$space * 2;
  // 嵌套，& 指代父选择器
  &__title { @include ellipsis(2); }
  &:hover { color: color.adjust(t.$primary, $lightness: -10%); }
}

// 循环生成工具类
@each $size in 4, 8, 16 {
  .mt-#{$size} { margin-top: #{$size}px; }
}
```

- **变量**：统一颜色、间距
- **嵌套**：结构和 HTML 对应，少写重复的父选择器
- **mixin / 函数**：复用样式片段，做颜色计算
- **模块化**：Sass 的 `@use` 有命名空间，避免全局变量互相覆盖
- **条件和循环**：批量生成样式

Less 的能力类似，语法上变量用 `@`，mixin 直接写类名调用。

### PostCSS 是什么

```text
CSS 源码 → PostCSS 解析成 AST → 插件 1 → 插件 2 → … → 生成 CSS
```

PostCSS 本身几乎什么都不做，能力全在插件：

- **autoprefixer**：根据 browserslist 配置自动加 `-webkit-` 等前缀
- **postcss-preset-env**：把较新的 CSS 语法转成目标浏览器能识别的写法
- **px 转 rem / vw**：移动端适配常用
- Tailwind CSS 也可以作为 PostCSS 插件运行

### 两者对比

| | Sass / Less | PostCSS |
| --- | --- | --- |
| 本质 | 一门扩展了 CSS 的语言 | 处理 CSS 的工具平台 |
| 输入 | `.scss` / `.less` 语法 | 标准 CSS（也可配合插件解析其他语法） |
| 扩展方式 | 语言内置功能 | 安装 JS 插件 |
| 常见位置 | 编译的第一步 | 编译之后做兼容和转换 |

两者经常一起用：先用 Sass 编译成 CSS，再交给 PostCSS 加前缀、转单位。所以有人把 PostCSS 叫"后处理器"，但它也能做预处理的事。

### 原生 CSS 追上来之后

原生 CSS 变量是**运行时**的，能用 JS 改、能在媒体查询里覆盖，做主题切换比 Sass 变量更合适，见 [CSS 变量与主题](/basics/css/13-variables-theme)。原生嵌套也已普及，见 [现代 CSS](/basics/css/10-modern-css)。新项目只为变量和嵌套引入 Sass 的理由变弱了；需要 mixin、循环批量生成、编译期计算，或者组件库本身基于 Sass 时，它仍然有用。

## 面试官可能追问

::: details Sass 变量和 CSS 变量有什么本质区别？
Sass 变量编译后就被替换成具体值，浏览器里不存在。CSS 变量保留在样式里，浏览器运行时计算，遵循层叠和继承，可以按作用域覆盖，也能被 JS 读写。所以动态主题只能靠 CSS 变量。
:::

::: details `@import` 和 `@use` 在 Sass 里有什么区别？
Sass 的 `@import` 把所有变量和 mixin 放进全局，同一个文件被多次引入会重复输出，Sass 官方已经不推荐使用。`@use` 每个模块只加载一次，成员带命名空间访问，私有成员不会泄露。
:::

::: details 嵌套写得很深有什么问题？
编译出来的选择器又长又具体，优先级很高，后面想覆盖只能写得更具体或用 `!important`，也让匹配多做工作。一般建议嵌套不超过三层，多用 BEM 这类扁平命名。
:::

## 易错点

- 把 PostCSS 当成和 Sass 并列的"另一种预处理器"，它其实是插件平台
- 用 Sass 变量做主题切换，编译后值已固定，运行时改不了
- autoprefixer 加不加前缀取决于 browserslist 配置，不是看到属性就加
