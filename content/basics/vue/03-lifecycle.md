---
difficulty: 1
tags: [高频]
---

# Vue 的生命周期有哪些？各阶段适合做什么？

::: tip 一句话回答
组件的生命周期分为**创建、挂载、更新、卸载**四个阶段，每个阶段前后各有一个钩子：`beforeCreate` / `created`、`beforeMount` / `mounted`、`beforeUpdate` / `updated`、`beforeUnmount` / `unmounted`。组合式 API 中 `setup` 本身替代了创建阶段的两个钩子，其余的改为 `onMounted` 这类函数。数据请求可以在 `setup` 或 `created` 中尽早发起，操作 DOM 放在 `mounted`，定时器和事件监听在卸载前后清理。
:::

## 详细解析

### 各阶段的钩子

| 选项式 API | 组合式 API | 这时的状态和适合做的事 |
| --- | --- | --- |
| `beforeCreate` | `setup()` 本身 | props 已解析，`data`、`computed` 还没初始化，很少使用 |
| `created` | `setup()` 本身 | 响应式数据已就绪，可以尽早发起数据请求；还不能访问 DOM |
| `beforeMount` | `onBeforeMount` | 即将首次渲染，DOM 还没创建，很少使用 |
| `mounted` | `onMounted` | DOM 已创建并插入：操作 DOM，初始化图表、编辑器等依赖 DOM 的库 |
| `beforeUpdate` | `onBeforeUpdate` | 数据已变、DOM 还没更新：读取更新前的 DOM 状态 |
| `updated` | `onUpdated` | DOM 已更新：读取更新后的 DOM，**不要在这里修改状态** |
| `beforeUnmount` | `onBeforeUnmount` | 组件仍然完整可用：清理定时器、事件监听、第三方库实例 |
| `unmounted` | `onUnmounted` | 子组件都已卸载，组件的 `watch`、`computed` 已停止：做最后的清理 |

Vue 2 中的 `beforeDestroy` / `destroyed` 在 Vue 3 中改名为 `beforeUnmount` / `unmounted`，见 [Vue 3 相比 Vue 2 有哪些变化](/basics/vue/02-vue3-vs-vue2)。

### 其他钩子

选项式 API 中的名字是去掉 `on` 前缀、首字母小写，比如 `activated`、`errorCaptured`。

| 组合式 API | 触发时机 |
| --- | --- |
| `onActivated` / `onDeactivated` | 被 `<KeepAlive>` 缓存的组件激活、失活时，详见 [keep-alive 的作用和原理](/basics/vue/14-keep-alive) |
| `onErrorCaptured` | 捕获到后代组件抛出的错误时；返回 `false` 可以阻止错误继续向上传播 |
| `onServerPrefetch` | 仅用于 SSR，在服务端渲染组件之前预取数据，详见 [SSR 和水合](/basics/vue/18-ssr-hydration) |
| `onRenderTracked` / `onRenderTriggered` | 仅用于开发调试：查看渲染收集了哪些依赖、是哪个依赖触发了重新渲染 |

### 组合式 API 的注意事项

- `setup` 在所有选项式钩子之前执行，比 `beforeCreate` 还早
- 钩子必须在 `setup` **同步执行期间**注册。在 `setup` 里调用的组合式函数中注册没问题，但在 `setTimeout` 等异步回调里注册是无效的，开发环境会给出警告：

```js
onMounted(() => console.log('mounted')) // ✅ setup 同步执行期间注册

setTimeout(() => {
  // ❌ 此时 setup 早已执行完，钩子不会生效
  onMounted(() => console.log('不会执行'))
}, 100)
```

- 不要在 `updated` 中修改响应式状态：修改会触发新一轮更新，更新完又执行 `updated`，可能陷入无限循环。想在某个数据变化后读取 DOM，用 [nextTick](/basics/vue/09-next-tick) 或 `watch` 的 `flush: 'post'` 选项

## 代码示例

```vue
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'

const list = ref([])
const chartEl = ref(null)
let chart = null
let timer = null

async function loadList() {
  const res = await fetch('/api/list')
  list.value = await res.json()
}

// setup 执行时就发起请求，不必等到挂载
loadList()

const onResize = () => chart.resize()

onMounted(() => {
  // DOM 已经创建，可以初始化依赖 DOM 的第三方库
  chart = echarts.init(chartEl.value)
  window.addEventListener('resize', onResize)
  timer = setInterval(loadList, 30000)
})

onBeforeUnmount(() => {
  // 清理定时器、事件监听和第三方库实例，避免内存泄漏
  clearInterval(timer)
  window.removeEventListener('resize', onResize)
  chart.dispose()
})
</script>

<template>
  <ul>
    <li v-for="item in list" :key="item.id">{{ item.name }}</li>
  </ul>
  <div ref="chartEl" style="height: 300px"></div>
</template>
```

## 面试官可能追问

::: details 父子组件的生命周期执行顺序是怎样的？
父组件先开始、后完成，子组件的过程嵌套在中间：

- 挂载：父 `beforeMount` → 子 `beforeMount` → 子 `mounted` → 父 `mounted`
- 更新（父组件的变化影响到子组件）：父 `beforeUpdate` → 子 `beforeUpdate` → 子 `updated` → 父 `updated`
- 卸载：父 `beforeUnmount` → 子 `beforeUnmount` → 子 `unmounted` → 父 `unmounted`

子组件的 `setup`、`created` 在父组件 `beforeMount` 之后执行。所以在父组件的 `mounted` 中，同步的子组件都已经挂载完成。
:::

::: details 数据请求放在 created 还是 mounted？
两者都可以，差别不大。请求是异步的，不管在哪里发起，数据返回时组件一般都已经挂载，首次渲染不会等请求结果。放在 `setup` 或 `created` 中能稍早一点发起请求。要注意两点：

- 依赖 DOM 的初始化放在 `mounted` 中；拿到数据后要读取据此更新的 DOM，还要等 `nextTick`
- SSR 时 `beforeMount`、`mounted` 不会在服务端执行，而 `setup`、`created` 在服务端和客户端都会执行，访问 `window`、`document` 的代码不能放在这里
:::

::: details 为什么 setup 中没有 this？
`setup` 在 `data`、`methods`、`computed` 等选项处理之前执行，如果提供 `this`，它的行为会和其他选项里的 `this` 不一致，容易混淆，所以 `setup` 中的 `this` 是 `undefined`。组合式 API 本身也不需要 `this`：状态就是普通变量，props 和 `emit`、`attrs`、`slots` 通过 `setup` 的两个参数获取，`<script setup>` 中则用 `defineProps`、`defineEmits` 等编译宏。不依赖 `this` 也让类型推导更简单。
:::

## 易错点

- `setup` 比 `beforeCreate` 还早执行，不是夹在 `beforeCreate` 和 `created` 之间
- `mounted` 只保证同步子组件已经挂载，异步组件和 `<Suspense>` 内的组件不一定
- 组合式 API 的钩子要在 `setup` 中同步注册，不能放在异步回调里
