---
difficulty: 2
tags: [实践]
---

# Nuxt 怎么做 SEO？useHead、useSeoMeta 和 definePageMeta 有什么区别？

::: tip 一句话回答
Nuxt 做 SEO 的基础是 **SSR 把正文和 head 一起渲染进 HTML**。head 的写法分三层：nuxt.config 的 **`app.head` 只能写静态内容**；**`useHead`** 由 Unhead 驱动，支持响应式数据，能写任意标签；**`useSeoMeta`** 用扁平对象写 meta，有类型检查。**`definePageMeta` 是路由元信息**（layout、middleware 等），构建时提取，不是用来写 head 的。
:::

## 详细解析

### 为什么 SSR 是前提

爬虫拿到的是服务端返回的 HTML。Nuxt 默认通用渲染，页面正文、`<title>`、description、Open Graph 标签都在首屏 HTML 里。如果某个路由用 `ssr: false` 改成纯客户端渲染，HTML 里只有一个空壳，标题和 meta 要等 JS 执行后才出现，不执行 JS 的爬虫和社交平台的卡片抓取都拿不到。所以要做 SEO 的页面不要关 SSR。通用的 SEO 知识见 [前端能为 SEO 做什么](/basics/html/10-seo)。

### app.head：全站静态默认值

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      link: [{ rel: 'icon', href: '/favicon.ico' }],
    },
  },
})
```

这里只能写静态值，不支持响应式数据。Nuxt 默认已经带上 `charset`（`utf-8`）和 `viewport`（`width=device-width, initial-scale=1`），需要时用同名键覆盖。

### useHead：通用、响应式

`useHead` 能写 title、meta、link、script、htmlAttrs 等任意 head 内容，参数可以是 ref、computed、getter，数据变了 head 跟着更新。

`titleTemplate` 用来统一标题格式，`%s` 是页面标题的占位符。函数写法不能放进 nuxt.config（配置要序列化），一般写在 `app.vue` 里。

内容来自用户输入时，用 **`useHeadSafe`**，它只允许安全的属性，避免把用户内容原样插进 head。

### useSeoMeta：写 meta 的推荐方式

meta 标签有的用 `name`（description），有的用 `property`（og:title），手写容易混。`useSeoMeta` 用扁平的驼峰键（`description`、`ogTitle`、`ogImage`、`twitterCard`），由框架决定生成哪种属性，键写错了 TypeScript 会报错。

只在服务端需要的 meta（爬虫才看，页面交互后不会变的），可以包在 `if (import.meta.server)` 里调用 `useSeoMeta`，少一点客户端开销。以前专门的 `useServerSeoMeta` 已弃用。

模板里也可以用 `<Title>`、`<Meta>`、`<Link>` 等组件，首字母大写，避免和原生标签冲突。

### definePageMeta 不是写 head 的

`definePageMeta` 声明的是路由元信息：用哪个 layout、跑哪些中间件、路由别名等。它是编译宏，**构建时从页面里提取出来**，所以只能写静态值，不能引用组件里的响应式数据。

可以在里面放一个静态的 `title`，再在 layout 里用 `useRoute().meta.title` 配合 `useHead` 输出，但动态标题（例如文章标题）必须在页面里用 `useHead` 或 `useSeoMeta`。

### 其他 SEO 工作

sitemap、robots.txt、Open Graph 图片生成、结构化数据，一般用社区模块完成，不用手写。动态页面的数据要用 `useFetch` 或 `useAsyncData` 获取，才能在服务端渲染时就有内容，见 [Nuxt 数据获取](/basics/ssr/07-nuxt-data-fetching)。

## 代码示例

```vue
<!-- app/pages/posts/[slug].vue -->
<script setup lang="ts">
definePageMeta({ layout: 'article' }) // 路由元信息，静态

const route = useRoute()
const { data: post } = await useFetch(`/api/posts/${route.params.slug}`)

// 响应式 getter：数据回来后标题和描述跟着变
useSeoMeta({
  title: () => post.value?.title ?? '文章',
  description: () => post.value?.summary,
  ogTitle: () => post.value?.title,
  ogImage: () => post.value?.cover,
  twitterCard: 'summary_large_image',
})
</script>
```

```vue
<!-- app/app.vue：函数形式的 titleTemplate -->
<script setup lang="ts">
useHead({
  titleTemplate: (title) => (title ? `${title} - Acme 博客` : 'Acme 博客'),
})
</script>
```

## 面试官可能追问

::: details useHead 和 useSeoMeta 应该怎么分工？
meta 标签用 `useSeoMeta`，有类型检查，不会把 name 和 property 写混。title 以外的 link、script、htmlAttrs、bodyAttrs 这些非 meta 内容用 `useHead`。两者可以在同一个页面同时使用。
:::

::: details 为什么 definePageMeta 里不能用 useFetch 拿到的数据？
`definePageMeta` 是编译宏，构建时就从页面里提取出来，和组件运行时的作用域是分开的，引用不到运行时的变量。动态内容要在 setup 里用 `useHead` 或 `useSeoMeta`。
:::

::: details 多个组件都设置了 title，最后显示哪个？
Unhead 会把各个组件的调用合并起来，title、同名 meta 这类标签会去重，只输出一个。常见做法是全站默认值放 app.vue，层级更深的页面再设置自己的值去覆盖；配合 `titleTemplate`，页面只需要给出自己的标题。
:::

## 易错点

- 在 nuxt.config 的 `app.head` 里写动态标题，它只支持静态值
- 把 `titleTemplate` 的函数写进 nuxt.config，函数应该放在 `app.vue` 里
- 把 `definePageMeta` 当成设置 head 的 API，它只管路由元信息，而且只能写静态值
- 需要被收录的页面用了 `ssr: false`，HTML 里没有正文和 meta
