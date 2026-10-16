---
difficulty: 1
tags: [高频, 实践]
---

# HTML 语义化是什么？有哪些好处？

::: tip 一句话回答
语义化就是**按内容的含义选标签**，而不是按长相选：导航用 `<nav>`，主体内容用 `<main>`，能独立成篇的内容用 `<article>`，能点击执行操作的用 `<button>`。好处有三个：屏幕阅读器能按**地标和标题**快速跳转，键盘也能直接操作（可访问性）；搜索引擎更容易看懂页面结构（SEO）；代码一眼就能看出结构（可维护性）。标签的默认样式不是选择依据，样式交给 CSS。
:::

## 详细解析

### 常用的结构标签

| 标签 | 含义 | 读屏看到的地标 |
| --- | --- | --- |
| `<header>` | 页面或某个区块的头部：logo、标题、搜索框 | 作为页面头部时是 banner |
| `<nav>` | 主要的导航链接组 | navigation |
| `<main>` | 页面的主体内容，同一时间只能有一个可见的 `<main>` | main |
| `<article>` | 单独拿出来也完整的内容：博文、评论、商品卡片 | 不是地标，但会被识别为文章 |
| `<section>` | 有明确主题的一组内容，通常带标题 | 有可访问名称时是 region |
| `<aside>` | 和主内容相关、去掉也不影响理解的部分：侧栏、相关推荐 | complementary |
| `<footer>` | 页面或区块的底部：版权、联系方式 | 作为页面底部时是 contentinfo |

内容层面也有语义标签：`<h1>`～`<h6>` 表示标题层级，`<ul>`、`<ol>`、`<dl>` 表示列表，`<table>` 只用于表格数据，`<figure>` 和 `<figcaption>` 表示带说明的插图，`<time datetime="...">` 表示机器可读的时间，`<strong>` 表示重要、`<em>` 表示强调语气。

### 标题层级

- 标题描述的是文档的大纲：页面一般有一个 `<h1>` 表示主题，下面按 `<h2>`、`<h3>` 逐级展开，不要跳级
- 读屏用户很常用的浏览方式是列出所有标题，或用快捷键在标题之间跳转，层级乱了就等于目录乱了
- 级别按结构选，字号用 CSS 调。觉得 `<h2>` 太大就改样式，不要换成 `<h4>`

### 为什么要语义化

1. **可访问性**：浏览器会把标签映射成可访问性树里的角色。读屏读到 `<button>` 会说"按钮"，读到 `<nav>` 会说"导航"，用户可以直接跳到主要内容或导航区域
2. **SEO**：搜索引擎靠标题、`<main>`、`<article>` 判断页面的主题和主要内容在哪里，详见 [前端能为 SEO 做什么](/basics/html/10-seo)
3. **可维护性**：看标签就知道结构，不用靠类名猜；浏览器的阅读模式这类正文提取工具也会参考这些标签

### 用 `<div>` 写按钮的问题

```html
<!-- ❌ 看起来像按钮，但 Tab 聚焦不到，按 Enter 和 Space 没反应，读屏只读出"保存"两个字 -->
<div class="btn" onclick="save()">保存</div>

<!-- ❌ 补上角色和 tabindex 还不够，键盘事件也要自己处理 -->
<div class="btn" role="button" tabindex="0" onclick="save()">保存</div>

<!-- ✅ 原生按钮：可聚焦，Enter 和 Space 都能触发，读屏读出"保存，按钮"，disabled 也直接生效 -->
<button type="button" class="btn" onclick="save()">保存</button>
```

经验规则：**跳转用 `<a href>`，执行操作用 `<button>`**。`<a href="javascript:;">` 当按钮、`<div>` 当链接都会让键盘和读屏用户困惑。

## 代码示例

```html
<!-- ❌ div 汤：结构全靠类名 -->
<div class="header"><div class="menu">...</div></div>
<div class="content">
  <div class="title">文章标题</div>
  <div class="text">...</div>
</div>

<!-- ✅ 语义化：读屏可以直接跳到导航、主体，按标题浏览文章 -->
<header>
  <a href="/" class="logo">站点名</a>
  <nav aria-label="主导航">
    <ul>
      <li><a href="/docs">文档</a></li>
      <li><a href="/blog">博客</a></li>
    </ul>
  </nav>
</header>
<main>
  <article>
    <h1>文章标题</h1>
    <p>发布于 <time datetime="2026-10-01">10 月 1 日</time></p>
    <section>
      <h2>第一部分</h2>
      <p>...</p>
    </section>
  </article>
</main>
<aside aria-label="相关推荐">...</aside>
<footer>© 站点名</footer>
```

## 面试官可能追问

::: details `<section>` 和 `<article>` 怎么选？
看这块内容单独拿出来是否完整。博文、评论、商品卡片可以独立分发，用 `<article>`；一篇文章里按主题划分的章节用 `<section>`。两者可以互相嵌套：文章里分多个 section，"最新文章"这个 section 里放多个 article。如果只是为了加样式或做布局包一层，用 `<div>`。
:::

::: details 用了语义化标签，还需要 ARIA 吗？
大部分情况不需要，原生元素已经带有正确的角色和行为。页面上有多个 `<nav>` 时，可以用 `aria-label` 区分"主导航"和"页脚导航"。只有原生元素表达不了的组件，比如标签页、组合框，才需要用 ARIA 补充语义，见 [Web 可访问性和 ARIA](/basics/html/04-a11y-aria)。
:::

::: details 怎么检查页面的语义结构对不对？
打开 DevTools 的 Accessibility 面板，查看元素在可访问性树里的角色和名称；用 Lighthouse 或 axe 扫一遍，能发现标题跳级、按钮没有名称等问题；最直接的是打开读屏软件（macOS 自带的 VoiceOver，Windows 上免费的 NVDA），列出页面的地标和标题，看是否和预期一致。
:::

## 易错点

- `<section>` 不是 `<div>` 的语义化替代品，没有主题、只用来布局的容器应该用 `<div>`
- 不要指望"每个 section 都用 `<h1>`，浏览器会自动降级"。规范里曾经描述过这种大纲算法，但浏览器和读屏从未实现，后来已从规范中删除，标题级别要自己写对
- 给 `<div>` 加上 `role="button"` 只是改变了读屏的读法，聚焦和键盘行为还得自己补，直接用 `<button>` 最省事
- 按字号选标题级别，或者为了视觉效果用加粗的 `<div>` 代替标题，都会破坏大纲
