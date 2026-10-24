---
difficulty: 2
tags: [原理, 高频]
---

# watch 和 watchEffect 有什么区别？依赖是怎么收集的？flush 时机怎么选？

::: tip 一句话回答
`watch` **显式指定侦听源**，默认懒执行，回调能拿到新值和旧值；`watchEffect` **创建时立即执行一次**，运行期间读到哪些响应式数据就自动依赖哪些，但只收集**同步执行部分**的依赖，第一个 `await` 之后读到的不算。`flush` 决定回调什么时候跑：默认 `'pre'` 在组件更新前，`'post'` 在 DOM 更新后，`'sync'` 数据一变就同步触发。异步副作用用 `onWatcherCleanup` 或 `onCleanup` 取消上一次，避免竞态。
:::

## 详细解析

### 依赖从哪里来

两者底层都是一个响应式 effect，区别在于"谁来读数据"：

- `watch(source, cb)`：只执行 `source` 去收集依赖，回调 `cb` 里读到的数据不会被追踪。依赖和副作用是分开的，控制更精确
- `watchEffect(fn)`：直接执行 `fn`，执行期间读到的所有响应式属性都成为依赖。省掉了手写依赖列表，代价是依赖不够直观，函数里多读一个值就多一个触发条件

依赖收集靠的是"执行时有一个当前活跃的 effect"。`await` 会让函数先返回，后面的代码在微任务里继续执行，这时活跃的 effect 已经不是它了，所以读到的数据不会被记录。

### watch 的侦听源

源可以是 ref（包括 computed）、reactive 对象、getter 函数，或者由它们组成的数组。

- 直接传 reactive 对象：隐式深度侦听，嵌套属性变化时新值和旧值是同一个对象
- 侦听 reactive 对象的某个属性：`watch(state.count, cb)` 传进去的只是一个数字，Vue 会警告"Invalid watch source"，要写成 `watch(() => state.count, cb)`
- getter 返回对象：只有返回了另一个对象才触发，要侦听内部变化就加 `deep`

| 选项 | 说明 |
| --- | --- |
| `immediate` | 创建时立即执行一次回调，这时旧值是 `undefined` |
| `deep` | 深度遍历；较新的版本里可以传数字，表示最多遍历几层 |
| `once` | 回调只执行一次，之后自动停止 |
| `flush` | 回调执行时机，见下一节 |

`watchEffect` 的选项只有 `flush` 和调试用的 `onTrack` / `onTrigger`，没有 `immediate`、`deep`、`once`。

### flush 怎么选

| 值 | 时机 | 适合 |
| --- | --- | --- |
| `'pre'`（默认） | 父组件更新之后、本组件 DOM 更新之前，批量执行 | 大多数场景：根据数据发请求、同步别的状态 |
| `'post'` | 本组件 DOM 更新之后 | 需要读取更新后的 DOM，比如量尺寸、滚动到底 |
| `'sync'` | 数据一变就同步执行，不做批处理 | 极少用；简单布尔值，需要立刻响应 |

`watchPostEffect` 和 `watchSyncEffect` 分别是 `watchEffect` 加 `flush: 'post'` / `'sync'` 的简写。默认的 `'pre'` 和 `'post'` 会合并同一轮里的多次修改，往数组里同步 push 1000 次只触发一次回调；换成 `'sync'` 就会触发 1000 次。

### 清理副作用

侦听器重新执行前、或者被停止时，会先调用上一次注册的清理函数，典型用途是取消还没返回的请求：

- `onWatcherCleanup(fn)`：从 `vue` 导入，较新的版本才有。只能在回调**同步执行期间**调用，放在 `await` 之后不生效
- `onCleanup` 参数：`watch` 回调的第三个参数、`watchEffect` 函数的第一个参数。它绑定在侦听器实例上，不受同步调用的限制

停止和暂停侦听器、以及和 computed 怎么选，见 [computed 和 watch 有什么区别](/basics/vue/15-computed-vs-watch)。

## 代码示例

下面的代码在 Node.js 里直接引入 vue 运行过，注释里是实际输出。

```js
import { ref, watch, watchEffect, onWatcherCleanup, nextTick } from 'vue'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 1. await 之后读到的 b 不是依赖
const a = ref(1)
const b = ref(1)
let runs = 0
watchEffect(async () => {
  runs++
  a.value                 // ✅ 被追踪
  await sleep(0)
  b.value                 // ❌ 不被追踪
})
b.value++ // runs 仍是 1
a.value++ // runs 变成 2

// 2. 三种 flush 的顺序
const c = ref(0)
const log = []
watch(c, () => log.push('pre'))
watch(c, () => log.push('sync'), { flush: 'sync' })
watch(c, () => log.push('post'), { flush: 'post' })
c.value++
c.value++
await nextTick()
// ['sync', 'sync', 'pre', 'post']：sync 每次都触发，pre/post 合并成一次

// 3. 取消上一次请求
const id = ref(1)
watch(id, (newId) => {
  const controller = new AbortController()
  fetch(`/api/user/${newId}`, { signal: controller.signal }).catch(() => {})
  onWatcherCleanup(() => controller.abort()) // id 再变时先取消这次
})
```

想让 `await` 之后的数据也成为依赖，就在 `await` 之前先把它读出来，或者改用 `watch` 显式列出源。

## 面试官可能追问

::: details watchEffect 能完全替代 watch 吗？
不能。`watchEffect` 拿不到旧值，也不能懒执行；回调里读到的数据都会变成依赖，有时会触发得比预期频繁。需要对比新旧值、只想在某个值变化时才执行、或者回调里要读很多不相关的数据，都应该用 `watch`。
:::

::: details 为什么 flush: 'pre' 的回调里拿不到最新 DOM？
`'pre'` 的回调排在组件重新渲染之前执行，这时 DOM 还是旧的。要读新 DOM，可以设 `flush: 'post'`，或者在回调里 `await nextTick()`。原理见 [nextTick 的原理](/basics/vue/09-next-tick)。
:::

::: details onWatcherCleanup 和 onCleanup 参数有什么区别？
功能一样，都是在下次执行前或停止时调用清理函数。`onWatcherCleanup` 靠"当前活跃的侦听器"找到归属，所以必须同步调用；`onCleanup` 是侦听器传进来的，和具体实例绑定，`await` 之后调用也可以。写 async 回调又要在中途注册清理时，用 `onCleanup`。
:::

::: details 在 setTimeout 里创建的 watch 会自动停止吗？
不会。只有在 `setup` 里同步创建的侦听器才绑定到组件实例，组件卸载时自动停止。异步创建的要自己保存返回的句柄并手动调用，否则会泄漏。
:::

## 易错点

- `watchEffect` 里先 `await` 再读数据，以为能侦听到，实际只收集了 `await` 之前的依赖
- `watch(state.count, cb)` 侦听不到变化，要传 getter `() => state.count`
- 为了"立刻生效"把 `flush` 设成 `'sync'`，结果数组批量修改时回调被触发几百次
- `onWatcherCleanup` 写在 `await` 之后，清理函数根本没有注册上
