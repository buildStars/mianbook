---
difficulty: 2
tags: [对比]
---

# Next.js 和 Nuxt 有什么区别？怎么选？

::: tip 一句话回答
最根本的区别是 **Next.js 基于 React，Nuxt 基于 Vue**，选型最先看团队技术栈。渲染模型上，Next.js 以**服务端组件**为核心，只有需要交互的部分才发 JS；Nuxt 以**整页 SSR 加水合**为主。服务端能力上，Nuxt 有独立的 **Nitro** 引擎，靠 preset 部署到很多平台；Next.js 用 Route Handlers、Server Functions 和 proxy，缓存用 `use cache` 显式声明。
:::

## 详细解析

### 渲染模型

**Next.js** 的 App Router 默认所有组件都是服务端组件：只在服务端运行，可以直接查数据库，代码不进客户端包。需要状态和事件的部分加 `'use client'` 变成客户端组件，只有这部分会水合。页面是"服务端组件树里嵌着客户端组件的岛"，详见 [Next.js 概览](/basics/nextjs/01-overview)。

**Nuxt** 的默认模式是通用渲染：整页在服务端渲染成 HTML，到了浏览器整页水合，同一份组件代码两端都跑。Nuxt 也有服务端组件和 islands（见 [Islands 架构](/basics/ssr/08-islands)），但不是主要用法。详见 [Nuxt 概览](/basics/nuxt/01-overview)。

这个差别决定了很多写法：Next.js 要时刻想清楚"这段代码在哪一侧运行"，Nuxt 更像写普通 Vue 组件，只需要注意哪些代码只能在服务端或客户端执行。

### 数据获取和写操作

| | Next.js | Nuxt |
| --- | --- | --- |
| 读数据 | 服务端组件里直接 `await` fetch 或数据库查询 | `useFetch`、`useAsyncData`，服务端拿到的数据放进 payload 交给客户端 |
| 缓存 | 开启 Cache Components 后用 `'use cache'` 显式声明，`cacheLife`、`cacheTag` 控制 | `routeRules` 按路由缓存，接口用 `defineCachedEventHandler` |
| 写数据 | Server Functions（`'use server'`），表单可以直接调用 | 一般在 `server/api` 写接口，前端用 `$fetch` 调用 |
| 失效 | `revalidateTag`、`updateTag`、`revalidatePath` | 清缓存存储，或让 swr 过期后后台刷新 |

Nuxt 的数据获取见 [useFetch 和 useAsyncData](/basics/ssr/07-nuxt-data-fetching)，Next.js 的缓存模型见 [Cache Components](/basics/nextjs/03-cache-components)。

### 混合渲染

两者都能让不同页面用不同的渲染策略，思路不同：

- **Next.js**：按组件粒度。构建时预渲染出静态外壳，能缓存的部分（`use cache`）进外壳，需要请求时数据的部分包在 `Suspense` 里流式补上。同一个页面里静态和动态可以混在一起
- **Nuxt**：按路由粒度。在 `routeRules` 里给路由配 `prerender`、`swr`、`isr`、`cache`、`ssr: false` 等规则，见 [渲染模式和 routeRules](/basics/nuxt/06-rendering-route-rules)

### 服务端和部署

- **Next.js**：接口用 Route Handlers（`route.ts`），请求前的拦截用 `proxy.ts`（旧版本叫 middleware）。`next start` 支持全部功能；多实例自托管时，要自己处理缓存共享（cacheHandler、cacheHandlers）、统一 Server Actions 加密密钥和 deploymentId，见 [Next.js 自托管](/basics/nextjs/13-self-hosting)
- **Nuxt**：服务端是独立的 Nitro 引擎，`server/api`、`server/routes`、`server/middleware` 按文件约定组织，见 [Nitro 服务端](/basics/nuxt/07-nitro-server)。构建时选 preset 就能输出 Node 服务或各个云平台需要的格式，产物在 `.output` 里，不依赖 node_modules

### 扩展方式

Nuxt 有一套框架级的扩展机制：[模块](/basics/nuxt/11-modules)在构建时运行，能注册组件、插件、接口；[Layers](/basics/nuxt/12-layers) 让多个项目继承同一套页面、组件和配置。Nuxt 还默认自动导入组件和 composables。

Next.js 没有对应的模块系统，生态主要是普通 npm 包加 `next.config` 配置，导入都要显式写。

## 对比一览

| 维度 | Next.js | Nuxt |
| --- | --- | --- |
| 底层框架 | React | Vue |
| 默认渲染 | 服务端组件 + 客户端组件 | 整页 SSR + 水合 |
| 读数据 | 服务端组件里直接 await | `useFetch`、`useAsyncData` |
| 写数据 | Server Functions | `server/api` 接口 |
| 缓存粒度 | 函数、组件级（`use cache`） | 路由级（`routeRules`）和接口级 |
| 服务端 | Route Handlers、proxy | Nitro（api、routes、middleware、plugins） |
| 部署 | `next start`、Docker、适配器 | Nitro preset |
| 扩展 | npm 包 + 配置 | 模块 + Layers |
| 自动导入 | 无 | 组件、composables、utils |

### 怎么选

1. **团队技术栈优先**。React 团队选 Next.js，Vue 团队选 Nuxt，框架迁移的成本远大于两者功能上的差异，见 [React 和 Vue 的区别](/basics/react/10-react-vs-vue)
2. **看是否需要服务端组件**。内容多、交互少、想尽量少发 JS 的页面，Next.js 的模型更有优势；交互密集的后台和应用，两者差别不大
3. **看部署环境**。要部署到多种平台或边缘环境，Nuxt 的 preset 省事；自托管 Next.js 多实例要多做一些缓存和密钥方面的配置
4. **看生态**。需要的 UI 库、第三方 SDK 在哪边更成熟

## 面试官可能追问

::: details Nuxt 能不能像 Next.js 一样减少发给浏览器的 JS？
可以部分做到。Nuxt 有服务端组件和 islands，只在服务端渲染、不水合；路由规则里的 `noScripts` 会禁用某些路由的 Nuxt 脚本和 JS 资源预提示，但整页也就没有了交互，只适合纯静态展示的页面。总的来说，默认模型还是整页水合，要靠这些手段逐个优化，不像 Next.js 默认就不发服务端组件的 JS。
:::

::: details Server Functions 和 Nuxt 的 server/api 接口有什么本质区别？
本质上都是发到服务端的 HTTP 请求。Server Functions 没有独立的路由地址，调用时框架向当前页面所在的路由发一个 POST 请求，前端像调用函数一样使用，和表单、缓存失效集成得更紧；Nuxt 的接口是显式的 HTTP 路由，地址和方法自己定义，别的客户端（例如 App）也能直接调用。两者都必须在服务端单独做鉴权。
:::

::: details 两个框架的中间件有什么不同？
Next.js 的 proxy 在路由渲染之前运行，适合重定向、改请求头和基于 cookie 的乐观检查，文档建议不要在里面查库，鉴权要在靠近数据的地方再做一次。Nuxt 分两层：路由中间件在 Vue 应用里运行，服务端和客户端导航都会执行；`server/middleware` 在 Nitro 里对每个请求运行，见 [Nuxt 中间件](/basics/nuxt/09-middleware)。
:::

## 易错点

- 以为 Nuxt 没有服务端组件。它有，只是不是默认的渲染模型
- 把 Next.js 的服务端组件等同于 SSR。SSR 的组件到浏览器还要水合，服务端组件不发 JS、不水合
- 选型只比功能清单，忽略团队技术栈和部署环境，这两点通常更决定成本
