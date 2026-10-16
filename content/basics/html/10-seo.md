---
difficulty: 2
tags: [实践, 场景题]
---

# 前端能为 SEO 做什么？单页应用怎么做 SEO？

::: tip 一句话回答
前端能做的 SEO，核心是**让搜索引擎拿得到、看得懂页面内容**：服务端返回的 HTML 里就要有正文（服务端渲染、静态生成或预渲染）；每个页面有自己的 `title`、`description` 和 `canonical`；用语义化标签和清晰的标题层级；用 JSON-LD 提供结构化数据；配好 `sitemap.xml` 和 `robots.txt`；链接用真正的 `<a href>`；保证页面性能和移动端体验。单页应用的问题在于**首次返回的 HTML 几乎是空的**，内容、路由和元信息都靠 JS 生成，常见方案是改成 SSR 或 SSG，或者对需要收录的页面做预渲染。这些只能让页面被正确收录和理解，排名还取决于内容质量等很多因素，不能承诺效果。
:::

## 详细解析

### 搜索引擎怎么处理页面

以 Google 为例，分为抓取、渲染、索引三个阶段。返回 200 的页面会进入渲染队列，JS 可能要排队一段时间后才执行。而且不是所有爬虫都会执行 JS，社交平台生成分享卡片的抓取程序大多不执行。所以**关键内容和元信息最好直接出现在服务端返回的 HTML 里**。

### 让内容出现在 HTML 里

| 方式 | 首次 HTML 里有没有内容 | 适合 |
| --- | --- | --- |
| 客户端渲染（CSR） | 没有，只有一个挂载点 | 后台系统、登录后才能看的页面 |
| 服务端渲染（SSR） | 有，每次请求时生成 | 内容经常变化的详情页、列表页 |
| 静态生成（SSG） | 有，构建时生成 | 文档、博客、营销页 |
| 预渲染 | 有，构建时用无头浏览器把指定路由渲染成 HTML | 已有的单页应用，只有少量页面需要收录 |

各种渲染模式的取舍见 [CSR、SSR、SSG、ISR 的区别](/basics/ssr/01-rendering-modes)。只给爬虫返回渲染好的页面（动态渲染）曾被当作变通办法，Google 已经说明它不是长期方案，推荐服务端渲染或静态生成。

### 页面元信息

- **`<title>` 和 description**：每个页面单独设置，准确描述页面内容；所有页面共用一套等于没写。常用 meta 见 [常用的 meta 标签](/basics/html/03-meta)
- **canonical**：同一内容有多个 URL 时（带追踪参数、排序参数，带不带结尾斜杠），用 `<link rel="canonical" href="完整地址">` 指定首选的那个，避免权重分散
- **robots meta**：搜索结果页、个人中心这类不需要收录的页面加 `noindex`
- **多语言**：不同语言版本之间用 `hreflang` 互相标注

### 语义化和链接

- 用 `<main>`、`<article>`、标题层级表达结构，页面主题放在 `<h1>` 里，见 [HTML 语义化](/basics/html/01-semantic)
- 有意义的图片写 `alt`，链接文字要说明目标，不要全是"点击这里"
- 爬虫通过 `<a href>` 发现新页面。只靠 `onclick` 里调用 `router.push()` 跳转的元素，爬虫找不到它指向的页面
- 单页应用用 History 路由（`/products/1`），不要用 `#/products/1` 这种 hash 路由承载需要收录的内容

### 结构化数据

用 JSON-LD 按 schema.org 的词汇描述页面是什么，搜索引擎可能据此展示富结果（评分、价格、面包屑等），但不保证一定展示。写完用 Google 的富结果测试工具检查。

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "降噪耳机",
  "image": "https://example.com/images/headphone.jpg",
  "offers": { "@type": "Offer", "price": "999.00", "priceCurrency": "CNY" }
}
</script>
```

### sitemap 和 robots.txt

```text
# https://example.com/robots.txt
User-agent: *
Disallow: /admin/
Sitemap: https://example.com/sitemap.xml
```

- `sitemap.xml` 列出希望被收录的规范 URL，可以带上 `lastmod`，在搜索引擎的站长平台提交
- `robots.txt` 控制的是**抓取**，不是收录：被 `Disallow` 的页面如果有外链，仍然可能出现在搜索结果里。不想被收录要用 `noindex`，而且这个页面不能被 robots.txt 屏蔽，否则爬虫读不到 `noindex`

### 性能和移动端

Google 主要用页面的移动版来建立索引，移动端的内容要和桌面端一致，不能缩水。加载速度和 Core Web Vitals 是页面体验的一部分，见 [Core Web Vitals](/basics/browser/09-web-vitals)。

### 单页应用的问题和对策

| 问题 | 对策 |
| --- | --- |
| 首次 HTML 只有挂载点 | 需要收录的路由改成 SSR、SSG 或预渲染，后台部分保留 CSR |
| 每个路由的 title、meta 靠 JS 设置 | 路由切换时更新，例如用框架的 head 管理工具；分享卡片需要的 meta 必须由服务端输出 |
| 不存在的页面也返回 200（软 404） | 服务端对不存在的资源返回 404；纯客户端渲染时跳到一个返回 404 的地址，或者加 `noindex` |
| 内容依赖接口，接口慢或失败时页面是空的 | 服务端渲染时把数据一起输出；接口失败要有降级内容 |

## 面试官可能追问

::: details Google 已经能执行 JS 了，为什么还要做 SSR？
Google 的渲染要排队，新内容被收录得更慢；其他搜索引擎和社交平台的抓取程序不一定执行 JS；JS 执行失败、接口超时时，爬虫看到的就是空页面。SSR 还能让用户更早看到首屏内容。所以对内容型页面，SSR 或 SSG 仍然是更稳妥的选择。
:::

::: details 怎么查看搜索引擎实际看到的页面？
看服务端返回的原始 HTML（"查看网页源代码"或 `curl`），而不是 DevTools 里 JS 执行后的 DOM；用 Search Console 的网址检查工具，可以看到 Google 抓取和渲染后的结果；结构化数据用富结果测试工具检查。
:::

::: details 用 JS 设置 noindex 或 canonical 可靠吗？
不太可靠。Google 的文档提到，原始 HTML 里有 `noindex` 时它可能直接跳过渲染，之后用 JS 去掉也没用；canonical 最好直接写在 HTML 里，用 JS 设置时要保证只有一个，并且和原始 HTML 里的不冲突。
:::

## 易错点

- 把 `robots.txt` 的 `Disallow` 当成禁止收录，实际它只禁止抓取
- 用 `<div onclick>` 或按钮做页面跳转，爬虫发现不了链接，应该用 `<a href>`
- 所有页面共用同一个 title 和 description，或者还在花精力维护 `keywords` meta
- 向业务方承诺"做完 SEO 就能排到第一页"，前端优化只能保证页面被正确收录和理解
