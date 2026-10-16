---
difficulty: 2
tags: [对比, 新技术]
---

# Next.js 的 App Router 和 Pages Router 有什么区别？

::: tip 一句话回答
两者是 Next.js 的两套路由系统。**Pages Router** 基于 `pages` 目录，一个文件就是一个路由，组件都是客户端组件，数据在 `getServerSideProps`、`getStaticProps` 里取好再作为 props 传给页面。**App Router** 基于 `app` 目录，文件夹定义路由，用 `page`、`layout`、`loading`、`error` 等约定文件描述每一段路由；组件**默认是服务端组件**，需要交互时用 `'use client'` 划出客户端边界；数据直接在服务端组件里 `await`；**嵌套布局**在页面切换时保留状态；基于 Suspense **流式加载**。两套路由可以在同一个项目里共存，逐页迁移。
:::

## 详细解析

### 目录约定

```text
app/                       App Router：文件夹是路由段，有 page 文件才能访问
├─ layout.tsx              根布局，必须有，定义 html 和 body（替代 _app、_document）
├─ page.tsx                /
└─ dashboard/
   ├─ layout.tsx           /dashboard 下所有页面共享，切换子页面时不会重新渲染
   ├─ loading.tsx          自动给本段的页面包一层 Suspense，显示加载状态
   ├─ error.tsx            本段的错误边界，必须是客户端组件
   ├─ page.tsx             /dashboard
   └─ settings/page.tsx    /dashboard/settings

pages/                     Pages Router：每个文件就是一个路由
├─ _app.tsx                所有页面的外层（全局样式、Provider）
├─ index.tsx               /
├─ api/hello.ts            /api/hello 接口
└─ dashboard/
   ├─ index.tsx            /dashboard
   └─ settings.tsx         /dashboard/settings
```

App Router 中 `page` 之外的文件（组件、样式、测试）可以和路由放在同一个文件夹里，不会变成路由。

### 主要区别

| | Pages Router | App Router |
| --- | --- | --- |
| 组件类型 | 都是客户端组件（同样会 SSR 再水合） | 默认服务端组件，`'use client'` 标记客户端组件 |
| 数据获取 | `getServerSideProps`、`getStaticProps`、`getStaticPaths` | 服务端组件里直接 await，`generateStaticParams` 替代 `getStaticPaths` |
| 布局 | `_app` 加每个页面的 `getLayout` | 嵌套的 `layout` 文件，切换时保留状态 |
| 加载和错误 | 自己处理，全局的 `_error`、`404` | 每段路由可以有自己的 `loading`、`error`、`not-found` |
| 渲染方式 | 页面数据全部取完才开始渲染 | 基于 Suspense 分块流式输出 |
| 路由 Hook | `next/router` 的 `useRouter` | `next/navigation` 的 `useRouter`、`usePathname`、`useSearchParams` |
| head 管理 | `next/head` | Metadata API：导出 `metadata` 或 `generateMetadata` |
| 接口 | `pages/api/*` | `route.ts`（Route Handler，基于 Web 的 Request 和 Response） |
| 数据变更 | 调接口 | 还可以用 [Server Actions](/basics/ssr/06-server-actions) |

### 服务端组件和客户端边界

App Router 里的组件默认只在服务端运行，代码不进浏览器的 JS 包，可以直接查数据库、读环境变量。用到 state、事件处理、浏览器 API 的组件，文件顶部写 `'use client'`，它和它导入的模块都成为客户端代码。边界应该尽量往叶子节点放，比如页面是服务端组件，只把"点赞按钮"做成客户端组件。原理和序列化规则见 [Server Components](/basics/react/11-server-components)。

### 数据获取的变化

```jsx
// pages/posts/[id].jsx：Pages Router，数据在页面组件之外获取
export async function getServerSideProps({ params }) {
  const post = await getPost(params.id)
  return { props: { post } }
}

export default function PostPage({ post }) {
  return <Article post={post} />
}
```

```jsx
// app/posts/[id]/page.jsx：App Router，组件本身就是 async 函数
export default async function PostPage({ params }) {
  const { id } = await params
  const post = await getPost(id) // 可以直接查库，不用先写接口
  return <Article post={post} />
}
```

