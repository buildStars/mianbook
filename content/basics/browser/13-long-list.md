---
difficulty: 3
tags: [场景题, 性能优化]
---

# 上万条数据的列表怎么渲染不卡？

::: tip 一句话回答
卡顿的根源是 **DOM 节点太多**：首次渲染慢、内存占用高，后续的滚动和更新也慢。产品上能接受时优先用**分页或"加载更多"**；必须一次展示全部数据时用**虚拟列表**，只渲染可视区域加上下缓冲区的几十个元素，用一个总高度的占位元素撑出滚动条。**时间分片**能缓解首次渲染的卡顿，但 DOM 总量并没有减少。
:::

## 详细解析

### 为什么会卡

一次插入上万个节点，样式计算、布局、绘制的工作量都很大，会长时间占用主线程；每个节点都占内存，用框架时还要加上组件实例和响应式数据；之后任何引起样式重算和布局的操作，代价都随节点数量增加。

### 方案对比

| 方案 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| 分页 / 加载更多 | 每次只请求和渲染一部分 | 最简单，接口压力也小 | "加载更多"越滚越多，最终还是会卡 |
| 时间分片 | 分批插入，每帧只渲染一批 | 首次渲染不卡，改动小 | DOM 总量不变，内存和更新问题还在 |
| 虚拟列表 | 只渲染可视区域内的元素 | DOM 数量恒定，数据再多也流畅 | 实现复杂；页内搜索（Ctrl + F）搜不到没渲染的内容 |
| `content-visibility: auto` | 浏览器跳过屏幕外元素的渲染工作 | 只改 CSS，内容仍能被页内搜索 | 节点仍然全部存在，只节省渲染开销 |

> 使用 `content-visibility: auto` 时，一般还要用 `contain-intrinsic-size` 给出预估尺寸，否则屏幕外的元素高度按 0 计算，滚动条会跳动。

### 时间分片

用 `requestAnimationFrame` 每帧插入一批（见 [rAF 和 rIC](/basics/browser/14-raf-ric)），每批先在 `DocumentFragment` 里组装好再一次性插入。每帧的工作量有限，主线程不会被长时间占用，用户能先看到前面的内容。

```js
function renderInChunks(list, container, chunkSize = 200) {
  let index = 0
  function renderChunk() {
    const fragment = document.createDocumentFragment()
    const end = Math.min(index + chunkSize, list.length)
    for (; index < end; index++) {
      const li = document.createElement('li')
      li.textContent = list[index].text
      fragment.appendChild(li)
    }
    container.appendChild(fragment)
    if (index < list.length) requestAnimationFrame(renderChunk) // 下一帧继续
  }
  requestAnimationFrame(renderChunk)
}
```

### 虚拟列表

容器固定高度、可以滚动，并监听 `scroll`。里面放一个**占位层**，高度等于总条数乘以每项高度，只负责撑出滚动条；再放一个**内容层**，只渲染可见范围内的元素，用 `transform`（或 `padding`）把它们移到正确的位置。

**定高**时，滚动后的计算很简单：

- `startIndex = Math.floor(scrollTop / itemHeight)`
- `endIndex = startIndex + 可视条数 + 缓冲条数`，可视条数是 `Math.ceil(容器高度 / itemHeight)`
- 内容层的偏移量 = `startIndex * itemHeight`

上方通常也留几条缓冲：渲染起点取 `Math.max(0, startIndex - 缓冲条数)`，偏移量改用这个起点计算。

**不定高**时：

1. 先给每一项一个预估高度，算出每一项的位置并缓存
2. 渲染后测量真实高度（可以用 `ResizeObserver`），更新缓存，修正后面各项的位置和总高度
3. 位置数组是递增的，根据 `scrollTop` 查找起始项时可以用二分查找

成熟的库：Vue 的 vue-virtual-scroller、框架无关的 TanStack Virtual（Vue 中用 @tanstack/vue-virtual）、React 的 react-window。

## 代码示例

一个定高虚拟列表的 Vue 组件：

```vue
<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  items: { type: Array, required: true },
  itemHeight: { type: Number, default: 50 }, // 每项的固定高度
  height: { type: Number, default: 500 }, // 容器高度
  buffer: { type: Number, default: 5 }, // 上下各多渲染几条
})

const scrollTop = ref(0)
const totalHeight = computed(() => props.items.length * props.itemHeight)

const range = computed(() => {
  const start = Math.floor(scrollTop.value / props.itemHeight)
  const visibleCount = Math.ceil(props.height / props.itemHeight)
  return {
    start: Math.max(0, start - props.buffer),
    end: Math.min(props.items.length, start + visibleCount + props.buffer),
  }
})
const visibleItems = computed(() => props.items.slice(range.value.start, range.value.end))
const offset = computed(() => range.value.start * props.itemHeight)

function onScroll(e) {
  scrollTop.value = e.target.scrollTop
}
</script>

<template>
  <div class="viewport" :style="{ height: height + 'px' }" @scroll="onScroll">
    <!-- 占位层：撑出完整的滚动高度 -->
    <div :style="{ height: totalHeight + 'px' }"></div>
    <!-- 内容层：只渲染可见的几十条，整体平移到当前位置 -->
    <div class="content" :style="{ transform: `translateY(${offset}px)` }">
      <div v-for="item in visibleItems" :key="item.id" :style="{ height: itemHeight + 'px' }">
        {{ item.text }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.viewport { position: relative; overflow-y: auto; }
.content { position: absolute; top: 0; left: 0; right: 0; }
</style>
```

## 面试官可能追问

::: details 快速滚动时出现白屏怎么办？
浏览器的滚动通常由合成线程处理，不等主线程；而虚拟列表要在主线程上根据 `scroll` 事件重新渲染。滚得太快时，新区域的元素还没渲染出来就进入了视口。可以增大缓冲区（比如上下各多渲染一屏）；滚动过程中先显示轻量的占位（骨架），停下来再渲染完整内容；同时让每一项的渲染尽量轻。
:::

::: details 虚拟列表怎么"滚动到第 N 项"？
定高时直接设置 `container.scrollTop = N * itemHeight`，触发 `scroll` 后列表会渲染那一段。不定高时从位置缓存里取第 N 项的位置（没测量过的用预估值）滚过去，渲染后根据真实高度再修正一两次。成熟的库都提供了类似 `scrollToIndex` 的方法。
:::

::: details 表格做虚拟化要注意什么？
- 表头要固定：放在滚动区域外，或者用 `position: sticky`
- 列宽要固定或预先算好。表格默认按内容自动计算列宽，只渲染部分行时，列宽会随可见内容变化而跳动，可以用 `table-layout: fixed`，或者用 div 加 CSS Grid 实现表格
- 列很多时还要做横向虚拟化，只渲染可见的列；左右冻结的列要单独处理
:::

## 易错点

- 时间分片只解决首次渲染的卡顿，DOM 总量没变，节点多了照样卡
- 虚拟列表的容器必须有固定高度并且可以滚动，否则算不出可视区域
- 不定高列表只用预估高度不修正，会导致滚动条跳动、位置错乱
