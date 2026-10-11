---
difficulty: 2
tags: [高频, 原理]
---

# nextTick 的原理是什么？什么时候用？

::: tip 一句话回答
Vue 修改数据后不会立即更新 DOM，而是把组件的更新任务放进队列，在**微任务**中统一批量执行，所以同一轮同步代码里多次修改数据只会渲染一次。`nextTick` 返回一个 Promise，回调会在这一轮 DOM 更新完成之后执行，Vue 3 中它基于 `Promise.resolve().then` 实现。修改数据后需要读取更新后的 DOM 时用它，比如获取元素高度、滚动到列表底部、让输入框获得焦点。
:::

## 详细解析

### 异步更新队列

1. 响应式数据变化，触发组件的更新任务入队。同一个任务只会入队一次，重复修改不会重复入队
2. 第一次有任务入队时，用 `Promise.resolve().then(flushJobs)` 安排一次微任务
3. 当前同步代码执行完，微任务开始执行：按组件的创建顺序依次执行所有更新任务，保证父组件先于子组件更新
4. `nextTick` 的回调排在这次更新之后，所以执行时 DOM 已经是最新的

微任务的执行时机见 [浏览器的事件循环](/basics/javascript/01-event-loop)。

### 简化实现

下面是核心思路，真实源码还要给任务排序、检测无限递归更新等：

```js
const queue = new Set()
const resolvedPromise = Promise.resolve()
let currentFlushPromise = null

// 响应式数据变化时，组件的更新函数通过它入队
function queueJob(job) {
  queue.add(job) // Set 自动去重：同一个组件只更新一次
  if (!currentFlushPromise) {
    currentFlushPromise = resolvedPromise.then(flushJobs)
  }
}

function flushJobs() {
  queue.forEach((job) => job())
  queue.clear()
  currentFlushPromise = null
}

function nextTick(fn) {
  // 有更新在排队时，排在这次更新之后；否则就是下一个微任务
  const p = currentFlushPromise || resolvedPromise
  return fn ? p.then(fn) : p
}
```

Vue 2 要兼容不支持 Promise 的旧浏览器，所以 `nextTick` 有降级策略：Promise → MutationObserver → setImmediate → setTimeout。

### 什么时候用

```vue
<script setup>
import { ref, nextTick } from 'vue'

const count = ref(0)
const btn = ref(null)

async function increment() {
  count.value++
  console.log(btn.value.textContent) // 0：DOM 还没更新

  await nextTick()
  console.log(btn.value.textContent) // 1：DOM 已经更新
}
</script>

<template>
  <button ref="btn" @click="increment">{{ count }}</button>
</template>
```

常见场景都是"改完数据，马上要用新的 DOM"：

```js
// messages、editing 是数据 ref，listEl、inputEl 是模板 ref
async function addMessage(text) {
  messages.value.push(text)
  await nextTick()
  // 新消息已经渲染出来，再滚动到底部
  listEl.value.scrollTop = listEl.value.scrollHeight
}

async function startEdit() {
  editing.value = true
  await nextTick()
  // 输入框刚通过 v-if 渲染出来，这时才能获得焦点
  inputEl.value.focus()
}
```

除了 `await nextTick()`，也可以传入回调：`nextTick(() => { ... })`。

如果是在 `watch` 中想读取更新后的 DOM，可以设置 `flush: 'post'`，让回调在 DOM 更新之后执行；`watch` 默认在组件更新之前执行，读到的是旧 DOM。详见 [computed 和 watch 的区别](/basics/vue/15-computed-vs-watch)。

## 面试官可能追问

::: details 连续修改同一个数据 100 次，会渲染几次？
一次。每次修改都会尝试把组件的更新任务入队，但队列里同一个任务只会有一个。等同步代码执行完，微任务里只渲染一次，渲染时读到的是最终的值。默认配置下的 `watch` 回调也只会执行一次，除非设置了 `flush: 'sync'`。
:::

::: details nextTick 和 setTimeout 有什么区别？
`nextTick` 基于 Promise，是微任务，当前同步代码执行完就会执行，早于下一个宏任务，也早于浏览器渲染；`setTimeout` 是宏任务，要等所有微任务执行完，中间还可能经过一次渲染才执行。用 `setTimeout` 通常也能读到更新后的 DOM，但时机更晚、不好控制，语义也不清楚。
:::

::: details Vue 为什么要异步更新 DOM？
如果同步更新，每修改一次数据就要重新渲染一次，一个事件处理函数里改了几个数据就会渲染几次，中间状态的渲染都是浪费。异步批量更新把同一轮的修改合并成一次渲染，还能按父到子的顺序执行，避免重复渲染，提升性能。
:::

## 易错点

- 修改数据后 DOM 不会立即更新，直接读取拿到的是旧值
- `nextTick` 要在修改数据**之后**调用：如果先调用，它的回调可能排在更新任务前面，读到的仍是旧 DOM
- `nextTick` 只保证 DOM 已经更新，不代表浏览器已经完成绘制
