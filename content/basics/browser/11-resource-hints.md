---
difficulty: 2
tags: [性能优化]
---

# preload、prefetch、preconnect 有什么区别？

::: tip 一句话回答
它们都通过 `<link rel="...">` 提前给浏览器提示。**preconnect** 提前建立连接（DNS、TCP、TLS），适合马上要用的第三方源；**preload** 提前下载**当前页面**马上要用的关键资源，比如首屏字体、LCP 图片，优先级由 `as` 的类型决定；**prefetch** 在浏览器空闲时以最低优先级下载**下一个页面**可能用到的资源。
:::

## 详细解析

### 几种资源提示

这些提示都写成 `<link rel="...">` 标签，也可以通过 HTTP 的 `Link` 响应头下发。

- **dns-prefetch**：只提前完成 DNS 解析，开销很小
- **preconnect**：提前完成 DNS 解析、TCP 握手和 TLS 握手，适合马上就会请求的第三方源（字体、CDN、接口）。数量不宜多，建立的连接如果一段时间不用会被关闭
- **preload**：让浏览器尽早发现并下载当前页面马上要用的关键资源，只下载、不执行
  - 必须写 `as` 属性（`style`、`script`、`font`、`image` 等），浏览器据此确定优先级和请求方式；缺了或写错，可能导致资源被重复下载
  - 预加载字体还要加 `crossorigin`，因为字体总是以 CORS 方式请求
  - 资源在页面加载后几秒内没有被使用，Chrome 控制台会给出警告，等于浪费了带宽
- **prefetch**：在浏览器空闲时以最低优先级下载"下一个页面可能会用到"的资源，放进 HTTP 缓存
- **modulepreload**：专门用来预加载 ES 模块，下载后还会提前解析

```html
<!-- 马上要用的第三方源：提前建立连接；字体以 CORS 方式请求，要加 crossorigin -->
<link rel="preconnect" href="https://fonts.example.com" crossorigin>
<!-- 可能用到的第三方域名：只做 DNS 解析 -->
<link rel="dns-prefetch" href="https://analytics.example.com">

<!-- 当前页面的关键资源：首屏字体 -->
<link rel="preload" href="/fonts/main.woff2" as="font" type="font/woff2" crossorigin>
<!-- LCP 图片写在 CSS 背景里，HTML 解析时发现不了，需要 preload -->
<link rel="preload" href="/img/hero.webp" as="image" fetchpriority="high">

<!-- 下一个页面可能用到的资源 -->
<link rel="prefetch" href="/assets/detail.js">
```

同样的提示也可以写在响应头里：

```text
Link: </fonts/main.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin
```

### 对比

| | dns-prefetch | preconnect | preload | prefetch |
| --- | --- | --- | --- | --- |
| 作用 | 提前解析 DNS | 提前建立连接 | 下载当前页面的关键资源 | 下载未来页面可能用到的资源 |
| 时机 | 立即 | 立即 | 立即 | 浏览器空闲时 |
| 优先级 | 不涉及 | 不涉及 | 由 `as` 的类型决定，如样式、字体较高，图片默认较低 | 最低 |
| 强制性 | 提示 | 提示 | 强制，浏览器会立即下载（`type`、`media` 不匹配时跳过） | 提示，浏览器可以不执行 |
| 典型用途 | 可能用到的第三方域名 | 马上要请求的字体、CDN、接口域名 | 首屏字体、关键 CSS/JS、LCP 图片 | 下一个页面的 JS、CSS |

### fetchpriority

`fetchpriority` 属性可以调整单个资源的加载优先级，取值 `high`、`low`、`auto`，可以用在 `<img>`、`<link>`、`<script>` 等元素上。常见用法是给 LCP 图片加 `fetchpriority="high"`，给轮播图里暂时看不到的图片加 `fetchpriority="low"`。

preload 解决的是资源"发现得晚"，本身不提高优先级；fetchpriority 解决的是"优先级不对"。两者可以配合使用，比如上面 LCP 图片的 preload 就加了 `fetchpriority="high"`。

### 构建工具中的用法

webpack 可以在动态 `import()` 中用魔法注释生成资源提示：

```js
button.addEventListener('click', async () => {
  // 父代码块加载完后插入 prefetch，空闲时提前下载；用户点击时通常可以直接用上缓存
  const { openLoginModal } = await import(/* webpackPrefetch: true */ './login-modal.js')
  openLoginModal()
})

// webpackPreload：和父代码块并行加载，用于当前页面马上要用的模块
import(/* webpackPreload: true */ './chart.js')
```

Vite 不需要手动配置：构建时会为入口依赖的代码块生成 `modulepreload`，执行动态导入时也会并行预加载它依赖的公共代码块。

## 面试官可能追问

::: details preload 和 prefetch 怎么区分？
看资源给谁用：**当前页面马上要用**的用 preload，**未来页面可能要用**的用 prefetch。preload 是强制的，浏览器会立即下载，用错了会和当前页面的关键资源抢带宽；prefetch 优先级最低，只是提示，用它加载当前页面的关键资源又太晚了。
:::

::: details prefetch 的资源到下一个页面一定能用上吗？
不一定。预取的资源放在 HTTP 缓存里，下一个页面能不能用上，要看它的缓存策略是否允许复用；用户也可能根本不去那个页面，这次下载就浪费了流量。所以只预取访问概率高的资源，带 hash、可以长期缓存的静态资源最合适。
:::

::: details Speculation Rules API 是什么？
一种声明式的方案：用 JSON 规则告诉浏览器哪些链接可以提前预取，甚至在后台预渲染整个页面。预渲染的页面在用户点击后几乎可以立即显示。目前主要是 Chromium 内核的浏览器支持。

```html
<script type="speculationrules">
{
  "prerender": [
    { "source": "document", "where": { "href_matches": "/product/*" }, "eagerness": "moderate" }
  ]
}
</script>
```

预渲染会提前执行页面的 JS，统计、广告等脚本可以通过 `document.prerendering` 判断，等页面真正被打开后再执行。
:::

## 易错点

- preload 字体时忘了加 `crossorigin`，字体会被下载两次
- preload 不是越多越好，只预加载当前页面马上要用的少数关键资源，否则会互相抢占带宽
- preconnect 只建立连接、不下载资源，而且闲置一段时间后连接会被关闭，只给马上要用的少数几个源使用
