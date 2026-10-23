---
difficulty: 2
tags: [对比, 高频]
---

# Nuxt 的路由中间件和服务端中间件有什么区别？

::: tip 一句话回答
两者在不同层。**路由中间件**放在 `app/middleware`，属于 Vue 应用，在页面跳转前执行，用 `defineNuxtRouteMiddleware((to, from) => {})` 写，返回 `navigateTo` 跳转、返回 `abortNavigation` 中止、不返回就继续；首屏在服务端执行，水合时客户端还会再执行一次。**服务端中间件**放在 `server/middleware`，属于 Nitro，**每个请求都执行**（包括接口和静态资源以外的所有服务端路由），不返回响应，用来解析会话写进 `event.context`、记日志。鉴权要两层配合：服务端解析身份、接口校验权限，路由中间件只负责跳转体验。
:::

## 详细解析

### 对比

| | 路由中间件 | 服务端中间件 |
| --- | --- | --- |
| 位置 | `app/middleware` | `server/middleware` |
| 所在层 | Vue 应用（vue-router 导航） | Nitro（HTTP 请求） |
| 触发时机 | 页面导航前 | 每个请求进入服务端路由之前 |
| 管不管接口 | 不管，`$fetch('/api/x')` 不经过它 | 管，接口请求也会经过 |
| 写法 | `defineNuxtRouteMiddleware` | `defineEventHandler` |
| 怎么影响结果 | 返回 `navigateTo`、`abortNavigation` | 写 `event.context`，或抛错 |

### 路由中间件的三种形式

- **匿名**：直接写在页面的 `definePageMeta({ middleware: [(to) => {...}] })` 里，只对这个页面生效
- **命名**：`app/middleware/auth.ts`，页面里写 `middleware: ['auth']` 引用，按需异步加载
- **全局**：文件名带 `.global`，如 `analytics.global.ts`，每次路由变化都执行

执行顺序：先跑全局中间件，按文件名字母序；再按页面 `middleware` 数组的顺序跑命名和匿名中间件。要控制全局中间件的顺序就加数字前缀，但它是字符串排序，`10.x.global.ts` 会排在 `2.y.global.ts` 前面，所以写成 `01.`、`02.`。

### 在哪里执行

首屏访问时，页面的路由中间件在服务端渲染时执行一次，**水合时在客户端又执行一次**；之后的客户端导航只在浏览器执行。两个推论：

- 中间件里有副作用（埋点、计数）会触发两次，只想在客户端跑就在开头写 `if (import.meta.server) return`
- 中间件里要读目标路由，用参数 `to`，不要用 `useRoute()`，后者拿到的可能还是当前路由

### 鉴权怎么分工

路由中间件运行在浏览器里时，用户可以改代码绕过它；而且它根本不管 `/api` 请求。所以它只能改善体验，不能保护数据：

1. 服务端中间件读 Cookie，校验会话，把用户放进 `event.context.user`
2. 每个敏感接口检查 `event.context.user` 和权限，不满足就抛 401、403
3. 路由中间件判断前端的登录状态，没登录就跳到登录页，避免用户看到空页面

完整的 SSR 登录态处理见 [SSR 应用里的登录态](/basics/ssr/10-ssr-auth)。

## 代码示例

```ts
// app/middleware/auth.ts：命名路由中间件
export default defineNuxtRouteMiddleware((to) => {
  const user = useState<User | null>('user')
  if (!user.value) {
    // 带上原地址，登录后跳回
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})
```

```vue
<!-- app/pages/orders.vue -->
<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })
</script>
```

```ts
// server/middleware/session.ts：服务端中间件，不返回任何内容
export default defineEventHandler(async (event) => {
  const sid = getCookie(event, 'sid')
  if (sid) event.context.user = await getSessionUser(sid)
})
```

```ts
// server/api/orders.get.ts：接口自己校验
export default defineEventHandler((event) => {
  const user = event.context.user
  if (!user) throw createError({ status: 401, statusText: 'Unauthorized' })
  return listOrders(user.id)
})
```

## 面试官可能追问

::: details 路由中间件里能用 async 吗？
可以，函数可以是 async，`await` 之后仍然能用 Nuxt 的 composables。但它会阻塞导航，慢请求会让页面跳转卡住，取数据的事尽量交给页面里的 `useFetch`。
:::

::: details navigateTo 不 return 会怎样？
不会生效，导航照常进行。`navigateTo` 只有被 return（或在页面里被 await）才起作用。服务端返回的跳转默认是 302，可以用 `redirectCode` 改成 301。
:::

::: details 服务端接口里能用 navigateTo 跳转吗？
不能，它属于 Vue 应用。Nitro 路由里用 h3 的 `sendRedirect`，或者让前端根据接口返回的状态码自己跳转。
:::

::: details 怎么只让某些路径跳过全局中间件？
在中间件开头按 `to.path` 判断后直接 return。也可以在 `routeRules` 里用 `appMiddleware` 按路径开关某个中间件，把配置集中在 `nuxt.config`。
:::

## 易错点

- 只在路由中间件里判断登录就以为接口安全了。直接请求 `/api` 完全绕过它
- 在服务端中间件里返回内容，导致所有请求都拿到同一个结果
- 全局中间件用 `1.`、`2.`、`10.` 编号，结果 `10.` 先执行
- 中间件里用 `useRoute()` 判断目标页面，拿到的是跳转前的路由
