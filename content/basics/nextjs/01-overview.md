---
difficulty: 1
tags: [高频, 对比]
---

# Next.js 是什么？和直接用 React 写单页应用相比解决了哪些问题？

::: tip 一句话回答
Next.js 是基于 React 的**全栈框架**。React 本身只管 UI，用它写单页应用时，路由、数据请求、服务端渲染、构建优化都要自己搭，还会遇到**首屏白屏和 SEO** 的问题。Next.js 用**文件即路由和嵌套布局**组织页面，支持**构建时预渲染、请求时渲染和流式输出**，服务端组件里可以直接取数据，用 **Server Functions 和 Route Handlers** 在同一个项目里写后端逻辑，还内置了图片、字体、脚本和链接预取的优化。代价是要理解服务端和客户端的边界、通常需要运行服务器，和框架绑定也比较深。
:::

## 详细解析

### 单页应用的痛点

用 Vite 加 React 写的单页应用（SPA），服务器返回一个几乎空的 HTML，浏览器下载并执行 JS 后才渲染内容：

- **首屏慢**：JS 下载、解析、执行完之前是白屏，接口请求还要等 JS 跑起来才发出，形成瀑布
- **SEO 和分享预览差**：不执行 JS 的爬虫和社交平台抓到的是空页面，标题和描述也很难按页面设置
- **基础设施要自己搭**：路由库、数据请求和缓存、代码分割、环境变量、服务端接口，每一项都要选型和拼装

渲染模式的区别见 [CSR、SSR、SSG、ISR](/basics/ssr/01-rendering-modes)。

### Next.js 提供了什么

| 方面 | 做法 |
| --- | --- |
| 路由 | `app` 目录下的文件夹就是 URL，`page.tsx` 是页面，`layout.tsx` 是共享布局，可以层层嵌套 |
| 渲染 | 能确定的部分在构建时预渲染成静态外壳，依赖请求的部分在请求时渲染，并通过 Suspense 流式输出 |
| 取数据 | [服务端组件](/basics/react/11-server-components)可以是 async 函数，直接查数据库或调接口，查询代码不进客户端包 |
| 后端逻辑 | Server Functions 处理页面上的写操作，Route Handlers 写给外部调用的 HTTP 接口 |
| 内置优化 | `next/image` 按设备尺寸生成多种图片，`next/font` 自托管字体并减少布局偏移，`next/script` 控制第三方脚本的加载时机，`<Link>` 在生产环境自动预取 |
| 部署 | `next start` 起 Node 服务、Docker 部署、静态导出（只能用不依赖服务器的功能），或者部署到支持它的托管平台 |

### 一个页面长什么样

```tsx
// app/posts/[id]/page.tsx
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params // params 是 Promise，要先 await
  const post = await db.post.findUnique({ where: { id } }) // 直接在服务端查库
  if (!post) notFound()

  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.content}</p>
    </article>
  )
}
```

同样的功能在 SPA 里要写一个后端接口、一个路由配置，再在组件里 `useEffect` 请求并处理加载状态。这里返回给浏览器的 HTML 已经包含文章内容。

### 代价

- **心智负担**：组件默认是服务端组件，用到状态、事件、浏览器 API 才要加 `'use client'`。哪些代码在哪里运行、什么能跨边界传，是新手最常踩坑的地方
- **需要服务器**：用到请求时渲染、Server Functions、图片优化，就要有 Node 进程或托管平台，不能像 SPA 一样扔到静态托管上
- **和框架绑定深**：路由、缓存、数据获取都按 Next.js 的约定写，迁移成本高；升级大版本时常有破坏性变化
- **缓存模型复杂**：数据什么时候是新的、什么时候是缓存的，需要专门理解，见 [Next.js 的缓存](/basics/ssr/05-next-caching)

App Router 和旧的 Pages Router 的区别见 [App Router 和 Pages Router](/basics/ssr/04-next-app-router)。

## 面试官可能追问

::: details 什么项目不适合用 Next.js？
登录后才能用、不需要 SEO 的后台管理系统，用纯 SPA 更简单，部署到静态托管就行。已有独立后端、只需要一个前端壳的项目，引入 Next.js 的服务端能力意义不大。团队不熟悉服务端组件，又要快速交付时，学习成本也要算进去。
:::

::: details Next.js 能完全取代后端吗？
能承担一部分，比如表单提交、简单的增删改查、Webhook 回调，都可以在 Server Functions 和 Route Handlers 里写。但长时间运行的任务、消息队列消费、复杂的领域逻辑，更适合放在独立的后端服务。常见做法是把 Next.js 当作 BFF：负责页面渲染和聚合接口，核心业务在后端。
:::

::: details 用了 Next.js，SEO 就自动没问题了吗？
不会。预渲染解决的是"爬虫拿到空页面"的问题。标题、描述、canonical、sitemap、结构化数据还是要自己写，Next.js 提供了 `metadata`、`generateMetadata`、`sitemap.ts` 这些约定。如果关键内容放在 `'use client'` 组件里、等浏览器请求才出现，爬虫照样看不到。
:::

## 易错点

- 以为 Next.js 只是"React 加服务端渲染"，忽略了它在路由、缓存、构建和部署上的约定
- 以为加了 `'use client'` 的组件只在浏览器运行；它在服务端也会渲染出 HTML，只是还会在客户端水合
- 把整个应用都标成 `'use client'` 来省事，等于退回到 SPA，还多了框架的复杂度
- 以为静态导出能用所有功能；Proxy、Server Functions、请求时渲染都需要服务器
