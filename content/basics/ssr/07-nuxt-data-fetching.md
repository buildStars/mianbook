---
difficulty: 2
tags: [对比, 实践]
---

# Nuxt 里 useFetch、useAsyncData 和 $fetch 有什么区别？

::: tip 一句话回答
三者不在同一个层次。**`$fetch`** 只是一个请求函数（基于 ofetch），在哪里调用就在哪里发请求，在页面 setup 里直接用，服务端渲染时请求一次，客户端水合时又请求一次。**`useAsyncData`** 包装任意异步函数：服务端执行后把结果放进页面的 **payload** 随 HTML 下发，客户端水合时直接复用、不再请求，并用 **key** 去重和缓存，相同 key 的调用共享同一份数据。**`useFetch`** 是 `useAsyncData` 加 `$fetch` 的简写，根据 URL 自动生成 key，URL 和 query 可以是响应式的，变化后自动重新请求。规则很简单：**组件的初始数据用 useFetch / useAsyncData，点击、提交这类事件里用 $fetch**。
:::

## 详细解析

### 为什么 $fetch 会请求两次

Nuxt 的页面代码在服务端和客户端各执行一次。`$fetch` 没有把服务端结果传给客户端的机制，所以：

```vue
<script setup lang="ts">
// ❌ 服务端渲染时请求一次，客户端水合时又请求一次
const posts = await $fetch('/api/posts')

// ✅ 服务端请求后结果进入 payload，客户端水合时直接复用
const { data: posts2 } = await useFetch('/api/posts')
</script>
```

重复请求不只是浪费：两次请求之间数据变了，客户端渲染的结果就和服务端 HTML 对不上，造成[水合不匹配](/basics/ssr/02-hydration-mismatch)，还会推迟可交互的时间。另外，服务端渲染时用 `$fetch` 请求本应用的 `server/api` 接口，Nuxt 会直接调用对应的处理函数，不会真的发一次 HTTP 请求。

### useAsyncData：key 和 payload

```vue
<script setup lang="ts">
const route = useRoute()

// key 用 getter 写成和参数相关的，不同文章不会共用一份缓存，参数变了自动重新获取
const { data: post, status, error, refresh } = await useAsyncData(
  () => `post-${route.params.id}`,
  () => $fetch(`/api/posts/${route.params.id}`),
)
</script>
```

- **payload**：服务端拿到的结果序列化后嵌进 HTML，客户端水合时按 key 取出来用，可以在 Nuxt DevTools 的 Payload 面板里查看。序列化支持 Date、Map、Set 等类型，比 JSON 更完整
- **key**：第一个参数是 key（字符串、ref 或 getter）；不传时按调用位置自动生成，官方建议自己写。相同 key 的多个调用共享 `data`、`error`、`status`，所以 handler、`transform`、`pick`、`default` 这些选项要保持一致
- **适用场景**：数据不是来自一个 URL 时，比如调用 CMS 或第三方 SDK 的查询方法，或者用 `Promise.all` 合并多个请求
- handler 只用来取数据，不要在里面做副作用（比如调用 Pinia 的 action），需要只执行一次的副作用用 `callOnce`

### useFetch：简写加响应式参数

```vue
<script setup lang="ts">
const page = ref(1)
const keyword = ref('')

// query 里的 ref 变化时自动重新请求
const { data, status, error, refresh } = await useFetch('/api/posts', {
  query: { page, q: keyword },
  pick: ['items', 'total'], // 只把用到的字段放进 payload
})

// URL 本身依赖响应式值时，传 getter；写成模板字符串只会用初始值
const id = ref(1)
const { data: user } = await useFetch(() => `/api/users/${id.value}`)
</script>
```

`useFetch` 的 key 由 URL、请求选项和调用位置生成，两个组件请求同一个 URL 默认**各请求一次**；要共享数据，就传相同的 `key` 选项。

### 常用选项和返回值

