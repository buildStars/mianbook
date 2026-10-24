---
difficulty: 3
tags: [性能优化, 场景题]
---

# Nuxt 页面的 HTML 很大、首屏变慢，怎么排查是不是 payload 太大？怎么优化？

::: tip 一句话回答
服务端渲染时，`useFetch`、`useAsyncData` 的结果和 `useState` 的状态会被**序列化成 payload，塞进 HTML** 一起发给浏览器，客户端水合时直接用。接口返回多少，payload 就带多少，**每个页面都背着一份全站共用的大数据**是最常见的原因。排查看页面源码里的 `__NUXT_DATA__` 有多大、DevTools 的 Payload 标签页里哪个 key 最大；优化靠 **`pick` / `transform` 裁剪字段**、共用数据改成客户端单独请求并长期缓存、不影响首屏的数据用 **`server: false`**。注意 `lazy: true` 不会减小 payload。
:::

## 详细解析

### payload 是什么

服务端渲染出 HTML 之后，客户端要接管页面，就得知道服务端用了哪些数据。Nuxt 把这些数据序列化后放进页面：

- `data`：`useFetch` / `useAsyncData` 的结果，按 key 存放
- `state`：`useState` 的状态
- 还有 runtimeConfig 的公开部分、错误信息，以及插件自己写入的 key

在 HTML 里它是一个 `<script type="application/json" id="__NUXT_DATA__">`，用 devalue 序列化，能保留 Date、Map、Set、ref 这类类型。客户端水合时直接读它，不用再请求一次接口，详见 [useFetch、useAsyncData 和 $fetch 的区别](/basics/ssr/07-nuxt-data-fetching)。

代价是：服务端拿到的每一份数据，HTML 里都要原样带一份。数据大了，HTML 下载、解析、反序列化都变慢，首屏和可交互时间一起拖后。

### 怎么排查

1. **看 HTML 体积**：浏览器 Network 面板里看文档请求的大小，打开源码找 `__NUXT_DATA__`，看它占了多少
2. **找出最大的 key**：Nuxt DevTools 的 Payload 标签页，或者在页面代码里临时打印 `useNuxtApp().payload.data`，看有哪些 key、各有多大
3. **看开发环境的提示**：较新的版本里，开发时 payload 超过 100 KB 会给出诊断，列出体积最大的几个 key，并建议用 `pick` 或 `transform`

一个真实的例子：某站点把几百个条目的完整目录放进了全局状态，每个页面的 payload 都带着它。改成客户端单独请求后，单个页面的 HTML 从四百多 KB 降到八十多 KB。

### 怎么优化

| 手段 | 作用 |
| --- | --- |
| `pick` / `transform` | 只保留页面用到的字段。数据仍然会被请求，只是不进 payload |
| `server: false` | 只在客户端请求，服务端不执行，数据不进 payload。首屏要等水合后才请求 |
| 共用数据单独请求 | 全站共用、不常变的数据（目录树、配置）改成客户端请求一个可以长期缓存的接口，URL 带内容版本号 |
| `payloadExtraction` | 预渲染或缓存的页面，把 payload 拆到单独的 `_payload.json`，可以被 CDN 缓存 |
| 懒加载、懒水合 | 页面下方的大组件推迟加载和水合，见 [懒水合](/basics/nuxt/19-lazy-hydration) |
| `nuxt analyze` | 分析 JS 打包体积。它看的是 bundle，不是 payload，两者要分开排查 |

`pick` 只取顶层字段，结果是数组时要用 `transform`：

```ts
// ❌ 接口返回的整个列表，每项几十个字段，全部进 payload
const { data } = await useFetch('/api/articles')

// ✅ 只保留列表页用到的字段
const { data } = await useFetch('/api/articles', {
  transform: (list) => list.map(({ id, title, slug }) => ({ id, title, slug })),
})

// ✅ 首屏不需要的推荐列表：只在客户端请求，不进 payload
const { data: related, status } = useFetch('/api/related', { server: false })
```

### payloadExtraction 的几个取值

它只对预渲染页面和开了缓存（ISR / SWR）的页面起作用：

- `true`：首屏和客户端导航都用单独的 `_payload.json`，HTML 更小，代价是首屏多一个请求
- `'client'`：首屏 payload 仍然内联在 HTML 里，只有客户端导航时才用 `_payload.json`
- `false`：不拆，始终内联

默认值和 `compatibilityVersion` 有关，以所用版本的文档为准。

## 面试官可能追问

::: details 设置 lazy: true 能减小 payload 吗？
不能。`lazy` 只是不阻塞路由导航，服务端照样会等请求完成，再把数据序列化进 payload。想让数据不进 payload，用 `server: false`，让请求只在客户端发。较新的版本还有 `serialize: false`，结果不存进 payload，如果组件用到了这份数据，客户端会在水合后重新请求。
:::

::: details pick 能减少后端的查询量吗？
不能。`pick` 和 `transform` 在拿到响应之后才执行，接口照样返回完整数据，服务端到接口这一段的开销不变，它们只减少传给浏览器的部分。想从源头减少，要让接口支持按需返回字段，或者为页面单独写一个精简的接口。
:::

::: details 全站共用的数据放进 useState，为什么也会让每个页面变大？
`useState` 的值也在 payload 里，而且每个页面的 HTML 都有一份自己的 payload，不会在页面之间共享缓存。几十 KB 的目录放在 `useState` 里，每个页面的 HTML 都多出这几十 KB。改成客户端请求一个带版本号的接口，浏览器缓存一次，所有页面复用。
:::

::: details 改成客户端请求后，搜索引擎还能看到这些内容吗？
看不到服务端 HTML 里的这部分了。所以要分清楚：页面主体内容、需要被收录的内容留在服务端渲染，只裁剪字段；导航目录、推荐列表这类辅助内容才适合挪到客户端。
:::

## 易错点

- 以为 `lazy: true` 能减小 payload。它只影响导航是否等待，数据照样序列化进 HTML
- 以为 `pick` 会减少接口返回的数据量，它只减少进 payload 的部分
- 用 `nuxt analyze` 排查 HTML 太大。它分析的是 JS 包，payload 要看页面源码或 DevTools
- 把 `useFetch` 拿到的整个接口响应原样渲染，嵌套对象里大量用不到的字段全进了 payload
