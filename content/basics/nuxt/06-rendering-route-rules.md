---
difficulty: 2
tags: [实践, 性能优化]
---

# Nuxt 有哪些渲染方式？怎么用 routeRules 给不同页面配置不同的渲染和缓存策略？

::: tip 一句话回答
Nuxt 默认是**通用渲染**：服务端返回完整 HTML，客户端水合后接管交互。设 `ssr: false` 变成整站客户端渲染；`nuxt generate` 在构建时**预渲染**成静态站点。真实项目更常用**混合渲染**：在 `routeRules` 里按路径配置，首页 `prerender: true`，商品页 `swr: 3600`，后台 `ssr: false`。`swr` 在服务端或反向代理缓存，过期后先返回旧内容、后台重新生成；`isr` 能把页面放进 CDN，但依赖部署平台。**带用户信息的页面不能用 swr、isr**。
:::

## 详细解析

### 几种渲染方式

| 方式 | 怎么开启 | 适合 |
| --- | --- | --- |
| 通用渲染（默认） | 什么都不配 | 需要 SEO、首屏快的大多数页面 |
| 客户端渲染 | `ssr: false` | 纯后台、强交互工具，不需要 SEO |
| 预渲染（静态站点） | `nuxt generate` | 文档、博客、营销页 |
| 混合渲染 | `routeRules` | 同一个应用里不同页面要求不同 |
| 边缘渲染 | 选边缘平台的 preset | 本质是部署目标，不是新的渲染模式 |

通用、静态、客户端渲染这些概念本身的对比见 [CSR、SSR、SSG、ISR](/basics/ssr/01-rendering-modes)，这里只讲 Nuxt 里怎么配。`ssr: false` 时可以放一个 `app/spa-loading-template.html`，在 JS 加载完之前显示加载页。

### nuxt generate 怎么找页面

`nuxt generate` 让 Nitro 的爬虫从 `/`、所有非动态页面以及 `prerender.routes` 出发，抓取页面里的 `<a href>` 递归下去，结果输出到 `.output/public`，放到任何静态托管上都能用。

- 动态路由如果没有任何页面链接到它，就爬不到，要手动写进 `nitro.prerender.routes`
- 不想生成的路径用 `nitro.prerender.ignore` 排除
- 文档明确说 **`nuxt generate` 不支持混合渲染**，要混合就用 `nuxt build` 部署成服务器，再用 `routeRules` 的 `prerender: true` 指定哪些路径预渲染

### routeRules 能配什么

`routeRules` 写在 `nuxt.config` 里，键是路径（支持 `**` 通配），值是这段路径的规则。字段分两类：

- **渲染和缓存**：`prerender`（构建时生成静态文件）、`ssr`（`false` 时只在浏览器渲染）、`swr`、`isr`、`cache`（Nitro 的缓存选项对象，例如 `maxAge`）、`noScripts`（不输出 Nuxt 脚本，适合纯静态展示页）
- **请求处理**：`redirect`（服务端重定向）、`headers`（加响应头）、`cors`（自动加 CORS 头）、`proxy`（代理到别的地址）
- **应用侧**：`appMiddleware` 控制 Vue 应用里哪些路由中间件生效，`appLayout` 给这段路径指定布局

其中 `cache`、`headers`、`redirect`、`prerender`、`proxy`、`isr`、`cors`、`swr` 来自 Nitro，`ssr`、`noScripts`、`appMiddleware`、`appLayout` 是 Nuxt 加的。

### swr 和 isr 的区别

两者都是"缓存加后台重新生成"：缓存过期后，下一个请求先拿到旧内容，同时后台重新渲染，之后的请求拿新内容。用户几乎不会等渲染。

- **swr**：缓存在 Nitro 服务端或前面的反向代理里。数字表示秒数；写 `true` 只加 `stale-while-revalidate`，不设最大缓存时间
- **isr**：行为一样，但能把响应放进平台的 CDN，文档目前列的是 Netlify 和 Vercel。写 `true` 表示在 CDN 里一直保留到下次部署。换到普通 Node 服务器上，CDN 那部分就没有效果

`swr`、`isr` 的路由还会在 HTML 旁边生成 `_payload.json`，客户端导航到这些页面时直接读它。

## 代码示例

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  routeRules: {
    // 首页构建时生成静态 HTML
    '/': { prerender: true },
    // 商品页缓存一小时，过期后先返回旧页面再后台刷新
    '/products/**': { swr: 3600 },
    // 部署在 Vercel、Netlify 时可以放进 CDN
    '/blog/**': { isr: 600 },
    // 后台只在浏览器渲染，用 admin 布局
    '/admin/**': { ssr: false, appLayout: 'admin' },
    // 旧地址永久跳转
    '/old-shop/**': { redirect: { to: '/products/**', statusCode: 301 } },
    // 接口允许跨域并加缓存头
    '/api/public/**': { cors: true, headers: { 'cache-control': 'max-age=60' } },
  },
})
```

`redirect` 可以写字符串，也可以写 `{ to, statusCode }` 对象；`to` 以 `/**` 结尾时，请求路径里匹配到的剩余部分会接到目标后面，比如 `/old-shop/a/b` 跳到 `/products/a/b`。

## 面试官可能追问

::: details 商品页用了 swr，价格改了用户多久能看到？
最多晚一个缓存周期加一次请求：过期后第一个访问的人仍拿到旧页面，同时触发后台重新生成，之后的人看到新价格。对价格、库存这类敏感字段，常见做法是页面主体缓存，价格在客户端单独请求接口；或者缩短缓存时间。
:::

::: details ssr: false 的页面还会经过服务端吗？
会经过 Nitro，但服务端只返回一个空壳 HTML 和脚本，不执行页面组件，内容全在浏览器里渲染。构建时能确定的 `ssr: false` 页面不会被打进服务端 bundle。这类页面没有 SEO 价值，适合登录后的后台。
:::

::: details 边缘渲染和普通 SSR 有什么区别？
渲染逻辑是同一套，只是 Nitro 用边缘平台的 preset 打包，代码跑在离用户近的节点上，例如 Cloudflare Pages、Vercel 和 Netlify 的边缘函数。代价是运行环境受限，不能随便用 Node 专有 API，而且数据库通常离边缘节点很远。详见 [边缘渲染](/basics/ssr/11-edge-rendering)。
:::

::: details routeRules 能不能写在页面文件里？
可以用 `defineRouteRules`，但它是实验特性，需要开启 `experimental.inlineRouteRules`。团队里更常见的是集中写在 `nuxt.config`，一眼能看到所有页面的策略。
:::

## 易错点

- 给"我的订单""个人中心"这类依赖用户身份的页面配 `swr` 或 `isr`，第一个用户的页面会被缓存下来发给所有人。这类页面只能每次渲染，或者改成客户端取数
- 以为 `nuxt generate` 也能用 `swr`、`ssr: false` 这些混合规则。静态生成没有服务器，混合渲染要用 `nuxt build`
- 在普通 Node 服务器上配了 `isr` 就以为页面进了 CDN。CDN 缓存依赖平台集成，自己部署时要单独配置 CDN
- 动态路由没被任何页面链接，`nuxt generate` 后访问是 404。要写进 `prerender.routes`
