---
difficulty: 3
tags: [手写题, 性能优化]
---

# 手写虚拟列表：定高和不定高的列表分别怎么实现？

::: tip 一句话回答
虚拟列表**只渲染可视区域加上下缓冲区的几十个元素**：用一个高度等于列表总高度的占位元素撑出滚动条，渲染的那一段用 `transform` 平移到正确位置。**定高**时起始索引直接是 `Math.floor(scrollTop / 行高)`；**不定高**时先按预估高度排布，渲染后测量真实高度，维护每一项的**累计位置数组**，用**二分查找**根据 `scrollTop` 找起始项，某项高度变了就修正它后面所有项的位置。
:::

## 详细解析

### 整体结构

容器固定高度、可以滚动；里面放一个高度等于列表总高度的**占位元素**，只负责撑出滚动条；再放一个绝对定位的**内容层**，只渲染第 `start` 到 `end - 1` 项，用 `translateY(offset)` 移到正确位置。每次滚动只做三件事：读 `scrollTop`，算出区间和偏移，更新渲染。DOM 数量固定在几十个，和数据总量无关。为什么长列表会卡、和分页、时间分片怎么选，见 [上万条数据的列表怎么渲染不卡？](/basics/browser/13-long-list)，这题讲完整实现。

### 定高

第一个可见项是 `Math.floor(scrollTop / itemHeight)`，最后一个可见项之后是 `Math.ceil((scrollTop + viewportHeight) / itemHeight)`；两头各加 `buffer` 项，再夹到 `[0, count]` 之间。偏移是 `start * itemHeight`，总高度是 `count * itemHeight`。

### 不定高

1. 每项先按预估高度计算位置，`tops[i]` 是第 i 项的顶部，`tops[count]` 就是总高度
2. 元素渲染后用 `ResizeObserver` 测量真实高度，写回缓存。图片加载、文字折行导致的高度变化也能捕获
3. 某一项高度变了，它后面所有项的 `tops` 都要变。用"脏标记"记下最早变化的位置，读取时再从那里往后重算一遍，避免一帧里多次测量反复计算
4. `tops` 是递增的，用二分查找"最后一个 `tops[i] <= scrollTop` 的项"，复杂度 O(log n)
5. 可视区**上方**的元素测量后变高，内容整体下移，画面会跳一下。测量时如果该项在当前起始项之前，就把高度差加到 `scrollTop` 上，保持看到的内容不动

### 滚动、缓冲区和定位

`scroll` 事件很频繁，用 `requestAnimationFrame` 合并，一帧只算一次。缓冲区太小，快速滚动时会看到白屏；太大又抵消了虚拟化的收益，一般上下各几项到一屏。滚动到第 N 项：定高直接设 `scrollTop = N * itemHeight`；不定高设成 `tops[N]`，但目标附近的项还没测量过，渲染后位置可能有偏差，要在测量后再校正一次。

## 代码示例：核心计算

和框架无关的位置缓存（定高的公式见上文）：

```js
export class SizeCache {
  constructor(count, estimated) {
    this.count = count
    this.heights = new Array(count).fill(estimated)
    this.tops = new Array(count + 1).fill(0) // tops[count] 是总高度
    this.dirtyFrom = 0                       // 从这一项开始位置需要重算
  }
  setHeight(index, height) { // 返回高度差，用来修正 scrollTop
    const diff = height - this.heights[index]
    if (diff) { this.heights[index] = height; this.dirtyFrom = Math.min(this.dirtyFrom, index + 1) }
    return diff
  }
  ensure() { // 懒更新：读取时才从最早变化的项往后重算
    for (let i = Math.max(1, this.dirtyFrom); i <= this.count; i++) this.tops[i] = this.tops[i - 1] + this.heights[i - 1]
    this.dirtyFrom = this.count + 1
  }
  top(index) { this.ensure(); return this.tops[index] }
  get totalHeight() { return this.top(this.count) }
  findIndex(offset) { // 二分查找最后一个 top <= offset 的项
    this.ensure()
    let lo = 0, hi = this.count - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.tops[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  getRange(scrollTop, viewportHeight, buffer = 5) {
    const start = Math.max(0, this.findIndex(scrollTop) - buffer)
    const end = Math.min(this.count, this.findIndex(scrollTop + viewportHeight - 1) + 1 + buffer)
    return { start, end, offset: this.top(start) }
  }
}
```

## 代码示例：Vue 组件外壳

```vue
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, useTemplateRef } from 'vue'
import { SizeCache } from './size-cache'

const props = defineProps({ items: Array, estimated: { type: Number, default: 50 } })
const box = useTemplateRef('box')
const cache = new SizeCache(props.items.length, props.estimated)
const scrollTop = ref(0), height = ref(0), version = ref(0) // version：高度缓存变化时加一
const total = computed(() => (version.value, cache.totalHeight))
const range = computed(() => (version.value, cache.getRange(scrollTop.value, height.value)))

let raf = 0
function onScroll() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => { scrollTop.value = box.value.scrollTop })
}
const ro = new ResizeObserver((entries) => {
  for (const e of entries) {
    const index = Number(e.target.dataset.index)
    const diff = cache.setHeight(index, e.borderBoxSize[0].blockSize)
    if (diff && index < range.value.start) box.value.scrollTop += diff // 上方变高，画面不跳
  }
  version.value++
})
onMounted(() => { height.value = box.value.clientHeight })
onBeforeUnmount(() => { ro.disconnect(); cancelAnimationFrame(raf) })
</script>

<template>
  <div ref="box" style="height: 100%; overflow: auto; position: relative" @scroll="onScroll">
    <div :style="{ height: total + 'px' }"></div>
    <div :style="{ position: 'absolute', inset: '0 0 auto', transform: `translateY(${range.offset}px)` }">
      <template v-for="i in range.end - range.start" :key="range.start + i - 1">
        <div :ref="(el) => el && ro.observe(el)" :data-index="range.start + i - 1">
          <slot :item="items[range.start + i - 1]" :index="range.start + i - 1" />
        </div>
      </template>
    </div>
  </div>
</template>
```

## 面试官可能追问

::: details 为什么用 transform 而不是给每一项设 top？
`transform` 只影响合成，不触发重排，滚动时更流畅。也可以给内容层设 `padding-top`，或者每项绝对定位设 `top`，原理一样，只是每项定位要多维护一份样式。
:::

::: details 位置缓存为什么不在每次 setHeight 时立刻重算？
一帧里可能有几十项同时测量完成，每次都从该项往后重算，就是 O(n) 乘以测量次数。记下最早变化的索引，等真正读取位置时只重算一遍，代价降到一次 O(n)。
:::

::: details 图片加载后高度变了怎么办？
`ResizeObserver` 观察的是元素本身，图片撑高元素后会再次回调，走同样的"更新高度、修正后续位置、必要时调整 scrollTop"流程。能提前知道图片宽高比时，用 `aspect-ratio` 先占好位置，从源头上减少跳动。
:::

## 易错点

- 二分查找的条件是"最后一个 `top <= scrollTop`"，写成"第一个 `top >= scrollTop`"会在两项交界处差一位
- 结束索引忘记夹到 `count`，滚到底时会访问越界的数据
- 不定高时只改了变化那一项的高度，没有修正它后面的位置，列表会重叠或出现空隙
- `key` 要用数据 id 或真实索引，用切片后的相对下标，滚动时测量到的高度会记到错误的项上
- 上面的外壳为了简短省略了两件事：`items` 变化时要按新长度重建 `SizeCache`；元素卸载时要 `ro.unobserve` 它，否则观察的节点只增不减
