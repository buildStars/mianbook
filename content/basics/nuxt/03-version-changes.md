---
difficulty: 2
tags: [对比, 高频]
---

# Nuxt 3、Nuxt 4 相比 Nuxt 2 有哪些变化？

::: tip 一句话回答
Nuxt 2 到 Nuxt 3 是**重写**：底层换成 Vue 3 和 Composition API，默认打包器从 webpack 4 换成 **Vite**，服务端换成 **Nitro**，构建产物不依赖 Nuxt 运行时，可以部署到 Serverless 和边缘。API 也全换了：`asyncData`、`fetch` 换成 `useAsyncData`、`useFetch`，`head()` 换成 `useHead`，插件改用 `defineNuxtPlugin`，不再内置 Vuex。Nuxt 3 到 Nuxt 4 是**平滑升级**：默认 `app/` 目录、新增 `shared/`、TypeScript 拆成多个项目、数据获取的行为调整。Nuxt 2 和 Nuxt 3 都已停止维护。
:::

## 详细解析

### Nuxt 2 到 Nuxt 3：重写

| 方面 | Nuxt 2 | Nuxt 3 |
| --- | --- | --- |
| Vue | Vue 2，Options API 为主 | Vue 3，默认 Composition API 和 `<script setup>` |
| 打包 | webpack 4 + Babel | 默认 Vite，也可选 webpack 5 |
| 服务端 | 运行时依赖 Nuxt 的 Node 服务器 | Nitro 编译出独立的服务端产物，可部署到 Node、Serverless、边缘 |
| 页面取数 | `asyncData`、`fetch` 钩子 | `useAsyncData`、`useFetch`，非阻塞版本 `useLazy*` |
| 状态 | 内置 Vuex（`store/` 目录） | 不再内置，推荐 Pinia（`@pinia/nuxt` 模块） |
| head | 组件选项 `head()` | `useHead`、`useSeoMeta` |
| 插件 | `(context, inject)` | `defineNuxtPlugin((nuxtApp) => ...)`，用 `provide` 注入 |
| 路由中间件 | `(context) => redirect(...)` | `defineNuxtRouteMiddleware`，`return navigateTo(...)` |
| 静态资源 | `static/` | `public/` |
| 服务端扩展 | `serverMiddleware` 配置 | `server/` 目录：api、routes、middleware |
| 模块 | 模块容器 `this.addPlugin` 等 | `@nuxt/kit` 的 `defineNuxtModule` 和工具函数 |

迁移成本主要在这几处：

```ts
// Nuxt 2 插件
export default (context, inject) => {
  inject('hello', (msg) => console.log(msg))
}

// Nuxt 3 插件：只接收 nuxtApp，用 provide 注入，使用时是 $hello
export default defineNuxtPlugin(() => {
  return { provide: { hello: (msg: string) => console.log(msg) } }
})
```

```ts
// Nuxt 3 路由中间件：没有 next，也没有 redirect，靠返回值控制
export default defineNuxtRouteMiddleware((to) => {
  if (to.path.startsWith('/admin') && !useState('user').value) {
    return navigateTo('/login')
  }
})
```

页面选项也变了：`key`、`validate` 改成写在 `definePageMeta` 里；`watchQuery` 不再支持，改为 `watch(() => route.query, () => refresh())`。Vue 3 本身的变化见 [Vue 3 相比 Vue 2 有哪些变化](/basics/vue/02-vue3-vs-vue2)，这里不重复。

### Nuxt 3 到 Nuxt 4：平滑升级

Nuxt 4 没有推倒重来，多数项目跑升级命令加 codemod 就能迁移：

