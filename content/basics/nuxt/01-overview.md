---
difficulty: 1
tags: [高频, 对比]
---

# Nuxt 是什么？和直接用 Vue 写单页应用相比解决了哪些问题？

::: tip 一句话回答
Nuxt 是基于 Vue 的**全栈框架**。直接用 Vue 写单页应用，首屏白屏、SEO 差，路由、构建、服务端都要自己搭。Nuxt 用约定把这些补齐：**文件路由和布局**、**服务端渲染、预渲染和按路由混合渲染**、**自动导入**、**对 SSR 友好的数据获取**（服务端取到的数据进 payload，水合时不再请求），再加上 **Nitro 服务端引擎**，同一个项目里写接口，能部署到 Node、Serverless、边缘或静态托管。代价是要理解代码在两端执行，并遵守框架约定。
:::

## 详细解析

### 纯 Vue 单页应用的痛点

用 Vite 加 Vue 起一个 SPA，服务器只返回一个几乎空的 HTML，页面要等 JS 下载、执行、请求接口后才出现内容：

- **首屏慢**：白屏时间取决于 JS 体积和接口速度，弱网下更明显
- **SEO 和分享卡片差**：爬虫和社交平台拿到的 HTML 里没有正文和 meta
- **工程配置全靠自己**：路由表、代码分割、SSR、接口层、部署方式都要手动搭，团队之间写法各不相同

自己给 Vue 搭 SSR 也能做到，但要处理服务端入口、客户端入口、数据预取、状态序列化、水合等细节，原理见 [Vue 的 SSR 和水合](/basics/vue/18-ssr-hydration)。Nuxt 把这套东西做成了默认行为。

### Nuxt 提供了什么

| 能力 | 解决的问题 |
| --- | --- |
| 文件路由、布局 | `app/pages` 下的文件自动生成路由，`app/layouts` 放布局，不用手写路由表 |
| 多种渲染方式 | 默认服务端渲染加水合；可以整站预渲染，也可以用 `routeRules` 按路由选择 SSR、纯客户端、预渲染或缓存 |
| 自动导入 | Vue API、Nuxt composables、自己的 composables 和组件不用写 import，构建时按需补上 |
| SSR 友好的数据获取 | `useFetch`、`useAsyncData` 在服务端取数，结果写进 payload，客户端水合时直接复用 |
| Nitro 服务端 | `server/` 目录写接口和服务端中间件，构建产物不依赖 Nuxt 运行时，通过不同 preset 部署到多种平台 |
| 模块和 layers | 模块生态一行接入（如 Pinia、图片、i18n）；layers 在多个项目之间复用页面、组件和配置 |
| SEO 工具 | `useHead`、`useSeoMeta` 管理 title 和 meta，服务端渲染时直接输出到 HTML |

数据获取的细节见 [useFetch、useAsyncData 和 $fetch 的区别](/basics/ssr/07-nuxt-data-fetching)。

### 一个最小的 Nuxt 页面

```vue
<!-- app/pages/posts/[id].vue，自动对应 /posts/:id -->
<script setup lang="ts">
const route = useRoute()
// 服务端请求一次，结果进入 payload，客户端水合时不再请求
const { data: post } = await useFetch(`/api/posts/${route.params.id}`)

useSeoMeta({ title: () => post.value?.title })
</script>

<template>
  <article v-if="post">
    <h1>{{ post.title }}</h1>
    <p>{{ post.content }}</p>
  </article>
</template>
```

```ts
// server/api/posts/[id].ts，自动对应 /api/posts/:id
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  return { id, title: `文章 ${id}`, content: '...' }
})
```

整个过程没有写路由表、没有 import、没有单独起后端，前后端在一个仓库里共享类型。

### 代价

- **要理解执行环境**：页面代码在服务端和客户端各跑一次，`window`、`localStorage` 不能在服务端直接用，模块顶层的状态会在请求之间共享
- **要遵守约定**：目录名、文件命名、composable 的调用位置都有规则，违反了会报错或行为异常
- **部署更复杂**：SSR 需要一个运行时（Node 或 Serverless），不像纯静态 SPA 扔到 CDN 就行；不需要 SSR 时可以预渲染或关掉 `ssr`

Nuxt 和 Next.js 的定位相似，一个基于 Vue，一个基于 React，可以对照 [Next.js 是什么](/basics/nextjs/01-overview) 一起看。

## 面试官可能追问

::: details 后台管理系统这种不需要 SEO 的项目，还有必要用 Nuxt 吗？
可以用，也可以不用。不要 SEO 时，SSR 的收益主要剩首屏速度。Nuxt 的文件路由、自动导入、server 目录写接口这些仍然有用，可以设 `ssr: false` 当 SPA 框架用；如果团队已经有成熟的 Vite + Vue 模板，直接用也没问题。
:::

::: details Nuxt 的 SSR 和预渲染有什么区别？
SSR 每次请求时在服务器上渲染 HTML，内容总是最新的，但需要服务器。预渲染在构建时把页面生成静态 HTML，部署到静态托管，访问最快，但内容只在重新构建时更新。Nuxt 可以用 `routeRules` 让部分路由预渲染、部分路由 SSR。
:::

::: details Nitro 和 Nuxt 是什么关系？
Nitro 是 Nuxt 使用的服务端引擎，也能独立使用。它负责 `server/` 目录下的接口和中间件，以及把整个应用打包成适合目标平台的产物（Node 服务、Serverless 函数、边缘函数等）。Nuxt 负责 Vue 应用部分，渲染页面也是作为 Nitro 里的一个处理器运行的。
:::

## 易错点

- 以为 Nuxt 只是"Vue 的 SSR 方案"。它同时管路由、构建、接口、部署，SSR 可以关掉
- 以为自动导入是全局变量。实际是构建时补上 import，没用到的不会打包
- 在页面里直接用 `$fetch` 取初始数据，服务端和客户端会各请求一次，应该用 `useFetch` 或 `useAsyncData`
- 以为用了 SSR 就不用关心客户端性能。水合仍要下载并执行全部组件代码，JS 体积大照样影响可交互时间
