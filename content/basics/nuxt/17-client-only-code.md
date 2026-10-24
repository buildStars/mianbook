---
difficulty: 1
tags: [高频, 场景题]
---

# Nuxt 里报 window is not defined 是怎么回事？哪些代码只能在客户端运行，怎么处理？

::: tip 一句话回答
Nuxt 默认开启服务端渲染，组件的 **setup 和模板会先在 Node 里执行一遍**，Node 里没有 `window`、`document`、`localStorage`，一访问就报错。setup 顶层的代码两端都会跑，**`onMounted` 只在浏览器里执行**。处理办法：把浏览器代码放进 `onMounted`，或用 **`import.meta.client`** 判断，或用 **`<ClientOnly>`** / `.client.vue` 组件只在客户端渲染，第三方库放进 `.client` 插件或在 `onMounted` 里动态 import。
:::

## 详细解析

### 为什么会报错

服务端渲染时，Nuxt 在 Node 里创建应用、执行每个组件的 setup、渲染模板，得到 HTML 字符串。这个过程没有浏览器环境：

| 代码位置 | 服务端 | 客户端 |
| --- | --- | --- |
| `<script setup>` 顶层、`setup()` | 执行 | 执行 |
| 模板（渲染函数） | 执行 | 执行 |
| `onBeforeMount`、`onMounted`、`onUpdated` 等 | 不执行 | 执行 |
| `onUnmounted` | 不执行 | 执行 |

所以 `const width = window.innerWidth` 写在 setup 顶层，服务端一执行就抛错。在纯 Node 里错误是 `ReferenceError: window is not defined`；Nuxt 的服务端构建会把 `window`、`document` 这类全局变量替换成 `undefined`，你看到的也可能是 `Cannot read properties of undefined`，原因是同一个。

还有一个相关的坑：setup 顶层不要写需要清理的副作用，比如 `setInterval`。服务端不会执行卸载钩子，定时器会一直留在服务进程里。

### 处理办法

1. **放进 `onMounted`**：最常用，挂载之后一定在浏览器里
2. **`import.meta.client` / `import.meta.server` 判断**：构建时静态替换，另一端的分支会被 tree-shake 掉。`process.client`、`process.server` 是旧写法，目前还能用，但类型上已经标了弃用，新代码用 `import.meta.*`
3. **`<ClientOnly>` 组件**：插槽内容只在客户端挂载后渲染。服务端渲染 `#fallback` 插槽，或者用 `fallback` 属性给一段文字、`fallback-tag` 指定占位标签（`placeholder`、`placeholder-tag` 是同义的别名）
4. **`.client.vue` 组件**：如 `Chart.client.vue`，只在客户端渲染。只对自动导入和 `#components` 导入生效，用真实路径 import 不会变成客户端组件
5. **`.client` 插件**：`plugins/analytics.client.ts` 只在浏览器里执行，适合初始化埋点、地图 SDK

### 导入时就访问 window 的第三方库

有些库在模块顶层就读 `window`，只要被 import 就会报错，放进 `onMounted` 里调用也没用，因为 import 语句在服务端已经执行了。办法是在 `onMounted` 里动态 import，或者把初始化放进 `.client` 插件：

```vue
<script setup lang="ts">
const el = ref<HTMLElement | null>(null)

onMounted(async () => {
  // 只在浏览器里加载这个库，服务端的包里不会执行它
  const { default: Editor } = await import('some-editor')
  new Editor(el.value!)
})
</script>

<template>
  <ClientOnly>
    <div ref="el" />
    <template #fallback>
      <p>编辑器加载中...</p>
    </template>
  </ClientOnly>
</template>
```

### 不要让两端渲染出不同的内容

用 `import.meta.client` 在模板里切换不同内容，服务端和客户端第一次渲染的结果就不一样，会触发水合不匹配，详见 [水合不匹配是怎么产生的](/basics/ssr/02-hydration-mismatch)。要在客户端显示不同内容，先渲染和服务端一样的结果，在 `onMounted` 里再改状态，或者交给 `<ClientOnly>`。

需要服务端就能拿到的数据，比如登录用户、主题偏好，不要放 `localStorage`，服务端读不到。改用 Cookie，Nuxt 里用 `useCookie`，两端读到的是同一个值。

## 面试官可能追问

::: details 用 if (typeof window !== 'undefined') 判断可以吗？
能避免报错，但不推荐。它在运行时判断，服务端的包里仍然带着这段代码；更大的问题是如果拿它决定渲染什么，两端结果不同，会水合不匹配。Nuxt 里用 `import.meta.client`，构建时就能去掉另一端的分支；涉及渲染的仍然要放进 `onMounted` 或 `<ClientOnly>`。
:::

::: details ClientOnly 包住的组件，为什么在 onMounted 里拿不到它的 DOM？
`<ClientOnly>` 自己在 `onMounted` 之后才渲染插槽内容，父组件的 `onMounted` 执行时里面的组件还没出来。可以用模板引用配合 `watch` 等它出现，或者把要操作 DOM 的逻辑写到内部组件自己的 `onMounted` 里。`.client.vue` 组件也一样，文档建议在 `onMounted` 里先 `await nextTick()` 再访问。
:::

::: details ClientOnly 用多了有什么代价？
里面的内容不进服务端 HTML，搜索引擎看不到，首屏只有占位，挂载后才出现，容易引起布局跳动。所以要给 fallback 留出和真实内容相近的高度。另外 default 插槽里的组件会从服务端构建里去掉，它们的 CSS 可能不会内联进首屏 HTML。
:::

## 易错点

- 以为 `onMounted` 外面的代码只在浏览器跑。setup 顶层两端都执行，只有挂载及之后的钩子是客户端专属
- 在 `onMounted` 里调用库，却在文件顶部静态 import 了它。库在导入时就访问 `window` 的话，服务端照样报错
- 用 `.client.vue` 却通过真实路径 `import Chart from '~/components/Chart.client.vue'` 引入，这时它不会变成客户端组件
- 把 `localStorage` 里的值直接用于渲染，服务端拿不到，两端结果不同就会水合不匹配