| 选项 | 作用 |
| --- | --- |
| `lazy` | 客户端路由跳转时不等数据，页面先显示，用 `status` 处理加载中；`useLazyFetch`、`useLazyAsyncData` 是它的简写 |
| `server: false` | 只在客户端请求，首屏 HTML 里没有这份数据，适合不需要 SEO 的内容，如评论、推荐 |
| `immediate: false` | 先不请求，等手动调用 `execute()` |
| `watch` | 额外监听的响应式值，变化时重新请求；`watch: false` 关闭对响应式参数的自动监听 |
| `default` | `data` 的初始值，省去模板里对 undefined 的判断 |
| `pick`、`transform` | 裁剪、加工结果，减小 payload，但接口本身返回的数据量不变 |
| `dedupe` | 同一个 key 正在请求时又触发：默认 `cancel` 取消旧的，`defer` 则不发新请求 |

返回值：`data`、`error`、`status`（`idle`、`pending`、`success`、`error`）是 ref；`refresh` / `execute` 重新执行；`clear` 把 data 重置为 undefined 或默认值。

### 刷新和清除

- 组件内：调用返回的 `refresh()`
- 跨组件：`refreshNuxtData('posts')` 按 key 重新获取，不传参数则刷新全部；`clearNuxtData('posts')` 删除缓存的数据和错误，常用来让另一个页面下次进入时重新获取
- 典型流程：提交表单用 `$fetch` 发 POST，成功后 `refresh()` 列表

### 加载和错误

```vue
<script setup lang="ts">
// 不 await：页面立即显示，用 status 处理加载状态
const { data: comments, status, error, refresh } = useFetch('/api/comments', { lazy: true })
</script>

<template>
  <p v-if="status === 'pending'">评论加载中</p>
  <p v-else-if="error">加载失败 <button @click="refresh()">重试</button></p>
  <ul v-else>
    <li v-for="c in comments" :key="c.id">{{ c.text }}</li>
  </ul>
</template>
```

请求失败时 `useFetch` 不会抛异常，只会把错误写进 `error`。文章不存在这类情况想显示整页的错误页面，要在 setup 里判断 `data` 或 `error`，再用 `createError` 抛出。

## 面试官可能追问

::: details 在点击事件里调用 useFetch 有什么问题？
`useFetch`、`useAsyncData` 是 composable，要在 setup 顶层、插件或路由中间件里调用，它们依赖 Nuxt 的上下文，还会把结果登记到 payload。在事件回调里调用拿不到上下文，行为不可预期，每次点击还会创建新的响应式状态。事件里应该用 `$fetch`，完成后再 `refresh()` 相关的数据。
:::

::: details useFetch 要不要加 await？
加不加 await 都不影响服务端渲染的 HTML，服务端总会等数据回来再输出。区别在客户端：加了 await，路由跳转会等数据就绪才切换页面，之后的代码可以直接用 `data`；不加，页面立即切换，`data` 先是默认值，要自己处理加载状态，效果接近 `lazy`。注意 `lazy` 的请求即使 await 了，客户端跳转时也不会等数据。
:::

::: details 服务端渲染时，useFetch 会带上用户的 Cookie 吗？
请求相对路径时会。Nuxt 会用 `useRequestFetch` 把用户请求里的 Cookie 等请求头转发过去（不转发 host 这类头）。直接在 setup 里用 `$fetch` 则不会，要配合 `useRequestHeaders(['cookie'])` 手动传，详见 [SSR 的登录态](/basics/ssr/10-ssr-auth)。
:::

::: details 从别的页面跳回来，数据会重新请求吗？
普通的 SSR 页面默认会。`getCachedData` 的默认实现只在水合时从 payload 取数据，之后的客户端导航会重新执行请求；例外是预渲染或配置了 `isr`、`swr` 的路由，开启 payload 提取时客户端导航读取生成好的 `_payload.json`，不再调用接口。想复用已有数据，可以自定义 `getCachedData`，比如返回 `nuxtApp.payload.data[key]` 并自己判断是否过期；也可以用 `useNuxtData(key)` 先拿缓存的数据显示，再在后台刷新。
:::

## 易错点

- 在页面 setup 里直接 `await $fetch(...)` 获取初始数据，导致两端各请求一次
- 自己封装的 composable 里调用 `useAsyncData` 不传 key：自动 key 按调用位置生成，所有使用这个封装的地方位置相同，会共用一份数据
- URL 用模板字符串拼接 `id.value`，id 变了不会重新请求，要用 getter 或 query 参数
- `deep` 选项关闭时（当前文档里是默认值，旧版本默认开启），`data` 是浅层响应式的，直接修改它内部的属性不会触发更新，要整体替换或开启 `deep`
