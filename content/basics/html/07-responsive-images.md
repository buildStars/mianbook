---
difficulty: 2
tags: [性能优化, 实践]
---

# 响应式图片怎么做？srcset、sizes 和 picture 有什么区别？

::: tip 一句话回答
响应式图片要解决的是**不同设备下载尺寸合适的图**。同一张图准备了多种尺寸时，用 `srcset` 的 **w 描述符**写出每个文件的实际宽度，再用 **`sizes`** 告诉浏览器图片在页面上显示多宽，浏览器结合**设备像素比**自己挑；显示尺寸固定的图，用 **x 描述符**（1x、2x）就够了。不同屏幕要换一种裁剪（艺术指导），或者要提供 AVIF、WebP 并降级到 JPEG 时，用 `<picture>` 加 `<source>`。另外要写 `width`、`height` 防止布局偏移，首屏大图不要懒加载，可以加 `fetchpriority="high"`。
:::

## 详细解析

### 为什么要写在 HTML 里

浏览器拿到 HTML 后，预加载扫描器会在 CSS 和 JS 还没处理完时就开始下载图片。等 JS 算出屏幕宽度再换图，原图早就下载完了。所以选图需要的信息（有哪些候选、显示多宽）必须直接写在 `<img>` 上。

### srcset 的 w 描述符配合 sizes

```html
<img
  src="hero-800.jpg"
  srcset="hero-400.jpg 400w, hero-800.jpg 800w, hero-1600.jpg 1600w"
  sizes="(max-width: 600px) 100vw, (max-width: 1200px) 50vw, 600px"
  width="1600" height="900"
  alt="新品耳机">
```

浏览器的选图过程：

1. 从左到右找 `sizes` 里第一个成立的媒体条件，得到图片的显示宽度；最后一项不带条件，是默认值
2. 显示宽度乘以设备像素比（DPR），得到需要的像素宽度
3. 从 `srcset` 里挑一张合适的，一般是不小于需要宽度的那张。规范允许浏览器自行决定，比如已经缓存了更大的图就直接用

举例：375px 宽、DPR 为 3 的手机，命中 `100vw`，需要 375 × 3 = 1125 像素，选 `hero-1600.jpg`；1000px 宽、DPR 为 1 的窗口，命中 `50vw`，需要 500 像素，选 `hero-800.jpg`。

几个规则：

- `400w` 是图片文件**本身的像素宽度**，不是显示宽度
- 不写 `sizes` 时默认是 `100vw`，小卡片里的图也会按整个屏幕宽度去选，往往下载过大的图
- `sizes` 里不能用百分比，可以用 `vw`、`px`、`calc()`；它要和 CSS 里的实际布局一致，改了布局要同步修改
- 带 `loading="lazy"` 的图可以写 `sizes="auto"`，让浏览器直接用布局算出的宽度，但支持度还在铺开，后面要跟上普通的 sizes 作为回退

### x 描述符：显示尺寸固定的图

```html
<img src="logo.png" srcset="logo@2x.png 2x, logo@3x.png 3x" width="120" height="40" alt="公司名">
```

logo、头像、图标这类在所有屏幕上显示尺寸都一样的图，只需要按像素密度提供几张，`src` 就是 1x 的候选，不需要 `sizes`。同一个 `srcset` 里不能混用 w 和 x。

### picture：艺术指导和格式降级

```html
<!-- 格式降级：浏览器选第一个支持的格式 -->
<picture>
  <source type="image/avif" srcset="photo.avif">
  <source type="image/webp" srcset="photo.webp">
  <img src="photo.jpg" width="1200" height="800" alt="海边的日落">
</picture>

<!-- 艺术指导：窄屏换成竖版裁剪，宽高比不同，source 上也写宽高 -->
<picture>
  <source media="(max-width: 600px)" srcset="banner-portrait.jpg" width="600" height="800">
  <img src="banner-wide.jpg" width="1600" height="600" alt="秋季新品上市">
</picture>
```

- 浏览器从上到下找第一个 `type` 支持且 `media` 成立的 `<source>`，都不满足就用 `<img>` 自己的地址
- `<img>` 必须写，放在最后。真正显示的是 `<img>` 元素，`alt`、`loading`、class 都写在它上面，`<source>` 只是提供候选地址
- `<source>` 里也可以写 `srcset` 加 `sizes`，把两种能力组合起来

| | srcset + sizes | picture + source |
| --- | --- | --- |
| 解决的问题 | 同一张图按尺寸和像素密度选择 | 换裁剪、换格式 |
| 谁做决定 | 浏览器可以自行选择 | `media` 和 `type` 是硬性条件，必须遵守 |
| 典型场景 | 文章配图、商品图 | 横幅在手机上换竖图；AVIF、WebP 降级 |

### 防布局偏移和加载优化

- **写上 `width` 和 `height`**：浏览器在图片下载前就能按宽高比预留空间，避免加载后把下面的内容挤开（CLS）。CSS 里写 `img { max-width: 100%; height: auto; }`，图片仍然能按比例缩放
- **非首屏图片**加 `loading="lazy"`，`decoding="async"` 提示浏览器异步解码，详见 [图片懒加载](/basics/browser/12-lazy-loading)
- **首屏最大的图（通常是 LCP 元素）不要懒加载**，加 `fetchpriority="high"` 提高下载优先级，详见 [Core Web Vitals](/basics/browser/09-web-vitals)
- 用作 CSS 背景的首屏大图，浏览器要等样式表解析后才发现它，可以用 `<link rel="preload" as="image">` 提前加载，响应式的写法是加上 `imagesrcset` 和 `imagesizes`

## 面试官可能追问

::: details CSS 背景图怎么做响应式？
用媒体查询按屏幕宽度切换 `background-image`，或者用 `image-set()` 按像素密度和格式提供候选，比如 `image-set(url(a.avif) type("image/avif"), url(a.jpg) type("image/jpeg"))`。背景图没有 `alt`，有意义的内容图片还是应该用 `<img>`。
:::

::: details 怎么确认浏览器实际选了哪张图？
在控制台读 `img.currentSrc`，就是当前实际使用的地址；或者看 Network 面板下载了哪个文件。用 DevTools 的设备模拟切换不同的屏幕宽度和 DPR 测试，注意要清掉缓存：浏览器已经有更大的图时，缩小窗口通常不会再去下载小图。
:::

::: details 每张图都手动切多种尺寸太麻烦，有什么办法？
一般交给图片服务或 CDN：通过 URL 参数按需生成不同的尺寸和格式，再在模板或组件里批量生成 `srcset`。有的服务会根据请求头 `Accept` 返回 AVIF 或 WebP，这时缓存要按 `Accept` 区分（`Vary: Accept`）。很多框架的图片组件（例如 Next.js 的 Image、Nuxt Image）也会自动完成这些工作。
:::

## 易错点

- 把 w 描述符写成显示宽度，浏览器会选错图；写成 `400px` 是无效的描述符，这个候选会被直接忽略
- 用了 w 描述符却忘了写 `sizes`，默认按 `100vw` 计算，常常下载过大的图
- 首屏的主图加了 `loading="lazy"`，反而拖慢了 LCP
- `<picture>` 里漏写 `<img>` 就什么都不显示；`alt` 要写在 `<img>` 上，不是 `<source>` 上
