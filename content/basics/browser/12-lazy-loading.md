---
difficulty: 1
tags: [性能优化, 手写题]
---

# 图片懒加载怎么实现？

::: tip 一句话回答
懒加载就是图片快进入视口时才去请求，减少首屏的请求数和流量。最简单的是原生属性 `loading="lazy"`，由浏览器决定何时加载；需要更多控制时用 **IntersectionObserver**：真实地址放在 `data-src`，元素进入视口时赋给 `src`，然后取消观察。早期监听 `scroll` 加 `getBoundingClientRect` 的做法需要节流，性能较差。
:::

## 详细解析

### 方案一：原生 `loading="lazy"`

```html
<img src="photo.jpg" loading="lazy" width="800" height="600" alt="商品图">
<iframe src="https://example.com/map" loading="lazy"></iframe>
```

- 加一个属性就行，不需要 JS。提前多远开始加载由浏览器决定，不同浏览器的策略不同
- `src` 写的是真实地址，对搜索引擎友好
- 不支持的旧浏览器会忽略这个属性，照常加载图片，属于渐进增强
- 缺点：加载时机完全由浏览器决定，不能自定义提前量

### 方案二：IntersectionObserver

IntersectionObserver 可以观察元素与视口（或指定的祖先元素）是否相交，状态变化时回调。交叉状态由浏览器在渲染流程中统一计算，不用监听 `scroll`，也不用自己读取元素位置。

1. `<img>` 的 `src` 先放占位图，真实地址放在 `data-src`
2. 创建观察者，`rootMargin` 设为 `'200px 0px'`，图片距离视口还有 200px 时就开始加载
3. 回调里判断 `entry.isIntersecting`，为真就把 `data-src` 赋给 `src`
4. 赋值后调用 `unobserve` 取消观察；页面或组件销毁时调用 `disconnect`

### 方案三：监听 scroll（旧方案）

在 `scroll` 事件里遍历图片，用 `getBoundingClientRect()` 判断是否进入视口：`rect.top < window.innerHeight && rect.bottom > 0`。问题是 `scroll` 触发非常频繁，必须节流（见[防抖和节流](/basics/javascript/13-debounce-throttle)）；每次都要读取布局信息，可能引起强制同步布局；还要额外处理 `resize`、容器内滚动等情况。

### 体验和性能细节

- **首屏图片不要懒加载**，尤其是 LCP 图片。懒加载的图片要等布局完成、确认在视口内才开始请求，会拖慢 LCP（见 [Core Web Vitals](/basics/browser/09-web-vitals)）。首屏大图反而可以加 `fetchpriority="high"` 提高优先级
- **预留尺寸**：写上 `width` 和 `height` 属性，或者用 CSS 的 `aspect-ratio`，图片加载前就占好位置，避免加载后把下方内容挤开（CLS）
- **占位过渡**：先显示纯色块，或者几十像素宽的模糊缩略图（LQIP），真实图片加载后替换
- **合适的尺寸**：配合 `srcset` / `sizes`，让浏览器按屏幕宽度和像素密度选图，手机上不下载大图
- **`decoding="async"`**：提示浏览器异步解码图片，减少解码对其他内容渲染的阻塞

## 代码示例

```html
<!-- src 先放模糊的小图，真实地址放在 data-src；写上宽高，避免布局偏移 -->
<img src="photo-tiny.jpg" data-src="photo.jpg" width="800" height="600" alt="商品图">
```

```js
function lazyLoad(images) {
  // 不支持 IntersectionObserver 时降级：直接全部加载
  if (!('IntersectionObserver' in window)) {
    images.forEach(loadImage)
    return
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        // 开始观察时会先回调一次，离开视口时也会回调，所以要判断
        if (!entry.isIntersecting) return
        loadImage(entry.target)
        observer.unobserve(entry.target) // 只需加载一次，取消观察
      })
    },
    { rootMargin: '200px 0px' } // 视口上下各扩大 200px，提前加载
  )

  images.forEach((img) => observer.observe(img))
}

function loadImage(img) {
  const { src, srcset } = img.dataset
  if (srcset) img.srcset = srcset
  img.src = src
}

lazyLoad(document.querySelectorAll('img[data-src]'))
```

## 面试官可能追问

::: details 无限滚动怎么实现？
在列表末尾放一个空的"哨兵"元素，用 IntersectionObserver 观察它，哨兵进入视口（可以用 `rootMargin` 提前一点）就请求下一页，追加到哨兵前面。请求期间用一个标志位防止重复加载，没有更多数据时取消观察。注意：如果加载一页后哨兵仍在视口内，交叉状态没有变化，回调不会再次触发，可以先 `unobserve` 再 `observe`，让它重新检查一次。数据量很大时还要配合[虚拟列表](/basics/browser/13-long-list)。
:::

::: details 懒加载会影响 SEO 吗？
可能会。搜索引擎的爬虫不一定识别 `data-src`，只写在 `data-src` 里的图片地址可能抓不到；爬虫一般也不会像用户那样滚动页面，依赖 `scroll` 事件的懒加载可能永远不触发。原生 `loading="lazy"` 的 `src` 就是真实地址，对 SEO 更友好。
:::

::: details IntersectionObserver 的 threshold 和 rootMargin 分别是什么？
- `threshold`：目标元素的可见比例越过哪些值时触发回调，取值 0～1，也可以传数组，如 `[0, 0.5, 1]`。默认是 0，刚进入或完全离开时触发
- `rootMargin`：扩大或缩小根元素的判定范围，写法和 CSS 的 `margin` 一样，如 `'200px 0px'` 表示上下各扩大 200px
- 还有一个 `root`：用作视口的祖先元素，默认是浏览器视口
:::

## 易错点

- 首屏图片，尤其是 LCP 图片，不要懒加载
- IntersectionObserver 开始观察时会先回调一次，离开视口也会回调，必须判断 `isIntersecting`
- 懒加载的图片不预留尺寸，加载完成后会造成布局偏移
