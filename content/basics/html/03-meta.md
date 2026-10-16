---
difficulty: 1
tags: [实践]
---

# 常用的 meta 标签有哪些？viewport 应该怎么设置？

::: tip 一句话回答
`<meta charset="utf-8">` 要放在 `<head>` 的**最前面**，规范要求它出现在文档的前 1024 个字节里。viewport 推荐写 `width=device-width, initial-scale=1`，**不要禁止用户缩放**。和搜索、分享相关的有 description、robots 和 Open Graph（`og:title`、`og:image` 等）；theme-color 设置浏览器界面的颜色，referrer 控制请求带出去的 Referer。用 `http-equiv` 设置 CSP 时，`frame-ancestors`、`report-uri`、`sandbox` 这几个指令不生效，要用响应头。
:::

## 详细解析

### charset

浏览器要先知道编码才能正确解析后面的内容。charset 声明放得太靠后（比如前面有一个中文 `<title>`），浏览器可能已经按别的编码开始解析了，导致乱码或重新解析。实际的优先级是：文件开头的 BOM > 响应头 `Content-Type: text/html; charset=utf-8` > meta 声明。

### viewport

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

- `width=device-width`：布局视口等于设备的 CSS 宽度。不写的话，移动浏览器会按 980px 左右的桌面宽度渲染再整体缩小，字很小
- `initial-scale=1`：初始缩放比例为 1
- `viewport-fit=cover`：让页面延伸到刘海屏的边缘，配合安全区域使用，详见 [移动端适配](/basics/css/12-mobile-adapt)

**不要写 `user-scalable=no` 或 `maximum-scale=1`。** 低视力用户依赖双指放大阅读，WCAG 要求文字能放大到 200% 而不丢失内容。而且 iOS Safari 默认会忽略这些禁止缩放的设置，写了也未必有效。常见的禁止缩放的理由是"iOS 上点击输入框页面会自动放大"，正确做法是把输入框的字号设为 16px 及以上。

### 搜索和分享

| 标签 | 作用 |
| --- | --- |
| `<meta name="description">` | 页面摘要，搜索结果里可能展示它，搜索引擎也可能自己从正文截取 |
| `<meta name="robots" content="noindex, nofollow">` | 不收录这个页面、不跟踪页面上的链接，适合搜索结果页、后台页面 |
| `<meta property="og:title">` 等 | Open Graph 协议，社交平台和聊天软件抓取它们生成分享卡片 |
| `<meta name="twitter:card">` | 部分平台使用的卡片样式声明 |
| `<meta name="keywords">` | Google 明确表示不使用它，不必花精力维护 |

### 其他常用的

- `<meta name="theme-color" content="#0f172a">`：移动端浏览器地址栏等界面的颜色，可以加 `media="(prefers-color-scheme: dark)"` 为深色模式单独设置
- `<meta name="color-scheme" content="light dark">`：告诉浏览器页面支持深浅两种配色，表单控件和滚动条会跟着系统切换
- `<meta name="referrer" content="strict-origin-when-cross-origin">`：控制 Referer 请求头。这个值也是现代浏览器的默认值；不想让外链看到完整路径时可以改成更严格的值
- `http-equiv` 系列：模拟响应头。`refresh` 定时刷新或跳转，对读屏用户不友好，跳转应该在服务端返回 301/302；`X-UA-Compatible` 是旧 IE 用的，已经没有作用

### 用 meta 设置 CSP 的限制

`<meta http-equiv="Content-Security-Policy" content="...">` 可以在改不了响应头的静态托管上使用，但有几个限制：

- `frame-ancestors`、`report-uri`、`sandbox` 不支持，所以它**防不了点击劫持**
- 不支持 `Content-Security-Policy-Report-Only`，没法先观察再上线
- 只对它后面的内容生效，必须尽量放在 `<head>` 前部

能改响应头时，CSP 和其他安全相关的头都应该放在响应头里。

## 代码示例

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>文章标题 - 站点名</title>
  <meta name="description" content="一两句话说清楚这个页面讲什么">
  <link rel="canonical" href="https://example.com/posts/hello">

  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0f172a" media="(prefers-color-scheme: dark)">

  <!-- 分享卡片：图片和链接用绝对地址 -->
  <meta property="og:type" content="article">
  <meta property="og:title" content="文章标题">
  <meta property="og:description" content="分享卡片上显示的描述">
  <meta property="og:image" content="https://example.com/images/cover.png">
  <meta property="og:url" content="https://example.com/posts/hello">
  <meta name="twitter:card" content="summary_large_image">

  <link rel="icon" href="/favicon.ico">
</head>
```

## 面试官可能追问

::: details 移动端想去掉双击缩放，又不想禁止双指缩放，怎么做？
给需要快速点击的元素（或整个页面）设置 CSS `touch-action: manipulation`。它只禁用双击缩放这类手势，保留滚动和双指缩放。另外，设置了 `width=device-width` 的页面，现代移动浏览器已经不会给点击加 300ms 延迟了。
:::

::: details 单页应用的分享卡片为什么不显示标题和图片？
多数社交平台的抓取程序不执行 JS，只读服务端返回的 HTML。单页应用的 Open Graph 标签如果是在路由切换后由 JS 插入的，抓取程序看不到。解决办法是让服务端渲染或预渲染这些页面，在返回的 HTML 里直接写好每个页面的 meta。另外，平台会缓存抓取结果，改了之后通常要用平台提供的调试工具刷新。
:::

::: details 已经有 `<title>` 了，description 还有必要写吗？
有必要。`<title>` 是搜索结果和标签页上的标题，description 是摘要的候选，写得好能让用户更愿意点进来。每个页面都应该有自己的 title 和 description，所有页面都用同一个，等于没写。
:::

## 易错点

- charset 声明放在含中文的 `<title>` 后面，或者离开头太远，可能导致乱码
- 为了解决 iOS 输入框聚焦放大而禁止缩放，正确做法是把输入框字号设为 16px 及以上
- 以为在 meta 里写 CSP 的 `frame-ancestors` 能防止页面被嵌入，实际不生效，要用响应头
- Open Graph 标签按协议使用 `property` 属性，而不是 `name`
