---
difficulty: 2
tags: [性能优化, 新特性]
---

# 什么是懒水合（Lazy Hydration）？Nuxt 和 Vue 里怎么用？

::: tip 一句话回答
懒水合是指服务端照常把组件渲染成 HTML，但**推迟这个组件的水合**，等它进入视口、浏览器空闲、用户交互或满足某个条件时再下载 JS 并水合。在此之前内容看得见、但不能交互。Vue 里给 `defineAsyncComponent` 传 **`hydrate` 选项**，配合 `hydrateOnVisible` 等策略；Nuxt 里给 **`Lazy` 前缀的组件**加 `hydrate-on-visible`、`hydrate-on-idle` 等属性，或者用 `defineLazyHydrationComponent`。适合页面下方的评论区、页脚、复杂图表，不适合首屏马上要交互的组件。
:::

## 详细解析

### 为什么需要

普通的服务端渲染是整页水合：浏览器要下载并执行页面上所有组件的 JS，把事件绑到已有的 DOM 上，页面才能交互。页面最下面的评论区、页脚，用户可能根本不会滚到，它们的 JS 也要一起下载、执行，拖慢可交互时间。

懒水合把"显示"和"能交互"拆开：HTML 一开始就完整，首屏内容和 SEO 都不受影响；组件的 JS 等到真正需要时才加载和执行。

### Vue 的写法

Vue 的 `defineAsyncComponent` 支持 `hydrate` 选项，只在 SSR 应用里有效。内置策略要单独导入：

| 策略 | 什么时候水合 |
| --- | --- |
| `hydrateOnIdle(timeout?)` | 浏览器空闲时，可以传一个最大等待时间 |
| `hydrateOnVisible(options?)` | 元素进入视口时，参数是 IntersectionObserver 选项 |
| `hydrateOnMediaQuery(query)` | 媒体查询匹配时 |
| `hydrateOnInteraction(events)` | 组件元素上发生指定事件时 |

```ts
import { defineAsyncComponent, hydrateOnVisible } from 'vue'

const Comments = defineAsyncComponent({
  loader: () => import('./Comments.vue'),
  // 距离视口还有 200px 时就开始水合
  hydrate: hydrateOnVisible({ rootMargin: '200px' }),
})
```

也可以自己写策略：函数签名是 `(hydrate, forEachElement) => teardown?`，条件满足时调用 `hydrate()`。

### Nuxt 的写法

Nuxt 在这套 API 上做了模板语法。组件名要带 `Lazy` 前缀，一个组件只能用一种策略：

```vue
<template>
  <LazyArticleComments hydrate-on-visible @hydrated="onHydrated" />
  <LazySiteFooter hydrate-on-idle />
  <LazyShareMenu hydrate-on-interaction="mouseover" />
  <LazyMobileNav hydrate-on-media-query="(max-width: 768px)" />
  <LazyNewsTicker :hydrate-after="2000" />
  <LazyPriceChart :hydrate-when="isReady" />
  <LazyStaticBanner hydrate-never />
</template>
```

- `hydrate-on-interaction` 不传值时，默认监听 `pointerenter`、`click`、`focus`
- `hydrate-on-idle` 可以传一个数字作为最长等待时间，默认值以所用版本为准
- `hydrate-after` 是毫秒数，`hydrate-when` 是布尔值，`hydrate-never` 永不水合
- 组件水合完成时触发 `@hydrated` 事件

在 `<script>` 里显式 import 的组件，用 `defineLazyHydrationComponent(strategy, source)`，strategy 取 `'visible'`、`'idle'`、`'interaction'`、`'mediaQuery'`、`'if'`、`'time'`、`'never'`：

```ts
const LazyChart = defineLazyHydrationComponent(
  'visible',
  () => import('./components/PriceChart.vue'),
)
// 模板里：<LazyChart :hydrate-on-visible="{ rootMargin: '100px' }" />
```

它是编译器宏，两个参数都要直接写字面量，不能从变量传进来。

### 和其他方案的区别

| 方案 | 服务端渲染 HTML | 客户端水合 |
| --- | --- | --- |
| 懒水合 | 渲染 | 推迟到条件满足 |
| `<ClientOnly>` | 不渲染，只有占位 | 挂载后在客户端渲染 |
| islands（`.server.vue`） | 渲染 | 永不水合，没有组件的 JS |

`hydrate-never` 看起来和服务端组件很像，但组件代码还是普通组件，props 变化就会触发水合；内容纯展示、永远不需要交互的，用 [岛屿架构](/basics/ssr/08-islands) 里讲的服务端组件更合适。

## 面试官可能追问

::: details 组件还没水合时用户点了它，会怎样？
这时 DOM 上没有绑定事件，点击本身不会触发组件逻辑。Vue 的 `hydrateOnInteraction` 会在水合完成后重放触发水合的那个事件，所以第一次点击不会丢。其他策略没有这个机制，例如用 `hydrate-on-visible` 的按钮在水合前被点击，这次点击就没有效果，所以需要马上响应交互的组件不适合懒水合。
:::

::: details 懒水合的组件 props 变了会怎样？
会立即水合。Nuxt 文档明确说任何 prop 变化都会触发懒水合组件马上水合。所以如果父组件频繁改它的 props，懒水合就失去了意义。多个组件共享同一个 `v-model` 状态时也可能一起被触发水合。
:::

::: details 为什么写了 hydrate-on-visible 却没有效果？
常见原因：组件名没带 `Lazy` 前缀；同一个组件写了多个策略；用 `v-bind` 展开对象传 props，文档要求在模板里逐个声明；从 `#components` 直接 import 的组件也不支持，要改用 `defineLazyHydrationComponent`。另外组件在首屏可见区域内时，`hydrateOnVisible` 会立即水合，看起来就像没生效。
:::

## 易错点

- 把首屏马上要用的组件（搜索框、导航菜单）做成懒水合，用户点了没反应
- 以为懒水合会让 HTML 里少一块内容。HTML 照常渲染，推迟的只是 JS 和水合
- 对有交互的组件用 `hydrate-never`，它永远不会响应事件
- 一个组件同时写 `hydrate-on-visible` 和 `hydrate-on-idle`，只能选一种策略
