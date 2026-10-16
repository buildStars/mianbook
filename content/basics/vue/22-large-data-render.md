---
difficulty: 2
tags: [高频, 性能优化]
---

# Vue 渲染大量数据时怎么优化？

::: tip 一句话回答
数据量大时慢在两处：**把数据变成响应式**的开销，和**一次性创建大量 DOM** 的开销。前者用 `shallowRef`、`markRaw`、`Object.freeze` 跳过深度代理；后者用分页、**分批渲染**（每帧渲染一部分）或**虚拟列表**只渲染可见区域。再配合 `v-memo` 减少重复 diff，把 `v-for` 里的计算挪到 computed 里提前算好。
:::

## 详细解析

### 先分清慢在哪

拿到一万条数据赋给 `ref`，Vue 会在访问时把每个对象、每个嵌套对象都包成 Proxy，并为读到的属性收集依赖。然后 `v-for` 一次创建一万个组件或元素，浏览器还要做布局和绘制。打开 Performance 面板看：长任务里 Vue 的 patch 占大头，就是 DOM 太多；访问数据就卡，就是响应式开销。全局的优化清单见 [Vue 性能优化](/basics/vue/19-performance)，这里只讲数据量大这一个场景。

### 减少响应式开销

列表数据通常是"整体替换、很少改单个字段"的，没必要深度响应式。

| 手段 | 效果 | 适用 |
| --- | --- | --- |
| `shallowRef(list)` | 只有 `.value` 本身是响应式，替换整个数组才触发更新 | 接口拿到的列表、表格数据 |
| `markRaw(obj)` | 这个对象永远不会被代理 | 地图实例、图表实例、第三方类实例 |
| `Object.freeze(list)` | 冻结的对象 Vue 不会代理 | 纯展示、不会修改的数据 |

用 `shallowRef` 后，`list.value.push(x)` 不会触发更新，要写成 `list.value = [...list.value, x]`，或者改完调用 `triggerRef(list)`。

### 减少 DOM 数量

- **分页或加载更多**：最简单，能用就用
- **分批渲染**：数据要一次全部展示时，每帧往渲染列表里追加一批，让浏览器有机会响应交互和绘制。总耗时不变，但不会长时间卡死
- **虚拟列表**：只渲染可视区域加少量缓冲，DOM 数量和总数据量无关。原理见 [长列表优化](/basics/browser/13-long-list)，Vue 里可以用现成的虚拟滚动组件

### 减少更新时的开销

- **`v-memo`**：给 `v-for` 的每一项传一个依赖数组，数组没变时整个子树跳过 diff。典型场景是"选中某一行"，只有选中状态变化的两行需要更新
- **拆子组件**：每行是一个组件时，父组件更新只要 props 没变，子组件就不会重新渲染
- **不在模板里做重计算**：`v-for="item in list.filter(...)"` 每次渲染都会重新过滤，提前用 computed 算好
- **key 用稳定的 id**，原因见 [key 的作用](/basics/vue/06-key)

## 代码示例

```vue
<script setup lang="ts">
import { shallowRef, ref, onMounted } from 'vue'

interface Row { id: number; name: string }

const all = shallowRef<Row[]>([])     // 原始数据，不做深度代理
const visible = shallowRef<Row[]>([]) // 已经渲染出来的部分
const selectedId = ref<number | null>(null)

function renderInChunks(rows: Row[], size = 200) {
  let i = 0
  const step = () => {
    // 每帧追加一批，整体替换才会触发 shallowRef 更新
    visible.value = visible.value.concat(rows.slice(i, i + size))
    i += size
    if (i < rows.length) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

onMounted(async () => {
  all.value = await fetch('/api/rows').then((r) => r.json())
  renderInChunks(all.value)
})
</script>

<template>
  <div
    v-for="row in visible"
    :key="row.id"
    v-memo="[row.id === selectedId]"
    :class="{ active: row.id === selectedId }"
    @click="selectedId = row.id"
  >
    {{ row.name }}
  </div>
</template>
```

## 面试官可能追问

::: details 分批渲染和虚拟列表怎么选？
分批渲染只解决"首次卡顿"，最终 DOM 还是全量的，滚动和后续更新依然重，适合几千条以内、需要 Ctrl+F 搜索或打印的场景。虚拟列表 DOM 数量恒定，适合上万条，代价是行高不固定时实现复杂，页面内搜索也找不到没渲染的行。
:::

::: details v-memo 有什么坑？
依赖数组漏写了某个会变的值，那一项就不会更新，界面显示旧数据，而且很难发现。所以只在确实测出瓶颈时用，并且依赖要写全。它和 `v-for` 一起用时要写在同一个元素上。
:::

::: details shallowRef 和 Object.freeze 有什么区别？
`shallowRef` 只是 Vue 不做深层代理，数据本身还能改，改完手动触发更新即可。`Object.freeze` 让数据真的不可变，修改会静默失败（严格模式下报错），只适合纯展示。替换整个数组时两者都能触发更新。
:::

## 易错点

- 用了 `shallowRef` 后还按习惯 `push` 或改某一项的字段，界面不更新，以为是 Vue 的 bug
- 分批渲染用 `setTimeout(fn, 0)` 也能工作，但 `requestAnimationFrame` 和渲染节奏一致，更不容易掉帧；页面在后台时 rAF 会暂停
- 只做了数据层优化，DOM 还是一次渲染一万个，卡顿依然存在，两方面要一起看