数据获取放回了组件里，哪个组件需要数据就在哪里取。layout 和 page 都要用户信息时各自调用即可：同一次渲染中相同的 `fetch` 请求会自动去重，直接查库的函数可以用 React 的 `cache` 包一层达到同样的效果。数据是每次请求都取，还是缓存起来、多久更新，由缓存配置决定，见 [Next.js 的缓存](/basics/ssr/05-next-caching)。

### 嵌套布局和流式加载

- **布局保留状态**：从 `/dashboard` 切到 `/dashboard/settings`，只请求和替换变化的那一段，共享的 layout 不重新渲染，里面的输入框内容、客户端组件的 state 都还在。需要每次切换都重新挂载时用 `template` 文件
- **流式加载**：`loading` 文件相当于给 page 包了一层 `<Suspense>`，服务端先发出布局和加载状态，页面数据到了再流式补上；导航时加载状态已被预取，点击后立即显示。原理见 [流式 SSR](/basics/ssr/03-streaming-ssr)

### 共存和逐步迁移

`app` 目录被设计成可以和 `pages` 目录同时工作，迁移可以一页一页来：

1. 新建 `app/layout.tsx` 根布局；迁移期间保留 `_app`、`_document`，因为 app 里的布局和全局样式对 pages 下的页面不生效
2. 迁移某个页面时，先把原来的页面组件原样标记为客户端组件，再新建 `page.tsx`（服务端组件）负责取数据并传给它，跑通后再把不需要交互的部分逐步改成服务端组件
3. `next/router` 换成 `next/navigation` 的 Hook，`next/head` 换成 Metadata API，Context Provider 挪到客户端组件里

两套路由之间跳转是一次完整的页面加载（硬导航），`next/link` 也不会跨路由系统预取，所以关联紧密的页面最好一起迁移。

## 面试官可能追问

::: details 在 App Router 里，全局的 Context Provider 放在哪？
Provider 要用到 Context 和 state，必须是客户端组件。单独建一个 `providers.tsx`，顶部写 `'use client'`，接收 children 并包上各个 Provider，然后在根布局里使用。children 是服务端组件渲染好的结果，被客户端组件包着也仍然是服务端组件，不会因此全部变成客户端代码。
:::

::: details 为什么不建议在 layout 里做登录校验？
layout 在页面切换时不会重新渲染，用户在同一个布局下跳转，校验就不会再执行；layout 也挡不住子路由段的渲染，子页面照样会执行、出现在返回的数据里。校验应该放在离数据近的地方，比如统一的数据访问层、每个 Server Action 内部，再用 Proxy（以前叫 Middleware）做一层提前跳转，见 [SSR 的登录态](/basics/ssr/10-ssr-auth)。
:::

::: details 'use client' 的组件会在服务端运行吗？
会。客户端组件在首次请求时同样会在服务端预渲染成 HTML，再到浏览器里水合，和 Pages Router 的页面一样。所以客户端组件的渲染逻辑里也不能直接访问 `window`、`localStorage`，要放进 `useEffect`。`'use client'` 的意思是"这段代码要下发到浏览器"，不是"只在浏览器执行"。
:::

::: details 已有的 Pages Router 项目有必要迁移吗？
不是必须的，Pages Router 仍然可以正常使用。值得迁移的情况：页面很重、想减少客户端 JS；需要嵌套布局、流式加载、Server Actions 等能力，这些新特性主要在 App Router 上提供。迁移成本在于心智模型的变化，以及依赖库是否兼容服务端组件（比如运行时注入样式的 CSS-in-JS 库）。可以先在新页面上用 App Router，老页面按需迁移。
:::

## 易错点

- 在服务端组件里用 `useState`、`onClick` 或浏览器 API，会直接报错，要拆出客户端组件
- 在 app 目录里从 `next/router` 导入 `useRouter`，应该从 `next/navigation` 导入，而且它不再返回 pathname 和 query
- 以为 layout 每次导航都会重新执行，在里面读查询参数或做权限校验
- `'use client'` 加在顶层组件上，导致整棵组件树变成客户端代码
