---
difficulty: 2
tags: [原理, 实践]
---

# Nuxt 的错误处理是怎样的？createError、showError、error.vue 和 NuxtErrorBoundary 怎么配合？

::: tip 一句话回答
**`createError`** 创建带状态码的错误：在服务端抛出时，页面请求显示**全屏错误页**，接口请求返回 **JSON**；在客户端抛出默认**不致命**，要加 `fatal: true` 才显示错误页。错误页由和 `app.vue` 同级的 **`error.vue`** 渲染，用 **`clearError`** 清除。局部的客户端错误用 **`NuxtErrorBoundary`** 兜住，不影响整页。
:::

## 详细解析

### createError 的参数

```ts
throw createError({
  status: 404, // 状态码，默认 500
  statusText: 'Not Found', // 简短的 HTTP 文本，只能是 ASCII
  message: '文章不存在', // 详细说明，中文写这里
  data: { slug }, // 附带的自定义数据
  fatal: true, // 客户端抛出时是否显示全屏错误页
  // cause：原始错误，只在开发环境暴露给错误页
})
```

- 只传字符串时，它会被当作 `message`，状态码是 500
- 旧代码里常见的 `statusCode`、`statusMessage` 已经标为弃用，新代码写 `status`、`statusText`
- `cause` 在生产环境不会出现在错误页里，避免把内部堆栈暴露给用户

### 在哪里抛，结果不同

| 位置 | 结果 |
| --- | --- |
| 服务端渲染页面时（setup、中间件、插件） | 任何未处理错误都是致命的，返回全屏错误页 |
| `server/api` 接口 | 返回 JSON 错误响应 |
| 客户端（点击事件、客户端导航后） | 默认不致命，只有 `fatal: true` 才显示错误页 |
| 客户端启动阶段（插件、挂载） | 未处理的错误也会进入错误页 |

接口里有个坑：主动抛出的 `createError`，生产环境会在 JSON 里返回 `message` 和 `data`；但**未处理的异常**（代码里意外抛出的普通错误）或带 `fatal: true` 的错误，`message` 会被替换成 "Server Error"、`data` 被去掉，避免泄露内部信息。所以想让前端拿到原因，要主动抛 `createError`，结构化信息放 `data`。官方文档也建议把给前端看的信息放进 `statusText` 或 `data`，不要依赖 `message`，以后服务端引擎升级时更稳。用 `useFetch` 调用时，自定义数据在 `error.value.data.data` 里。

### showError、clearError、useError

- `showError(err)`：主动显示全屏错误页，客户端任何地方都能调用。文档更推荐直接 `throw createError()`
- `clearError({ redirect })`：清除错误状态，可以顺带跳转，例如回首页
- `useError()`：拿到当前的全局错误，没有错误时为空

### error.vue：全屏错误页

`error.vue` 放在 `app/` 目录、和 `app.vue` 同一级。它**不是路由**，不放在 `pages/` 里。组件通过 prop `error` 拿到错误对象（类型 `NuxtError`）。

错误页是一次独立的页面加载，路由中间件会重新执行。如果中间件里有重定向逻辑，要用 `useError()` 判断当前是否在显示错误，避免把错误页也重定向掉。

### NuxtErrorBoundary：局部兜底

`NuxtErrorBoundary` 包住一块区域，里面的组件出错时只替换这一块，页面其余部分照常工作。它**只处理客户端错误**，底层基于 Vue 的 `onErrorCaptured`：

- `#error` 插槽拿到 `error` 和 `clearError`，可以显示提示和"重试"按钮
- 也可以监听 `@error` 事件上报日志
- 路由切换后错误自动清除

适合评论区、推荐列表、第三方小组件这类出错了也不该拖垮整页的区域。

### 全局钩子

- `vue:error`：Vue 错误冒泡到顶层时触发
- `app:error`：应用启动阶段的错误（插件、SSR 渲染、挂载等）
- `app:error:cleared`：调用 `clearError` 时触发
- `vueApp.config.errorHandler`：接收所有 Vue 错误，包括已经被处理的，适合接入监控上报

## 代码示例

```vue
<!-- app/error.vue -->
<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()
const goHome = () => clearError({ redirect: '/' })
</script>

<template>
  <main>
    <h1>{{ props.error.status === 404 ? '页面不存在' : '出错了' }}</h1>
    <button @click="goHome">回到首页</button>
  </main>
</template>
```

```vue
<!-- 页面里局部兜底 -->
<template>
  <article>正文……</article>
  <NuxtErrorBoundary @error="(e) => console.error(e)">
    <CommentList />
    <template #error="{ error, clearError }">
      <p>评论加载失败：{{ error.message }}</p>
      <button @click="clearError">重试</button>
    </template>
  </NuxtErrorBoundary>
</template>
```

## 面试官可能追问

::: details 页面里查不到文章，怎么返回真正的 404 状态码？
在页面 setup 里数据为空时 `throw createError({ status: 404, statusText: 'Not Found', fatal: true })`。服务端渲染时这会让响应状态码变成 404 并显示错误页，爬虫不会把它当成正常页面收录。客户端导航时有 `fatal: true` 才会切到错误页。
:::

::: details NuxtErrorBoundary 能兜住服务端渲染时的错误吗？
不能。它只处理客户端错误。服务端渲染时出现未处理的错误，整页都会走 error.vue。要让某块内容在服务端出错时不影响整页，需要在数据获取层自己处理错误，例如用 `useFetch` 返回的 `error` 判断后渲染降级内容。
:::

::: details 错误监控应该挂在哪里？
写一个客户端插件，在 `vueApp.config.errorHandler` 和 `vue:error`、`app:error` 钩子里上报；服务端接口的错误不经过这些钩子，要在接口代码里捕获后记录，或者写一个 Nitro 插件监听 `error` 钩子统一上报。注意上报前过滤掉 404 这类预期内的错误。
:::

## 易错点

- 在接口里直接 `throw new Error(...)`，以为前端能拿到原因，生产环境只会返回 500 和 "Server Error"，要用 `createError` 并把信息放进 `message` 或 `data`
- 客户端抛 `createError` 不加 `fatal: true`，然后奇怪为什么没有出现错误页
- 把 `error.vue` 放进 `pages/` 当成路由，它应该和 `app.vue` 同级
- 以为 `NuxtErrorBoundary` 能处理服务端错误，它只管客户端
