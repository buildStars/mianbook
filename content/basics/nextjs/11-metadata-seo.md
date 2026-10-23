---
difficulty: 2
tags: [实践]
---

# Next.js 怎么做 SEO？Metadata API、sitemap、robots 和 Open Graph 图片怎么配置？

::: tip 一句话回答
Next.js 把 SEO 相关的东西都做成了**约定**：在 layout 或 page 里导出 **`metadata` 对象**或 **`generateMetadata` 函数**生成 `<title>`、description、Open Graph 等标签，从根到叶**浅合并**；在 app 目录放 **`sitemap.ts`、`robots.ts`** 返回 `MetadataRoute` 类型的数据，框架生成对应的 XML 和文本；放 **`opengraph-image.tsx`** 用 `ImageResponse` 生成分享图。文件式 metadata 的优先级高于代码里的配置。
:::

## 详细解析

### metadata 和 generateMetadata

静态信息直接导出对象，依赖数据的用 `generateMetadata`。两者都只能写在服务端组件里，同一个路由段只能导出其中一个。

```tsx
// app/blog/[slug]/page.tsx
import type { Metadata } from 'next'
import { getPost } from '@/lib/posts'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params // params 是 Promise，要 await
  const post = await getPost(slug)
  return {
    title: post.title,
    description: post.summary,
    openGraph: { title: post.title, type: 'article' },
  }
}

export default async function Page({ params }: Props) {
  const { slug } = await params
  const post = await getPost(slug) // 和上面是同一份数据
  return <article>{post.content}</article>
}
```

`generateMetadata` 和页面各取一次同样的数据，不会真的请求两次：`fetch` 在 metadata、布局、页面之间自动去重；直接查数据库时，用 React 的 `cache()` 把 `getPost` 包一层，同一次请求内相同参数只查一次。在 `generateMetadata` 里也可以调用 `notFound()` 和 `redirect()`。

### title 模板和合并规则

```tsx
// app/layout.tsx
export const metadata: Metadata = {
  metadataBase: new URL('https://example.com'),
  title: { default: '示例站', template: '%s | 示例站' },
}
```

- `title.default`：子段没写 title 时用它
- `title.template`：只作用于**子段**，对同一段的 page 不生效，要和 `default` 一起写
- `title.absolute`：子段用它可以无视父级模板
- 合并顺序是根布局 → 嵌套布局 → 页面，**浅合并**：同名键后者覆盖前者。`openGraph`、`robots` 这类嵌套对象是**整体替换**，子页面写了 `openGraph: { title }`，父级 openGraph 里的 images 就没了。要共享就把公共部分提成变量再展开
- `metadataBase` 是 URL 类字段的基准地址。字段写相对路径又没设置它，构建会报错

即使什么都不写，Next.js 也会输出 charset 和 viewport 两个 meta。`themeColor`、`colorScheme` 这类字段已经从 metadata 里移出去了，放到 `viewport` 导出或 `generateViewport` 里。

### 流式 metadata 和爬虫

`generateMetadata` 依赖动态数据时，Next.js 不会让整个页面等它：先发出页面的 UI，metadata 生成后再流式输出。这时按 User-Agent 区分两类爬虫：

- 能执行 JS 的爬虫（如 Googlebot）：metadata 追加在 `<body>` 里，官方说明这种情况可以被正确解析
- 只解析 HTML 的爬虫（如社交平台抓分享卡片的程序）：服务端会等 metadata 生成，放进 `<head>` 再发

名单可以用 `next.config` 的 `htmlLimitedBots` 覆盖，设成匹配所有 UA 就等于关闭流式 metadata，代价是首字节变慢。

### sitemap、robots 和 Open Graph 图片

```ts
// app/sitemap.ts
import type { MetadataRoute } from 'next'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getAllPosts()
  return [
    { url: 'https://example.com', lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    ...posts.map((p) => ({ url: `https://example.com/blog/${p.slug}`, lastModified: p.updatedAt })),
  ]
}
```

```ts
// app/robots.ts
import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/admin/' },
    sitemap: 'https://example.com/sitemap.xml',
  }
}
```

- URL 很多的站点用 `generateSitemaps()` 返回 `[{ id }]`，拆成多个 sitemap 文件，单个 sitemap 有 URL 数量上限
- sitemap 和 robots 默认在构建时生成并缓存，用到请求时 API 才会变成动态
- `opengraph-image.tsx` 默认导出一个返回 `ImageResponse`（来自 `next/og`）的函数，用 JSX 画图；另外导出 `alt`、`size`、`contentType`。也可以直接放静态的 `opengraph-image.png`
- 这些文件生成的标签会覆盖 `metadata` 里写的同类字段

通用的 SEO 思路（语义化、结构化数据、性能）见 [前端能为 SEO 做什么](/basics/html/10-seo)。

## 面试官可能追问

::: details 客户端组件里能导出 metadata 吗？想按客户端状态改标题怎么办？
不能，metadata 只在服务端组件里生效。标题依赖的数据通常可以在服务端拿到，放进 `generateMetadata`。真的只有客户端知道的状态（比如未读消息数），可以在客户端组件里直接渲染 React 的 `<title>` 元素，但这部分内容爬虫不一定看得到。
:::

::: details 为什么分享到社交平台时卡片没有图片？
常见原因：图片地址是相对路径又没设置 `metadataBase`；子页面写了自己的 `openGraph` 把父级的 images 整体覆盖掉了；图片太大超过平台限制。可以用平台提供的调试工具重新抓取，查看实际拿到的标签。
:::

::: details 开启 Cache Components 后 generateMetadata 有什么要注意的？
如果页面其他部分都能预渲染，只有 metadata 要在请求时读 cookies、params 或未缓存的数据，会报错。依赖外部数据时给取数函数加 `'use cache'`；确实需要请求时数据，要显式标记为动态，比如在 Suspense 里 `await connection()`。
:::

## 易错点

- 以为子页面的 `openGraph` 会和父级逐项合并，实际是整体替换，图片、站点名会丢
- 在同一个 page 里写 `title.template`，期望它作用于自己，实际只作用于子段
- 同一段同时导出 `metadata` 和 `generateMetadata`，或在 `'use client'` 文件里导出，都不生效
- 担心 `generateMetadata` 和页面重复查库就把数据塞进全局变量，正确做法是用 `cache()` 在请求内去重
