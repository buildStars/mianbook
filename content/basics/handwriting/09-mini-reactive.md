---
difficulty: 3
tags: [手写题, 原理]
---

# 手写一个简易响应式系统：reactive 和 effect 怎么实现？

::: tip 一句话回答
用 **Proxy** 代理对象：`get` 里**收集依赖**，把"当前正在执行的 effect"记到这个属性名下；`set` 里**触发更新**，把记下的 effect 重新执行一遍。依赖存成 `WeakMap<target, Map<key, Set<effect>>>`。要处理好几个细节：嵌套 effect 用**栈**恢复外层、每次执行前**清理旧依赖**应对分支切换、值没变不触发，再通过 **scheduler** 把多次修改合并成一次异步更新。
:::

## 详细解析

### 依赖的存储结构

依赖分三层存：WeakMap 以原始对象为键，值是一个 Map；Map 以属性名为键，值是依赖这个属性的 effect 组成的 Set。外层用 WeakMap，原始对象不再被使用时，它的依赖会跟着被垃圾回收；Set 保证同一个 effect 在同一个属性上只记一次。每个 effect 还反向记下自己被放进了哪些 Set，清理时直接从这些 Set 里删掉自己。

### 几个容易漏掉的细节

- **activeEffect 和栈**：effect 执行期间把自己设为 activeEffect，`get` 只在它存在时收集。effect 里再嵌套 effect（比如父组件渲染时创建子组件）时，内层执行完要恢复成外层，否则外层后面读到的属性就收集不到了，所以用栈保存
- **分支切换要清理**：`state.ok ? state.text : 'off'`，ok 变成 false 后不再读 text，但 text 的 Set 里还留着这个 effect。所以每次执行前先把自己从所有 Set 里删掉，执行时重新收集
- **不触发自己**：effect 里写了 `state.count++`，既读又写，要跳过当前正在执行的 effect，否则无限递归

## 代码示例：手写 reactive 和 effect

```js
const targetMap = new WeakMap()
const effectStack = []
let activeEffect = null

function track(target, key) {
  if (!activeEffect) return
  let depsMap = targetMap.get(target)
  if (!depsMap) targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep) depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
  activeEffect.deps.push(dep) // 反向记录，清理时用
}

function trigger(target, key) {
  const dep = targetMap.get(target)?.get(key) ?? []
  for (const effectFn of [...dep]) { // 遍历副本
    if (effectFn === activeEffect) continue // 不触发自己
    effectFn.scheduler ? effectFn.scheduler(effectFn) : effectFn()
  }
}

function reactive(obj) {
  return new Proxy(obj, {
    get(target, key, receiver) {
      track(target, key)
      const res = Reflect.get(target, key, receiver)
      return res !== null && typeof res === 'object' ? reactive(res) : res // 读到时才代理深层对象
    },
    set(target, key, value, receiver) {
      const oldValue = target[key]
      const ok = Reflect.set(target, key, value, receiver)
      if (!Object.is(oldValue, value)) trigger(target, key) // 值没变不触发，Object.is 能正确处理 NaN
      return ok
    },
  })
}

function effect(fn, options = {}) {
  const effectFn = () => {
    effectFn.deps.splice(0).forEach((dep) => dep.delete(effectFn)) // 清空并清理旧依赖
    effectStack.push(effectFn)
    activeEffect = effectFn
    try {
      return fn() // 执行期间重新收集依赖
    } finally {
      effectStack.pop()
      activeEffect = effectStack[effectStack.length - 1] ?? null // 恢复外层 effect
    }
  }
  Object.assign(effectFn, { deps: [], scheduler: options.scheduler })
  if (!options.lazy) effectFn()
  return effectFn
}

// ===== 测试（node 里以 ESM 运行） =====
const state = reactive({ ok: true, text: 'hello', count: 0 })
effect(() => console.log('count:', state.count)) // count: 0
state.count++ // count: 1
state.count = 1 // 值没变，不输出

let runs = 0
effect(() => (runs++, state.ok ? state.text : 'off'))
state.ok = false // 重新执行，这次只读了 ok
state.text = 'world' // 已经不依赖 text，不执行
console.log('runs:', runs) // runs: 2

effect(() => {
  effect(() => state.text) // 内层 effect
  console.log('outer:', state.count) // 内层执行完后，外层仍能收集到 count
}) // outer: 1
state.count = 2 // count: 2  outer: 2
```

有 scheduler 时，trigger 不直接执行 effect，而是交给 scheduler 决定什么时候执行。把 effect 放进 Set 去重，在微任务里统一执行，同步代码里改多少次都只更新一次。Vue 的组件更新和 [nextTick](/basics/vue/09-next-tick) 就是这个思路：

```js
const queue = new Set()
function queueJob(job) {
  if (queue.size === 0) queueMicrotask(flush) // 第一个任务入队时安排一次刷新
  queue.add(job)
}
function flush() {
  const jobs = [...queue]
  queue.clear()
  jobs.forEach((job) => job())
}
const s = reactive({ n: 0 })
effect(() => console.log('render', s.n), { scheduler: queueJob }) // render 0
for (let i = 0; i < 3; i++) s.n++
console.log('同步代码结束') // 同步代码结束，之后只输出一次 render 3
```

## 面试官可能追问

::: details computed 怎么基于它实现？
用 `lazy: true` 创建一个不立即执行的 effect，再加一个 dirty 标记。读 `.value` 时，dirty 为 true 才执行 getter 并缓存结果；依赖变化时，scheduler 不重新计算，只把 dirty 设为 true，再 trigger 读过这个 computed 的 effect。所以依赖不变时多次读取直接返回缓存值，没人读就不计算。
:::

::: details 和 Vue 3 的真实实现差在哪？
- 拦截不全：没处理 `has`（`in` 操作）、`ownKeys`（遍历）、`deleteProperty`；数组的 `push` 会读写 `length`，Map、Set 的方法也要单独代理
- 每次读深层对象都新建 Proxy，`state.nested === state.nested` 为 false，Vue 用一个 WeakMap 缓存代理
- 嵌套 effect 每次重新执行都会新建内层 effect，旧的没有停止；Vue 由组件卸载或 effectScope 统一停止。Vue 的内部实现还在持续优化，但"读时收集、写时触发"的模型不变，见 [Vue 3 的响应式原理](/basics/vue/01-reactivity)
:::

::: details 为什么用 Reflect.get 并传 receiver？
对象里有 getter 时，`receiver` 保证 getter 里的 `this` 指向代理对象，getter 内部访问的其他属性也会经过 `get`，被收集为依赖。直接写 `target[key]`，getter 里的 `this` 是原始对象，这部分依赖就丢了。
:::

## 易错点

- 不清理旧依赖，分支切换后无关属性的修改仍会触发 effect
- 嵌套 effect 只用一个变量记录 activeEffect，内层结束后外层的依赖收集不到
- trigger 直接遍历 dep 的 Set 会死循环：effect 执行时先被删除又被重新加入，Set 的遍历会再次访问到它，所以要遍历副本