- **目录**：默认源码目录是 `app/`，`~` 指向 `app/`；新增 `shared/` 放应用和服务端共用的代码。旧结构不迁移也能用
- **TypeScript**：应用、服务端、shared、构建期配置拆成独立的 TS 项目，类型更准；默认开启 `noUncheckedIndexedAccess`
- **数据获取**：同一个 key 的 `useAsyncData` / `useFetch` 共享同一份 `data`、`error`、`status`，选项不能冲突；`data` 改用 `shallowRef`，要深层响应需要 `{ deep: true }`；`data` 和 `error` 的默认值从 `null` 改成 `undefined`；最后一个使用该数据的组件卸载后数据被清理
- **组件名规范化**：组件的 name 和自动导入名一致，比如 `SomeFolder/MyComponent.vue` 的名称是 `SomeFolderMyComponent`，影响 `KeepAlive` 的 include 和测试里按名称查找组件
- **head**：升级到 Unhead v2，去掉了 `hid`、`vmid` 等旧字段
- **其他**：`window.__NUXT__` 移除，改用 `useNuxtApp().payload`；顶层 `generate` 配置移除，改用 `nitro.prerender`；`createError` 推荐写 `status`、`statusText`

```vue
<script setup lang="ts">
const { data } = await useFetch('/api/user')

// Nuxt 4 中 data 是 shallowRef，直接改深层属性不会触发更新
// ❌ data.value.name = 'new'
// ✅ 整体替换
data.value = { ...data.value!, name: 'new' }
</script>
```

### 维护状态和下一步

Nuxt 2 和 Nuxt 3 都已结束维护，新项目直接用 Nuxt 4。下一个大版本会换用 Nitro v3 和 h3 v2，服务端 API 的写法会变化；Nuxt 4 提供了 `future.compatibilityVersion` 选项，可以提前测试下个版本的破坏性改动，只建议用于测试。

## 面试官可能追问

::: details Nuxt 2 项目迁移到 Nuxt 3 最难的是什么？
不是语法，而是生态：Nuxt 2 模块和 Vue 2 组件库大多要换成 Nuxt 3 / Vue 3 版本，Vuex 要迁到 Pinia 或手动接入 Vuex 4，`asyncData`、`fetch`、插件和中间件都要改写。Vue 3 的迁移构建不能用于 Nuxt 3。官方当时提供过 Nuxt Bridge 作为过渡方案，让 Nuxt 2 项目先用上部分 Nuxt 3 特性再逐步迁移；新版 Nuxt CLI 已不再支持 Nuxt 2 和 Bridge，现在的老项目只能直接迁到新版本。
:::

::: details Nitro 带来了什么好处？
Nuxt 2 的生产环境要跑 Nuxt 自己的 Node 服务器。Nitro 把服务端代码编译成独立产物，按 preset 输出成 Node 服务、Serverless 函数或边缘函数，冷启动快、体积小；同时 `server/` 目录让 Nuxt 项目可以直接写接口，SSR 时调用自己的接口还会直接调用处理函数，不走 HTTP。
:::

::: details Nuxt 3 升级到 Nuxt 4 最容易踩的坑是什么？
数据获取：`data` 变成 `shallowRef` 后，深层修改不再触发更新；默认值从 `null` 变成 `undefined`，代码里的 `=== null` 判断会失效；同一个 key 的多次调用如果选项不同会报警告。还有组件名规范化，依赖组件 name 的 `KeepAlive` 配置要检查。
:::

## 易错点

- 以为 Nuxt 3 到 Nuxt 4 和 Nuxt 2 到 Nuxt 3 一样是重写。前者是平滑升级，旧目录结构还能继续用
- 以为 Nuxt 3 自带状态管理替代 Vuex。Nuxt 3 只是不再内置 Vuex，推荐接入 Pinia；`useState` 适合简单的共享状态
- 把 `useFetch` 当成 Nuxt 2 `fetch()` 钩子的直接替代。它是 `useAsyncData` 加 `$fetch` 的封装，行为不同
- 升级后还在写 `createError({ statusCode, statusMessage })`。Nuxt 4 应用侧推荐 `status`、`statusText`，旧写法已标记弃用
