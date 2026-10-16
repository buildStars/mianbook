---
difficulty: 1
tags: [高频]
---

# 引入 CSS 时 link 和 @import 有什么区别？

::: tip 一句话回答
`<link>` 是 **HTML 标签**，浏览器解析 HTML 时就能发现并**并行下载**；`@import` 是 **CSS 语法**，要等外层 CSS 下载并解析后才发现，形成**串行的请求链**，拖慢首屏。`link` 能被 JS 增删、切换 `disabled`，还能用于 favicon、预加载等；`@import` 必须写在样式表开头，可以带媒体查询，也能配合 `layer()` 把引入的样式放进层叠层。实际项目里构建工具会把 `@import` 合并打包，所以源码里写 `@import` 问题不大。
:::

## 详细解析

### 写法

```html
<link rel="stylesheet" href="/css/base.css">
<link rel="stylesheet" href="/css/print.css" media="print">
```

```css
/* 必须在其他规则之前（只能排在 @charset 和 @layer 声明之后） */
@import url('reset.css');
@import url('wide.css') screen and (min-width: 1024px);
@import url('lib.css') layer(vendor);
```

### 加载时机和性能

```text
link 方式：
  HTML ──┬── a.css
         └── b.css         两个文件同时下载

@import 方式：
  HTML ── a.css（下载、解析）── 发现 @import ── b.css
                                              ↑ 多一轮往返
```

- 浏览器的预加载扫描器能在 HTML 里提前发现 `link`，`@import` 藏在 CSS 文件里，发现得晚
- CSS 会阻塞渲染，每多一层 `@import` 就多一轮网络往返，首屏白屏时间变长
- 多层嵌套 `@import` 时问题会叠加

### 其他区别

| | link | @import |
| --- | --- | --- |
| 所属 | HTML 标签 | CSS 规则 |
| 发现时机 | 解析 HTML 时 | 下载解析外层 CSS 后 |
| 并行下载 | 可以 | 被串行在外层 CSS 之后 |
| JS 操作 | 可以增删节点、改 `href`、设 `disabled` 切换主题 | 不方便 |
| 用途 | 样式表、图标、`preload`、`prefetch` 等 | 只能引入样式 |
| 位置限制 | 写在 `<head>` 里 | 必须在样式表最前面，否则无效 |

早年还有"IE5 以下不支持 `@import`"的说法，现在已无意义。

### 配合层叠层

`@import url(x.css) layer(vendor)` 把第三方样式整体放进一个层，自己写的未分层样式优先级更高，不用和第三方比拼选择器权重。层叠层的规则见 [选择器优先级与 @layer](/basics/css/03-specificity)。

### 构建工具的处理

Vite、webpack 等工具会在构建时解析 `@import`，把被引入的内容内联到同一个文件里（或按 JS 里的 `import` 拆出 CSS 文件），最后在 HTML 里用 `link` 引入。Sass 的 `@use` 也在编译期合并。所以要避免的是**线上 CSS 文件里还保留着 `@import`**，而不是源码里写它。

## 面试官可能追问

::: details 为什么 CSS 一般放在 head 里，JS 放在 body 底部？
CSS 放 head 让浏览器尽早下载，得到样式后再绘制，避免先显示无样式内容再闪一下。JS 默认会阻塞 HTML 解析，放底部或加 `defer` 可以不挡住页面渲染。关键路径的细节见 [浏览器渲染流程](/basics/browser/01-url-to-page)。
:::

::: details 怎么非阻塞地加载不重要的 CSS？
常见做法是 `<link rel="preload" as="style" href="x.css" onload="this.rel='stylesheet'">`，下载完再转成样式表；或者先用 `media="print"` 加载，`onload` 时改回 `all`。首屏必要的关键 CSS 可以直接内联到 HTML 里。
:::

::: details 动态切换主题时，用 link 还是 CSS 变量？
少量颜色变化优先用 CSS 变量，切换只改一个属性，没有网络请求。主题差异很大、样式文件很重时，可以准备多个 `link`，通过 `disabled` 或替换 `href` 切换，但切换瞬间可能闪烁，要提前加载。
:::

## 易错点

- `@import` 写在其他规则后面会被直接忽略，不报错
- 以为 `@import` 只是"慢一点"，其实它是把并行变成串行，层数越多越慢
- 构建后的产物里通常已经没有 `@import`，讨论性能问题要分清源码和线上文件
