---
difficulty: 2
tags: [原理]
---

# Nuxt 的自动导入是怎么实现的？有哪些坑？

::: tip 一句话回答
自动导入**不是全局变量**，而是构建时扫描代码，把用到的 `ref`、`useFetch`、自己写的 composable 改写成真正的 `import`，所以有完整的类型提示，也只打包用到的代码。来源包括 Vue API、Nuxt composables、`app/composables` 和 `app/utils` 的**顶层文件**、`app/components`、`shared/utils`、`shared/types` 和 `server/utils`。常见的坑：嵌套目录不扫描、类型文件没生成时报找不到名字、同名冲突，以及在 `await` 之后或普通函数里调用 composable 报 "Nuxt instance unavailable"。
:::

## 详细解析

### 原理：编译时补 import

源码里直接写 `useFetch`、`useCounter`，构建时 Nuxt 的转换插件分析每个文件用到了哪些名字，再在文件开头加上对应的 import：

```ts
// 你写的
const count = ref(0)
const { data } = await useFetch('/api/user')

// 构建时大致变成（示意，实际路径由 Nuxt 生成）
import { ref } from 'vue'
import { useFetch } from '#app/composables/fetch'
const count = ref(0)
const { data } = await useFetch('/api/user')
```

和挂在 `window` 上的全局变量相比，这样做的好处是：仍然是 ES 模块，能 tree-shaking；IDE 能跳转到定义；类型来自 `.nuxt/imports.d.ts` 里生成的声明。

### 哪些东西会被自动导入

| 来源 | 说明 |
| --- | --- |
| Vue API | `ref`、`computed`、`watch` 等 |
| Nuxt composables | `useFetch`、`useState`、`useRoute`、`navigateTo` 等 |
| `app/composables`、`app/utils` | 只扫顶层文件；具名导出直接可用，默认导出按文件名驼峰命名 |
| `app/components` | 按目录拼接组件名，`components/base/foo/Button.vue` 对应 `<BaseFooButton />` |
| `shared/utils`、`shared/types` | 顶层文件，应用和服务端都能用 |
| `server/utils` | 只在服务端自动导入 |

组件还有几个约定：加 `Lazy` 前缀（如 `<LazyChart v-if="show" />`）变成异步加载；`.client.vue` 只在客户端渲染；`.server.vue` 是服务端组件。

### 只扫描顶层

`app/composables/nested/useBar.ts` 不会被扫描。两种解决办法：

```ts
// 1. 在顶层 index.ts 里重新导出
// app/composables/index.ts
export { useBar } from './nested/useBar'
```

```ts
// 2. 在 nuxt.config.ts 里扩大扫描范围
export default defineNuxtConfig({
  imports: {
    dirs: ['~/composables/**'],
  },
})
```

第三方包也可以加入自动导入，用 `imports.presets`，比如 `{ from: 'vue-i18n', imports: ['useI18n'] }`。

### 显式导入和关闭

- 想写明来源时，用 `import { ref, computed } from '#imports'`；组件可以从 `#components` 导入，如 `import { LazyChart } from '#components'`
- `imports.autoImport: false` 关闭全部自动导入，`#imports` 仍然可用
- `imports.scan: false` 只关闭对自己目录的扫描，框架函数仍然自动导入；这会影响 layers 的覆盖
- `components.dirs: []` 关闭 `~/components` 的自动注册

### "Nuxt instance unavailable" 是怎么回事

SSR 时一个 Node 进程同时处理多个请求，每个请求有自己的 `nuxtApp`。composable 不是靠参数拿到 `nuxtApp`，而是读一个"当前实例"的全局变量。Nuxt 只在**同步执行**期间设置它，执行完立刻清掉，防止一个请求读到另一个请求的实例。

```ts
// app/utils/load.ts：普通函数，不在 setup、插件、中间件里
export async function loadUser() {
  await someTask()
  // ❌ 已经离开了同步上下文，报 Nuxt instance unavailable
  return useFetch('/api/user')
}
```

- 合法的调用位置：`<script setup>`、Nuxt 插件、路由中间件、`defineNuxtComponent`
- 在这些地方 `await` 之后继续调用 composable 是可以的，编译器会帮你恢复上下文；自己写的普通 async 函数里没有这个处理
- 解决办法：在 setup 顶层同步拿到需要的东西再传进函数，或者把函数本身写成 composable，在 setup 里调用

跨请求状态泄漏的问题见 [SSR 的跨请求状态污染](/basics/ssr/12-cross-request-state)。

## 面试官可能追问

::: details 自动导入会不会把所有 composable 都打包进去？
不会。只有文件里实际用到的名字才会被补成 import，没用到的 composable 不会进入产物。这也是它和全局注册的主要区别。
:::

::: details 新加的 composable 提示找不到名字，怎么办？
类型声明在 `.nuxt/imports.d.ts` 里，要运行 `nuxt dev`、`nuxt build` 或 `nuxt prepare` 才会生成或更新。CI 里做类型检查前要先跑 `nuxt prepare`。另外确认文件放在顶层，嵌套目录默认不扫描。
:::

::: details 两个 composable 同名会怎样？
比如自己写了一个和 Nuxt 内置函数同名的 `useState`，或者 `composables` 和 `utils` 里各有一个 `formatDate`，自动导入只会保留其中一个：按来源的优先级选，优先级相同时打印 `Duplicated imports` 警告，保留先注册的那个，忽略后面的，很难排查。`useState` 还是编译器特殊处理的名字，不要自定义同名函数。最好给自己的函数起有区分度的名字。
:::

## 易错点

- 以为自动导入是全局变量，在浏览器控制台里能直接调用 `useFetch`
- 把 composable 放在 `composables/xxx/` 子目录下却期望被自动导入
- 在 `setTimeout`、普通工具函数或第三方回调里调用 `useRuntimeConfig`、`useState`，报 Nuxt instance unavailable
