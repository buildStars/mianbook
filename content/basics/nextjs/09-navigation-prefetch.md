---
difficulty: 2
tags: [原理, 性能优化]
---

# Next.js 的 Link 为什么跳转快？预取和客户端导航是怎么工作的？

::: tip 一句话回答
两件事叠加。一是**预取**：`<Link>` 进入视口时就在后台拿下目标路由的数据，静态路由预取整个路由，动态路由预取到最近的 `loading` 边界，只在生产环境生效。二是**客户端导航**：点击后不重新加载整页，只请求变化的路由段，拿回的是 **RSC payload** 而不是整页 HTML，共享的 layout 保留状态、不重新渲染。再加上 `loading` 文件让导航**立即有反馈**，用户感觉上几乎是瞬间切换。
:::

## 详细解析

### 预取：什么时候、取多少

`<Link>` 是客户端组件，水合之后开始工作。它进入视口（初次渲染或滚动进来）时触发预取；鼠标悬停时如果之前预取的数据已过期，会再取一次。

| `prefetch` | 行为 |
| --- | --- |
| 不写（默认，等同 `"auto"` 或 `null`） | 静态路由预取整个路由和数据；动态路由预取到最近的 `loading.js` 边界 |
| `true` | 静态、动态路由都预取整个路由 |
| `false` | 进入视口和悬停都不预取，点击时才请求 |

**开发环境不预取**。所以本地调试时觉得跳转慢，不代表线上也慢。

列表页有几百个链接时，全部预取会浪费流量，可以默认关闭、悬停再开：

```tsx
'use client'
import Link from 'next/link'
import { useState } from 'react'

export function HoverLink({ href, children }: { href: string; children: React.ReactNode }) {
  const [active, setActive] = useState(false)
  // null 表示恢复默认预取行为
  return (
    <Link href={href} prefetch={active ? null : false} onMouseEnter={() => setActive(true)}>
      {children}
    </Link>
  )
}
```

### 客户端导航：只换变化的部分

```text
/shop/phones  →  /shop/laptops

app/layout.tsx          保留（不重新渲染，状态还在）
app/shop/layout.tsx     保留（侧边栏的展开状态、输入框内容都不丢）
app/shop/[cat]/page.tsx 替换（只有这一段的 RSC payload 需要获取）
```

1. 点击 `<Link>`，路由器拦截默认跳转，更新 URL
2. 已预取的部分直接从客户端缓存渲染；没预取的向服务端请求变化路由段的 RSC payload
3. React 用 payload 更新组件树，layout 不重新挂载

共享 layout 只下载一次，增量预取只拿缓存里没有的部分，离开视口的预取会取消。请求数可能变多，总传输量变少。

### loading 和慢网络

`loading.tsx` 会自动把同段的 page 包进 `<Suspense>`，它的 fallback 也会被预取，所以点击后能立刻显示骨架屏，导航过程还可以被打断。

慢网络下预取可能还没完成，fallback 都看不到，用户点了没反应。这时可以用 `next/link` 的 `useLinkStatus` 在链接上显示 pending：

```tsx
'use client'
import { useLinkStatus } from 'next/link'

// 放在 <Link> 内部使用
export function PendingDot() {
  const { pending } = useLinkStatus()
  return <span className={pending ? 'dot dot-loading' : 'dot'} aria-hidden />
}
```

给指示器加一点延迟动画（例如 100ms 后才显示），快速导航时就不会闪一下。

### 客户端缓存能用多久

预取和导航拿到的内容存在客户端路由缓存里，使用时长由服务端告知的 `stale` 时间决定，**客户端强制最少 30 秒**。开启 Cache Components 时，`stale` 来自 `cacheLife` 的配置。在 Server Action 里调用 `revalidateTag`、`revalidatePath`、`updateTag` 或 `refresh` 时，整个客户端缓存立即清空。缓存分层的细节见 [Next.js 有哪几层缓存](/basics/ssr/05-next-caching)。

### 延伸：局部预取

开启 `cacheComponents` 和 `partialPrefetching` 后，默认预取改成只拿每个路由的**页面外壳**（静态部分和 Suspense 的 fallback），而不是整页。点击时先显示外壳，动态内容随后流入。这样能给大量链接做预取，又不必提前算出每个页面的动态数据。

## 面试官可能追问

::: details Next.js 的预取和 `<link rel="prefetch">` 有什么区别？
`<link rel="prefetch">` 让浏览器以低优先级下载一个资源，放进 HTTP 缓存，浏览器不知道它在应用里的含义。Next.js 的预取由路由器发起，拿的是路由段的 RSC payload，存进自己的路由缓存，导航时直接拿来渲染。资源提示的通用知识见 [preload、prefetch、preconnect](/basics/browser/11-resource-hints)。
:::

::: details 用 router.push 跳转也会预取吗？
`router.push` 本身只负责导航，不会在之前提前预取。需要的话可以调用 `router.prefetch(href)` 手动预取，比如在用户填完表单、即将跳转之前。
:::

::: details 什么情况下点击 Link 会变成整页刷新？
跳到另一个根布局下的路由、跨应用的链接，以及部署后客户端和服务端版本不一致时，都会走整页加载。版本不一致的情况可以通过配置 `deploymentId` 让框架检测到并主动硬导航。
:::

## 易错点

- 在开发环境测"跳转速度"，得出预取没用的结论；预取只在生产环境开启
- 以为动态路由默认也会预取整页；默认只预取到最近的 loading 边界，没有 loading 文件时会跳过预取
- 把 `prefetch={false}` 加到所有链接上省流量，结果每次点击都要等服务端
- 期待 layout 在每次导航时重新执行取数逻辑，layout 在客户端导航时并不重新渲染
