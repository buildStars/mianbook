---
difficulty: 3
tags: [原理]
---

# Vue 的 SSR 和水合（hydration）是什么？

::: tip 一句话回答
**SSR**（服务端渲染）是在服务端把组件渲染成 HTML 字符串返回给浏览器，用户不用等 JS 下载执行完就能看到内容，首屏更快，对 SEO 也更友好。**水合**是浏览器加载 JS 后，Vue 不重新创建 DOM，而是复用服务端渲染出的 DOM，给它绑定事件、建立响应式，让页面变得可交互。服务端和客户端的渲染结果不一致时会出现**水合不匹配**，要尽量避免。
:::

## 详细解析

### 渲染流程

1. 服务端为每个请求创建一个新的应用实例，用 `renderToString` 渲染出 HTML，渲染过程中会执行组件的 `setup`、预取数据
2. 浏览器收到 HTML 后马上就能显示内容，但这时页面还不能交互
3. 客户端 JS 加载完成后，Vue 在浏览器中用同样的组件再执行一遍渲染逻辑，但不创建新的 DOM，而是和已有的 DOM 节点逐个对照并接管它们：绑定事件监听、建立响应式，这一步就是水合
4. 水合完成后，页面就和普通的 SPA 一样运行

```js
// app.js：服务端和客户端共用，导出工厂函数，每次调用都创建新的应用实例
import { createSSRApp } from 'vue'
import App from './App.vue'

export function createApp() {
  return createSSRApp(App)
}
```

```js
// server.js：以 Express 为例
import express from 'express'
import { renderToString } from 'vue/server-renderer'
import { createApp } from './app.js'

const server = express()
server.get('/', async (req, res) => {
  const html = await renderToString(createApp())
  res.send(`<!DOCTYPE html><div id="app">${html}</div><script type="module" src="/client.js"></script>`)
})
server.listen(3000)
```

```js
// client.js：createSSRApp 创建的应用在挂载时会进行水合，而不是重新创建 DOM
import { createApp } from './app.js'

createApp().mount('#app')
```

真实项目中这些代码还要经过 Vite 等工具构建，一般直接使用 Nuxt。

### 优点和代价

- **优点**：首屏内容更早显示，LCP 等指标更好，详见 [Core Web Vitals](/basics/browser/09-web-vitals)；搜索引擎直接拿到完整的 HTML，对 SEO 友好
- **代价**：每个请求都要在服务端渲染，服务器压力和运维成本更高；代码要同时兼容 Node 和浏览器两个环境，开发复杂度更高；内容显示出来之后，还要等 JS 加载并完成水合才能交互

### 写 SSR 代码的注意点

- **生命周期**：服务端只执行 `setup`（选项式 API 中是 `beforeCreate`、`created`）、`onServerPrefetch` 等少数钩子，`onMounted`、`onUpdated` 等不会执行
- **浏览器 API**：服务端没有 `window`、`document`，访问它们的代码要放到 `onMounted` 中
- **需要清理的副作用**：不要在 `setup` 顶层创建定时器。服务端不会执行卸载钩子，定时器永远不会被清除
- **跨请求状态污染**：Node 服务是长期运行的进程，模块顶层创建的单例会被所有请求共享。每个请求都要创建新的应用、router 和 pinia 实例，避免一个用户的数据出现在另一个用户的页面上

### 水合不匹配

服务端和客户端渲染出的结果不一致，就是水合不匹配。常见原因：

- 渲染了当前时间、随机数，或者两端时区不同导致日期格式化的结果不同
- 渲染结果依赖只在浏览器端存在的数据，比如 `localStorage` 中的值、窗口宽度
- HTML 嵌套不合法，比如在 `<p>` 里放 `<div>`：浏览器解析服务端返回的 HTML 时会自动修正结构，和 Vue 预期的结构对不上

发生不匹配时，Vue 会给出警告并尝试修复，比如改写文本，或者丢弃对不上的节点再重新创建。这会带来性能损失，还可能导致页面闪烁。

避免的方法：

- 只能在客户端确定的内容，放到 `onMounted` 之后再渲染，或者用 `<ClientOnly>` 之类的组件包裹（Nuxt 和 VitePress 都内置了这个组件）
- 两端需要一致的数据在服务端生成，序列化到 HTML 中，客户端直接复用，不要重新生成；需要唯一 id 时，用 Vue 3.5 起提供的 `useId()`
- Vue 3.5 起，可以给元素加上 `data-allow-mismatch` 属性，声明预期之内的不匹配，Vue 就不再警告；还可以用属性值限定类型，如 `data-allow-mismatch="text"`

Vue 3.5 起还支持异步组件的**懒水合**：通过 `defineAsyncComponent` 的 `hydrate` 选项指定策略，如 `hydrateOnVisible()`（进入视口时水合）、`hydrateOnIdle()`（浏览器空闲时水合），推迟非关键组件的水合。

### SSG 和 Nuxt

- **SSG**（静态站点生成）：在构建时就把页面预渲染成 HTML 文件，部署成静态资源，浏览器加载后同样要水合。适合文档、博客这类内容不常变的站点。本手册使用的 VitePress 就是 SSG
- **Nuxt**：基于 Vue 的框架，封装了 SSR、SSG、数据预取、状态传递等细节，还可以为不同的路由选择不同的渲染方式

## 面试官可能追问

::: details SSR 和 SSG 怎么选？
看页面内容是否依赖每一次请求。所有人看到的内容都一样、更新不频繁的页面（文档、博客、官网）用 SSG：构建一次，部署到 CDN，成本最低。内容因人而异或者实时变化的页面用 SSR。后台管理系统这类不需要 SEO、对首屏要求不高的项目，用普通的 SPA 就够了。Nuxt 支持在一个项目中按路由混合使用。
:::

::: details 如何避免水合不匹配？
- 保证两端渲染时用的是同一份数据：接口数据在服务端获取后随 HTML 传给客户端，不要在客户端重新请求或重新生成
- 时间、随机数、`localStorage`、窗口尺寸这类只在客户端确定的内容，挂载之后再渲染，或者用 `<ClientOnly>` 包裹
- 写合法的 HTML 嵌套
- 确实无法避免、也不影响功能的差异，用 `data-allow-mismatch` 声明（Vue 3.5 起）
:::

::: details 流式 SSR 有什么好处？
`renderToString` 要等整个页面渲染完才能返回。流式渲染（如 `renderToNodeStream`、`renderToWebStream`）边渲染边发送，浏览器能更早拿到已经渲染好的部分 HTML，提前开始解析页面、加载 CSS 和 JS 等资源，首字节时间也更短。代价是响应头发出之后，如果渲染中途出错，就不能再修改状态码或者重定向了。
:::

## 易错点

- SSR 让内容更早**显示**，但页面要等水合完成后才能**交互**，两者不是同一个时间点
- `onMounted` 不会在服务端执行，直接在 `setup` 中访问 `window`、`document` 会在服务端报错
- 生产环境默认只在控制台报一句 `Hydration completed but contains mismatches.`，不会指出具体位置。排查要在开发环境中进行，或者在构建时开启 `__VUE_PROD_HYDRATION_MISMATCH_DETAILS__` 标志
