---
difficulty: 1
tags: [高频, 原理]
---

# Next.js App Router 的 layout、template、loading、error、not-found 各有什么作用？渲染时怎么嵌套？

::: tip 一句话回答
同一个路由段里，这几个文件由外到内嵌套成 **layout → template → error（错误边界）→ loading（Suspense 边界）→ not-found → page**，子路由段整体嵌在父段的 layout 里面。**layout** 是共享外壳，导航时保留状态、不重新渲染；**template** 每次导航都重新挂载；**loading** 给同段的 page 包一层 Suspense；**error** 是错误边界，必须是客户端组件，捕获不到同段 layout 的错误；**not-found** 在调用 `notFound()` 时渲染。只有放了 `page` 的段才能被访问。
:::

## 详细解析

### 嵌套结构

一个段里这些文件同时存在时，Next.js 把它们组合成下面的组件树：

```text
<Layout>
  <Template>
    <ErrorBoundary fallback={<Error />}>
      <Suspense fallback={<Loading />}>
        <NotFoundBoundary fallback={<NotFound />}>
          <Page />  或者  子路由段的整棵树（从子段的 Layout 开始）
        </NotFoundBoundary>
      </Suspense>
    </ErrorBoundary>
  </Template>
</Layout>
```

从这张图可以直接推出几条规则：loading 包不住同段的 layout，error 也捕获不到同段 layout 和 template 抛出的错误；子段的 layout 出错，会被父段的 error 接住。

### layout 和 template

| | layout | template |
| --- | --- | --- |
| 导航时 | 保留状态，不重新渲染 | 带唯一 key，重新挂载，DOM 重建 |
| 子组件状态 | 保留，比如输入框内容 | 重置 |
| `useEffect` | 不重新执行 | 重新执行 |
| 内部 Suspense | 只在首次加载时显示 fallback | 每次导航都显示 fallback |

根布局 `app/layout.tsx` 必须存在，而且要包含 `html` 和 `body` 标签。template 只在本段（包括动态参数）变化时重新挂载，更深的段变化、只改 search params 都不会触发。需要"每次进入页面都记一次日志""切换页面后清空表单"时才用 template，大多数情况用 layout。

### loading

`loading.tsx` 会把同段的 `page` 及其子树包进 `<Suspense>`，page 里的异步数据没回来时先显示它。它的 fallback 会被预取，点击链接时能立即显示。因为包不住同段的 layout，layout 里慢的请求不会显示这个 loading，要在 layout 里自己加 Suspense，或者把数据请求移到 page。

### error 和 global-error

```tsx
// app/dashboard/error.tsx
'use client' // 错误边界必须是客户端组件

export default function DashboardError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div>
      {/* 生产环境服务端错误的 message 是通用文本，用 digest 对应服务端日志 */}
      <p>加载失败，错误编号 {error.digest}</p>
      <button onClick={() => retry()}>重试</button>
    </div>
  )
}
```

- `retry()` 会重新请求数据并重新渲染边界内的内容；`reset()` 只清除错误状态，不重新请求，大多数情况用 `retry()`
- 根布局的错误没有更外层的 error 能接，要放 `app/global-error.tsx`。它会替换根布局，所以要自己写 `html` 和 `body`
- 事件处理函数和异步回调里的错误不会被错误边界捕获，要自己 try/catch 并更新状态

### not-found 和不进 URL 的文件夹

- 在 page、layout 或 Server Function 里调用 `notFound()`，渲染最近的 `not-found.tsx`。它不接收 props。注意 not-found 边界在同段 layout 里面，layout 里调用 `notFound()` 时接不住，要由上层段的 not-found 处理，error 边界同理。根目录的 `app/not-found.tsx` 还负责全站没有匹配到的 URL
- 只有包含 `page.tsx`（或 `route.ts`）的段才能访问。文件夹里放组件、工具函数不会变成路由
- `_components` 这种下划线开头的私有文件夹完全不参与路由；`(marketing)` 这种路由组用来分组和共享 layout，名字不进 URL

## 面试官可能追问

::: details 为什么 layout 里拿不到当前路径的 searchParams？
layout 在导航时不重新渲染，如果它依赖 searchParams，切换参数时就会是旧值，所以 layout 的 props 里没有 searchParams。需要时在 page 里读，或者在客户端组件里用 `useSearchParams`。同理，layout 不重新渲染也意味着不适合在 layout 里做唯一的权限检查。
:::

::: details 一个页面里有多个独立的慢请求，只用 loading.tsx 够吗？
loading 是整页级别的，任意一个请求没回来，整页都显示 loading。更好的做法是在 page 里给每块内容单独包 `<Suspense>`，先显示已经就绪的部分，慢的部分各自显示骨架屏，流式补上。
:::

::: details notFound() 之后状态码一定是 404 吗？
不一定。响应还没开始流式输出时返回 404；如果外层已经开始输出（比如 notFound 在 Suspense 里面），状态码已经发出去了，只能是 200，但页面会渲染 not-found 的内容并加上 `noindex`。对 SEO 敏感的话，判断资源存在与否的逻辑要放在 Suspense 之外尽早执行。
:::

## 易错点

- 以为 error.tsx 能捕获同段 layout 的错误，实际上要靠父段的 error 或 global-error
- error.tsx 忘写 `'use client'`，构建直接报错
- 在 layout 里放慢请求，然后奇怪 loading.tsx 为什么不显示
- 以为 template 和 layout 只是换个名字；template 每次导航都会重置子组件状态
