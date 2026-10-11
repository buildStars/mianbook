---
difficulty: 1
tags: [高频]
---

# computed 和 watch 有什么区别？

::: tip 一句话回答
`computed` 用于从已有状态**派生出新值**：带缓存，依赖不变时多次读取不会重新计算；是惰性的，被读取时才计算；getter 应该是没有副作用的纯函数。`watch` 用于在数据变化时**执行副作用**，比如发请求、操作 DOM、写入本地存储，能拿到新值和旧值，也可以执行异步操作。能用 `computed` 表达的，就不要用 `watch` 去手动同步另一个状态。
:::

## 详细解析

### 对比

| | computed | watch |
| --- | --- | --- |
| 用途 | 根据已有状态派生新值 | 数据变化时执行副作用 |
| 返回值 | 一个 ref，默认只读 | 用来停止监听的函数 |
| 缓存 | 有，依赖不变就返回上次的结果 | 无 |
| 执行时机 | 惰性，被读取时才计算 | 数据源变化后执行回调，默认创建时不执行 |
| 异步 | 不应该，getter 要同步返回结果 | 可以 |
| 新值和旧值 | 无（Vue 3.4 起 getter 能拿到上一次的计算结果） | 回调参数中有 |

### computed

- 缓存基于响应式依赖：依赖变化时只做标记，下次读取时才重新计算，原理详见 [Vue 3 的响应式原理](/basics/vue/01-reactivity)
- 在模板中调用方法也能得到同样的结果，但方法每次渲染都会执行一遍，`computed` 只在依赖变化后才重新计算
- getter 中不要修改其他状态、发异步请求或操作 DOM
- 可以通过 `get` / `set` 定义可写的计算属性，在 `set` 中修改源数据。比如"全选"复选框：`get` 判断是否每一项都已勾选，`set` 把每一项都设为同样的状态

### watch

数据源可以是 ref、reactive 对象、getter 函数，或者由它们组成的数组。

- 直接监听一个 reactive 对象时，会**隐式开启深度监听**，任何嵌套属性变化都会触发回调
- 监听 reactive 对象的某个属性时要写成 getter，例如 `watch(() => state.count, cb)`；写成 `watch(state.count, cb)` 传进去的只是一个数字，监听不到变化

| 选项 | 作用 |
| --- | --- |
| `immediate` | 创建时立即执行一次回调 |
| `deep` | 深度监听；Vue 3.5 起可以传数字，限制遍历的最大深度 |
| `flush` | 回调的执行时机：默认 `'pre'`，在所属组件的 DOM 更新前执行；`'post'` 在 DOM 更新后执行；`'sync'` 在数据变化时同步执行 |
| `once` | Vue 3.4 起，回调只执行一次 |

**watchEffect**：不需要指定数据源，创建时立即执行一次，并自动收集回调中用到的响应式数据作为依赖。它只追踪同步执行部分访问的数据，第一个 `await` 之后访问的数据不会被收集。

### 停止、暂停和清理

- `watch` 和 `watchEffect` 都返回一个函数，调用它就能停止监听。在 `setup` 中同步创建的侦听器会在组件卸载时自动停止，在异步回调中创建的要手动停止
- Vue 3.5 起，这个返回值上还有 `pause()` 和 `resume()` 方法，可以暂停和恢复监听。暂停期间如果数据变了，恢复后会补执行一次回调
- **清理副作用**：用回调的第三个参数 `onCleanup` 注册清理函数，它会在下一次回调执行前、以及侦听器停止时调用，适合取消上一次还没完成的请求。Vue 3.5 起也可以从 `vue` 中导入 `onWatcherCleanup`，但它只能在回调的同步部分调用，不能放在 `await` 之后

## 代码示例

搜索框：关键词变化时发请求，并取消上一次还没完成的请求，避免旧请求后返回、覆盖新结果。

```vue
<script setup>
import { ref, watch } from 'vue'

const keyword = ref('')
const results = ref([])

watch(keyword, async (value, oldValue, onCleanup) => {
  if (!value.trim()) {
    results.value = []
    return
  }

  const controller = new AbortController()
  // 关键词再次变化时，会先执行这里注册的清理函数，取消这次请求
  onCleanup(() => controller.abort())

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(value)}`, {
      signal: controller.signal,
    })
    results.value = await res.json()
  } catch (err) {
    // 被取消的请求会抛出 AbortError，忽略即可
    if (err.name !== 'AbortError') console.error(err)
  }
})
</script>

<template>
  <input v-model="keyword" placeholder="搜索文章" />
  <ul>
    <li v-for="item in results" :key="item.id">{{ item.title }}</li>
  </ul>
</template>
```

## 面试官可能追问

::: details computed 里能发请求吗？
不应该。computed 的 getter 只负责根据依赖算出一个值，它是惰性、带缓存的，什么时候执行、执行几次取决于它什么时候被读取，放进副作用会让请求时机不可控。而且 getter 必须同步返回结果，拿不到异步请求的返回值。正确的做法是用 `watch` 监听参数，请求完成后把结果写进一个 ref，展示用的数据再用 computed 从这个 ref 派生。
:::

::: details 监听一个 reactive 对象默认是深度监听吗？
是的，直接把 reactive 对象作为数据源时会隐式深度监听。但下面两种情况默认不是：

- 数据源是返回对象的 getter，如 `() => state.user`，只有 `state.user` 被整体替换时才触发，修改 `state.user.name` 不会触发，需要加 `deep: true`
- 用 `ref` 包着一个对象，`watch(userRef, cb)` 默认只在 `.value` 被替换时触发

深度监听要遍历所有嵌套属性，对象很大时有性能开销。
:::

::: details 怎么处理 watch 中的请求竞态？
竞态是指先发出的请求后返回，用旧结果覆盖了新结果。处理方法：

- 用 `onCleanup`（或 Vue 3.5 的 `onWatcherCleanup`）在下一次回调执行前取消上一次请求，如上面代码中的 `AbortController`
- 请求无法取消时，在清理函数中把一个"已过期"标记设为 `true`，请求返回后检查这个标记，过期就丢弃结果
- 配合防抖，从源头上减少请求次数，详见 [防抖和节流](/basics/javascript/13-debounce-throttle)
:::

## 易错点

- `watch(state.count, cb)` 监听不到变化，要写成 `watch(() => state.count, cb)`
- 对象被原地修改时，深度监听回调中的新值和旧值指向同一个对象，无法直接对比
- `watchEffect` 只收集同步部分的依赖，`await` 之后用到的数据变化时不会触发它
