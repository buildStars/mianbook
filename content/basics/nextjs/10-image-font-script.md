---
difficulty: 2
tags: [性能优化, 高频]
---

# Next.js 的 next/image、next/font 和 next/script 分别做了哪些优化？使用时有哪些坑？

::: tip 一句话回答
三个组件分别管图片、字体和第三方脚本。**next/image** 按设备尺寸生成 `srcset`、按浏览器支持返回 WebP（可加 AVIF）、默认懒加载，并用 width 和 height 算出宽高比来避免布局偏移。**next/font** 在构建时下载字体并自托管，浏览器不再请求 Google，还会生成调整过的回退字体减少布局偏移。**next/script** 用 `strategy` 控制第三方脚本的加载时机，避免它们挤占首屏。常见的坑是：`fill` 的父元素没定位、没写 `sizes`、首屏大图被懒加载、远程图片白名单写得太宽、`beforeInteractive` 放错位置。
:::

## 详细解析

### next/image

```tsx
import Image from 'next/image'
import hero from './hero.jpg' // 静态导入，自动拿到宽高

export default function Page() {
  return (
    <>
      {/* 首屏大图：不懒加载，提高优先级 */}
      <Image src={hero} alt="首页横幅" loading="eager" fetchPriority="high" sizes="100vw" />

      {/* 卡片封面：撑满父容器 */}
      <div style={{ position: 'relative', aspectRatio: '4 / 3' }}>
        <Image
          src="https://cdn.example.com/covers/1.jpg"
          alt="封面"
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          style={{ objectFit: 'cover' }}
        />
      </div>
    </>
  )
}
```

- **尺寸**：`width`、`height` 是图片的固有尺寸，只用来推导宽高比、预留空间，**不决定显示大小**，显示大小由 CSS 决定。除了静态导入和 `fill`，两者都要写
- **fill**：图片绝对定位撑满父元素，父元素必须设置 `position` 为 relative、fixed 或 absolute
- **sizes**：告诉浏览器图片在不同视口下大概多宽，浏览器据此从 `srcset` 里挑一张。不写时按 `100vw` 算，三栏布局的小卡片也会下载整屏宽度的大图
- **首屏图**：默认 `loading="lazy"`，LCP 图片要改成 `loading="eager"` 或加 `fetchPriority="high"`。旧的 `priority` 属性已弃用，官方改为 `preload` 属性（为 true 时在 `<head>` 里插入预加载链接），多数情况用前面两种写法就够了
- **格式**：根据请求的 `Accept` 头返回 WebP，`images.formats` 里加上 `'image/avif'` 可以优先 AVIF。前面有 CDN 或反向代理时，要把 `Accept` 头转发过来

响应式图片本身的原理见 [响应式图片怎么做](/basics/html/07-responsive-images)，懒加载的原理见 [图片懒加载怎么实现](/basics/browser/12-lazy-loading)。

### next/image 的配置坑

```ts
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    formats: ['image/avif', 'image/webp'],
    qualities: [60, 75],
    remotePatterns: [
      // 越具体越好：限定协议、域名和路径
      { protocol: 'https', hostname: 'cdn.example.com', pathname: '/covers/**' },
    ],
  },
}
export default nextConfig
```

- **remotePatterns** 是远程图片的白名单，不匹配的返回 400。省略字段等于放开，写成 `hostname: '**'` 相当于把服务器变成任何人都能用的免费图片代理，消耗你的 CPU 和带宽
- **qualities** 默认只有 `[75]`，组件上写的 `quality` 会就近取允许的值。想用别的质量要先加进列表
- **SVG** 默认不经过优化。矢量图本身不需要缩放，直接 `unoptimized` 即可；开启 `dangerouslyAllowSVG` 要同时配置 `contentDispositionType` 和 `contentSecurityPolicy`
- 默认 loader 取原图时不转发用户的请求头，需要登录才能访问的图片要用 `unoptimized`

### next/font

```ts
// app/fonts.ts
import { Inter } from 'next/font/google'

export const inter = Inter({
  subsets: ['latin'],      // 要预加载的子集，不写会警告
  display: 'swap',         // 默认就是 swap
  variable: '--font-inter', // 生成 CSS 变量，方便 Tailwind 等使用
})
```

- **自托管**：构建时下载字体文件和 CSS，随静态资源一起部署。浏览器不向 Google 发请求，少一次跨域连接，也没有隐私问题
- **减少布局偏移**：自动生成调整过度量的回退字体（`adjustFontFallback`），网络字体到达前后文字宽度差得少，CLS 更小
- **按路由预加载**：在页面里用的字体只在这个页面预加载，在根布局里用的则所有路由都预加载
- 非可变字体必须写 `weight`；本地字体用 `next/font/local`，`src` 必填

### next/script

| strategy | 加载时机 | 适用 |
| --- | --- | --- |
| `beforeInteractive` | 注入初始 HTML，在 Next.js 代码和水合之前下载 | 机器人检测、Cookie 同意等必须最早运行的脚本；**只能放在根布局** |
| `afterInteractive`（默认） | 部分或全部水合之后 | 统计、标签管理器 |
| `lazyOnload` | 浏览器空闲时 | 客服聊天、社交分享这类不急的脚本 |
| `worker`（实验） | 放进 Web Worker | 不支持 App Router |

`onLoad`、`onReady`、`onError` 这些回调只能在客户端组件里用，`onLoad` 和 `onError` 不能和 `beforeInteractive` 一起用。

## 面试官可能追问

::: details 图片优化是在构建时做还是请求时做？
请求时做。第一次请求某个尺寸和质量时服务端转码，结果缓存在磁盘上，后续请求直接返回。所以自托管时首次访问会慢一点，也会占服务器 CPU。静态导出没有服务端，要配置自定义 loader 交给图片 CDN 处理。
:::

::: details 为什么说 remotePatterns 是安全配置？
优化接口会代替用户去抓取远程图片。白名单太宽时，别人可以拿你的站点去处理任意来源的图片，消耗资源，甚至让服务器去访问不该访问的地址。所以要尽量写死协议、域名和路径前缀，内网地址默认也会被拦截。
:::

::: details next/font 引入的字体能在 CSS 文件里用吗？
可以。设置 `variable` 后，把 `inter.variable` 加到 `<html>` 或某个容器的 className 上，CSS 里就能用 `var(--font-inter)`。也可以直接用 `inter.className`，只对那个元素生效。
:::

## 易错点

- `fill` 的父元素没有设置定位，图片跑到别的容器上或者高度为 0
- 用了 `fill` 或响应式布局却不写 `sizes`，浏览器下载远超所需的大图
- 首屏 LCP 图片保持默认懒加载，LCP 反而变差
- 在页面组件里放 `strategy="beforeInteractive"` 的脚本；它只能写在根布局里
