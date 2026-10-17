---
difficulty: 2
tags: [原理, 场景题]
---

# SSR 里为什么会出现跨请求状态污染？怎么避免？

::: tip 一句话回答
浏览器里一个页面只服务一个用户，但 SSR 服务器是一个**长期运行的 Node 进程**，同时处理很多用户的请求。**模块只执行一次**，模块顶层创建的 store、请求实例、全局变量会被所有请求共享，A 用户的数据就可能被 B 用户的页面渲染出来。解决办法是**每个请求新建 app、store、router**，用框架提供的请求级状态，或者用 `AsyncLocalStorage` 保存请求上下文。
:::

## 详细解析

### 为什么会污染

客户端写惯了的单例写法：

```js
// store.js
export const store = { user: null, cart: [] }
```

在浏览器里没问题：每次刷新页面，模块重新执行，状态是新的。到了 Node 里，`import` 的模块会被缓存，`store` 在进程启动时创建一次，之后**所有请求拿到的都是同一个对象**。

```text
请求 A（用户张三）：store.user = 张三 → await 查购物车 ...
请求 B（用户李四）：                     store.user = 李四
请求 A 继续渲染：读 store.user → 李四   ← 串号
```

Node 是单线程，但请求里有 `await`，多个请求的执行会交错。哪怕只是"先写后读"，中间隔了一次异步，就可能被别的请求改掉。

### 典型事故

- **全局 store**：Vuex、Pinia、Redux 的 store 在模块顶层创建并导出
- **请求实例上挂用户信息**：axios 实例在模块顶层创建，登录后 `instance.defaults.headers.Authorization = token`，之后所有用户的服务端请求都带上了这个 token
- **模块级缓存**：`const cache = new Map()` 按 URL 缓存接口结果，但接口返回的是当前用户的数据
- **第三方库的全局配置**：i18n 实例在顶层创建，某个请求切了语言，其他用户的页面语言也变了

这类问题**本地开发很难复现**（只有你一个人在访问），上线后在并发下偶发，后果是用户看到别人的信息，属于安全事故。

### 怎么避免

1. **工厂函数**：把"导出实例"改成"导出创建实例的函数"，每个请求调用一次

```js
export function createApp() {
  const app = createSSRApp(App)
  const pinia = createPinia()
  const router = createRouter({ history: createMemoryHistory(), routes })
  app.use(pinia).use(router)
  return { app, pinia, router }
}
```

2. **用框架的请求级状态**：Nuxt 的 `useState` 在服务端按请求隔离；Pinia 在 SSR 下每个请求新建一个 `pinia` 实例，store 都挂在它上面，在组件外调用要写成 `useStore(pinia)`；Next.js 的 App Router 里，服务端组件通过 `cookies()`、`headers()` 读取当前请求，不要把这些值存到模块变量
3. **AsyncLocalStorage**：在请求入口把上下文放进去，后面任意深的异步调用都能取到属于自己请求的那一份，详见 [AsyncLocalStorage](/basics/node/12-async-local-storage)
4. **只在模块顶层放"与用户无关"的东西**：常量、无状态工具函数、数据库连接池可以共享；带用户身份的东西一律放到请求作用域

Vue 的 SSR 指南专门强调了这一点，水合相关的部分见 [Vue SSR 和水合](/basics/vue/18-ssr-hydration)。

## 代码示例

```js
import { AsyncLocalStorage } from 'node:async_hooks'

const requestContext = new AsyncLocalStorage()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ❌ 模块级变量：所有请求共享
let currentUser = null
async function badHandler(user, delay) {
  currentUser = user
  await sleep(delay)
  return `bad: ${user} 看到的是 ${currentUser}`
}

// ✅ 每个请求自己的上下文
async function goodHandler(user, delay) {
  return requestContext.run({ user }, async () => {
    await sleep(delay)
    return `good: ${user} 看到的是 ${requestContext.getStore().user}`
  })
}

console.log(await Promise.all([badHandler('张三', 20), badHandler('李四', 10)]))
// [ 'bad: 张三 看到的是 李四', 'bad: 李四 看到的是 李四' ]
console.log(await Promise.all([goodHandler('张三', 20), goodHandler('李四', 10)]))
// [ 'good: 张三 看到的是 张三', 'good: 李四 看到的是 李四' ]
```

## 面试官可能追问

::: details 线上怀疑有串号，怎么排查？
先全局搜索模块顶层的 `let`、`new Map()`、`createStore`、axios 实例上的 `defaults` 修改，以及 `export const xxx = reactive(...)` 这类写法。然后本地用压测工具，以两个不同的登录 Cookie 并发请求同一页面，检查返回的 HTML 是否混入了对方的数据。日志里给每个请求打 requestId，也能帮你定位是哪段代码读到了错的数据。
:::

::: details 每个请求都新建 app 和 store，性能扛得住吗？
创建这些对象的开销远小于渲染本身和接口请求，通常不是瓶颈。真正昂贵、又和用户无关的东西（组件编译结果、数据库连接池、公共配置）仍然可以在模块级复用。SSR 的性能优化见 [SSR 性能和稳定性](/basics/ssr/09-ssr-performance)。
:::

::: details 为什么 Node 是单线程还会有这种问题？
单线程只保证同一时刻只有一段 JS 在执行，不保证一个请求从头执行到尾。每遇到 `await`，当前请求就让出执行权，其他请求接着跑并修改共享变量。所以只要读写之间隔着异步，就有竞态。
:::

## 易错点

- 以为"只在服务端读，不写"就安全：模块级缓存里存了 A 的数据，B 读出来同样是泄漏
- 把 token 设到全局 axios 实例的默认 Header 上，是最常见的串号写法之一
- 本地单人测试正常不代表没问题，要用多个身份并发验证
