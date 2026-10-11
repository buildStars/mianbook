---
difficulty: 2
tags: [高频, 性能优化]
---

# Vue 项目有哪些性能优化手段？

::: tip 一句话回答
按层次回答：**加载层面**减少首屏要下载的代码，如路由懒加载、异步组件、组件库按需引入；**渲染层面**减少不必要的渲染，如合理使用 `v-if` / `v-show`、稳定的 `key`、`v-memo`、计算属性、虚拟滚动和 `KeepAlive`；**响应式层面**减少代理的开销，大型数据用 `shallowRef`，不需要响应式的对象用 `markRaw`；**运行时**做好防抖节流，及时清理定时器和事件监听。动手优化之前，先用工具找到真正的瓶颈。
:::

## 详细解析

### 加载层面

- **路由懒加载**：`component: () => import('./views/Report.vue')`，每个页面单独打包，访问时才加载
- **异步组件**：弹窗、图表这类首屏用不到的大组件，用 `defineAsyncComponent(() => import('./Chart.vue'))` 延迟加载
- **组件库按需引入**：只打包用到的组件和样式，比如 Element Plus 配合 unplugin-vue-components 自动按需导入
- **分析打包体积**：用 rollup-plugin-visualizer 等工具找出体积大的依赖。压缩、CDN、缓存等通用手段详见 [前端性能优化](/basics/browser/10-performance-optimization)

### 渲染层面

| 手段 | 说明 |
| --- | --- |
| `v-if` / `v-show` | 频繁切换用 `v-show`，很少切换用 `v-if`，详见 [`v-if` 和 `v-show` 的区别](/basics/vue/05-v-if-v-show) |
| 稳定的 `key` | 列表用唯一 id 作为 key，不要用 index，详见 [key 的作用](/basics/vue/06-key) |
| `v-once` | 只渲染一次，之后的更新全部跳过，适合渲染后不再变化的内容 |
| `v-memo` | Vue 3.2 起，依赖数组不变时跳过整个子树的更新，适合大列表 |
| 计算属性 | 缓存派生数据，依赖不变就不重新计算，详见 [computed 和 watch 的区别](/basics/vue/15-computed-vs-watch) |
| 虚拟滚动 | 长列表只渲染可视区域内的元素，详见 [长列表渲染](/basics/browser/13-long-list) |
| `KeepAlive` | 缓存切换掉的页面，切回来不用重新渲染，详见 [keep-alive 的作用和原理](/basics/vue/14-keep-alive) |

还有两点容易被忽视：

- **保持 props 稳定**：父组件更新时，Vue 会对比传给子组件的 props，没有变化的子组件会跳过渲染。如果在模板中写 `:options="{ size: currentSize }"` 这样的对象字面量，每次渲染都会生成一个新对象，子组件就会跟着更新，在 props 中写内联的箭头函数也是同理。这类对象可以改用 `computed` 生成。列表项只接收和自己相关的值，比如传 `:active="item.id === activeId"`，而不是把 `activeId` 传给每一项，这样切换选中项时只有两项需要更新
- **不在模板中调用开销大的方法**：模板中调用的方法每次渲染都会重新执行，需要缓存结果的改用计算属性

### 响应式层面

- **`shallowRef` / `shallowReactive`**：只有第一层是响应式的。几千条的列表、大型 JSON、图表数据这类一般整体替换的数据，用它们可以省掉深层代理和依赖收集的开销
- **`markRaw`**：标记一个对象，让它永远不会被转成响应式。适合第三方库的实例（如图表、地图实例）和大型静态配置，这类对象被代理不但浪费性能，有时还会让库工作异常

### 运行时

- 输入框搜索、滚动、resize 这类高频事件要做防抖或节流，详见 [防抖和节流](/basics/javascript/13-debounce-throttle)
- 组件卸载时清理定时器、全局事件监听和第三方库实例，避免内存泄漏，详见 [常见的内存泄漏](/basics/javascript/16-memory-leak)

### 定位问题

- **Vue DevTools**：用它的性能分析功能查看各个组件渲染、更新的耗时，找出渲染慢或者更新太频繁的组件
- **Chrome Performance 面板**：录制一段操作，找出长任务和耗时的函数。开发环境下设置 `app.config.performance = true`，还能在面板中看到每个组件初始化、渲染、更新的耗时标记

## 代码示例

```vue
<script setup>
import { ref, shallowRef, onMounted } from 'vue'
import { fetchRows } from './api'

// 数据量大、一般整体替换：只追踪 .value 本身，不会深度代理每一行
const rows = shallowRef([])
const selectedId = ref(null)

onMounted(async () => {
  rows.value = await fetchRows()
})

function rename(id, name) {
  // ❌ 直接修改内部属性不会触发更新
  // rows.value.find((row) => row.id === id).name = name

  // ✅ 生成新数组，整体替换 .value
  rows.value = rows.value.map((row) => (row.id === id ? { ...row, name } : row))
}
</script>

<template>
  <!-- 依赖数组没变的行直接跳过更新：切换选中项时，只有选中状态变化的两行会重新渲染 -->
  <div
    v-for="row in rows"
    :key="row.id"
    v-memo="[row.id === selectedId, row.name]"
    :class="{ active: row.id === selectedId }"
    @click="selectedId = row.id"
  >
    {{ row.name }}
  </div>
</template>
```

## 面试官可能追问

::: details `v-memo` 适合什么场景？
列表很长、每次只有少数几项变化、而且每一项的渲染开销不小的场景，比如带选中状态的大表格。依赖数组要包含所有会影响这一项渲染结果的值，漏写会导致该更新的地方不更新。和 `v-for` 一起使用时，要写在同一个元素上。`v-memo` 属于微优化，大多数场景用不到，确认是性能瓶颈后再用。
:::

::: details 为什么大型数据适合用 `shallowRef`？
`ref` 包裹对象时会用 `reactive` 做深度转换：访问到的每一层对象都要创建 Proxy，读取属性时还要做依赖收集，数据量大时内存和 CPU 的开销都很明显。`shallowRef` 只追踪 `.value` 本身，里面是普通对象。代价是修改内部属性不会触发更新，要整体替换 `.value`，或者修改后手动调用 `triggerRef()`。
:::

::: details 如何找到渲染慢的组件？
- 用 Vue DevTools 的性能分析功能，查看各个组件渲染和更新的耗时
- 开发环境下开启 `app.config.performance`，在 Chrome Performance 面板中查看组件级的耗时标记，再结合火焰图找到耗时的函数
- 怀疑组件更新太频繁时，用 `onRenderTriggered` 钩子（只在开发环境有效）打印出是哪个依赖触发了重新渲染
:::

## 易错点

- `shallowRef` 内部属性的修改不会触发更新，要整体替换 `.value`
- `v-memo` 的依赖数组写漏了，会导致界面不更新
- 路由组件直接用 `() => import()` 懒加载即可，不需要再用 `defineAsyncComponent` 包裹
