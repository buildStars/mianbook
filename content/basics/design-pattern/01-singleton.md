---
difficulty: 1
tags: [高频, 实践]
---

# 单例模式是什么？前端里有哪些应用？

::: tip 一句话回答
单例模式保证一个类**只有一个实例**，并提供一个全局访问点。JS 里常用**惰性单例**：第一次用到时才创建，之后一直返回同一个实例，实例保存在闭包或类的静态属性里；ES Module 只会执行一次并被缓存，模块导出的对象天然就是单例。前端用它管理整个应用只需要一份的东西：全局弹窗和 Toast 容器、状态 Store、请求客户端、WebSocket 连接。它的缺点是本质上属于全局状态：依赖关系被隐藏，测试时状态会在用例之间残留，服务端渲染时还会被所有请求共享。
:::

## 详细解析

### 实现方式一：类的静态属性

```js
class Logger {
  static #instance = null

  static getInstance() {
    // 第一次调用时才创建，之后都返回同一个实例
    Logger.#instance ??= new Logger()
    return Logger.#instance
  }

  log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`)
  }
}

console.log(Logger.getInstance() === Logger.getInstance()) // true
```

JS 的构造函数不能设为私有，别人仍然可以直接 `new Logger()` 绕过 `getInstance`。可以只导出实例、不导出类，或者在构造函数里发现实例已存在时抛错。

### 实现方式二：闭包，通用的惰性单例

把"保证只创建一次"和"怎么创建"分开，管理单例的逻辑就能复用：

```js
function lazySingleton(create) {
  let instance
  return () => (instance ??= create())
}

// 全局的 Toast 容器：第一次弹提示时才创建 DOM，之后复用同一个节点
const getToastRoot = lazySingleton(() => {
  const el = document.createElement('div')
  el.className = 'toast-root'
  document.body.append(el)
  return el
})

export function toast(message, duration = 2000) {
  const item = document.createElement('div')
  item.textContent = message
  getToastRoot().append(item)
  setTimeout(() => item.remove(), duration)
}
```

### 实现方式三：ES Module 的模块缓存

同一个模块在一个应用里只执行一次，之后所有 `import` 拿到的都是同一份导出。项目里最常见的单例其实就是这样写的：

```js
// http.js：整个应用共用一个配置好的请求实例
import axios from 'axios'

export const http = axios.create({ baseURL: '/api', timeout: 10_000 })

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
```

模块是按解析后的完整地址缓存的：地址不同（比如浏览器里带了不同的查询参数），或者 node_modules 里装了同一个包的两份（见 [依赖分身](/basics/node/10-package-managers)），就会得到两个实例。模块的加载机制见 [ES Module 和 CommonJS 的区别](/basics/javascript/17-esm-vs-cjs)。

### 应用场景

| 场景 | 为什么只要一个 |
| --- | --- |
| 全局弹窗、Toast、Loading 容器 | 重复创建会叠加多层遮罩，浪费 DOM |
| 状态 Store（Pinia、Vuex） | 所有组件读写同一份状态 |
| 请求客户端 | 统一配置 baseURL、超时和拦截器 |
| WebSocket 连接、埋点 SDK | 多个连接浪费资源，事件还会被重复上报 |
| 数据库连接池、Redis 客户端（Node.js） | 连接是昂贵的资源，整个进程共用一个连接池 |

### 缺点

- **隐藏依赖**：函数内部直接 import 单例，从参数上看不出它依赖了什么，想替换实现很困难
- **难以测试**：状态在测试用例之间残留，要 mock 模块，或者在每个用例前重置
- **服务端渲染时被所有请求共享**：Node.js 进程长期运行，模块级的单例被所有用户的请求共用，一个用户的数据可能出现在另一个用户的页面上，所以 SSR 中每个请求都要创建新的 Store，见 [SSR 和水合](/basics/vue/18-ssr-hydration)

缓解的办法是把创建和使用分开：模块导出一个创建函数，在应用入口创建一次，再通过参数或 provide / inject 交给使用方。实例仍然只有一个，但依赖关系是显式的，测试时还能传入假的实现，这也是[依赖倒置原则](/basics/design-pattern/09-solid)的思路。

## 面试官可能追问

::: details 异步创建的单例（比如数据库连接）怎么避免重复创建？
缓存 Promise，而不是缓存创建好的结果。如果缓存的是结果，第一次连接还没完成时又来了一个调用，它看到实例还是空的，就会再连接一次：

```js
let connecting = null

export function getDb() {
  connecting ??= connect(config).catch((err) => {
    connecting = null // 连接失败后，允许下次调用重试
    throw err
  })
  return connecting
}
```

并发调用 `getDb()` 拿到的都是同一个 Promise，只会建立一次连接。
:::

::: details Pinia 的 store 是单例吗？
在同一个 pinia 实例里是：对同一个 id 多次调用 `useUserStore()`，拿到的是同一个 store。但它不是模块级的全局单例，而是挂在 pinia 实例上的。SSR 时每个请求创建一个新的 pinia，store 也就各自独立，不会串数据。这也是为什么在组件外使用 store 时，要在 `app.use(pinia)` 之后、在函数内部调用 `useXxxStore()`，见 [Pinia 和 Vuex 的区别](/basics/vue/17-pinia)。
:::

::: details 单例怎么做单元测试？
- 导出创建函数，测试时直接创建新实例，不碰全局的那一个
- 提供只在测试中使用的重置方法
- 用 Vitest 的 `vi.resetModules()` 清空模块缓存，之后重新动态 `import` 会重新执行模块，得到新的实例
- 更根本的做法是让被测代码通过参数接收依赖，测试时传入假的实现
:::

## 易错点

- 只把实例挂到 `window` 上不算好的单例：污染全局，还可能被任意代码覆盖
- 写了 `getInstance()`，别人仍然可以直接 `new`；要么不导出类，要么在构造函数里拦截
- 服务端渲染时，模块级的单例会被所有请求共享
- 异步初始化的单例缓存了结果而不是 Promise，并发调用时会重复创建
