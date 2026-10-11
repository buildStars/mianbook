---
difficulty: 2
tags: [实践]
---

# 常见的内存泄漏有哪些？怎么排查？

::: tip 一句话回答
内存泄漏是指不再需要的对象仍然**可达**，垃圾回收无法释放它们，内存只增不减。常见原因有意外的全局变量、没清除的定时器、没移除的事件监听、游离的 DOM、无限增长的缓存，以及组件卸载时没清理订阅和第三方库实例。排查用 Chrome DevTools：先在 Performance 面板确认内存持续上涨，再在 Memory 面板对比操作前后的**堆快照**，通过 Retainers 找到是谁还引用着它。
:::

## 详细解析

### 常见场景

| 场景 | 原因 | 解决 |
| --- | --- | --- |
| 意外的全局变量 | 给未声明的变量赋值，或在非严格模式下直接调用的函数里写 `this.x = ...`，变量挂到了全局对象上 | 使用严格模式（ES Module 默认就是）；变量都用 `let` / `const` 声明 |
| 没清除的定时器 | `setInterval` 的回调一直被浏览器持有，回调引用的数据也无法释放 | 不再需要时调用 `clearInterval` |
| 没移除的事件监听 | 在 `window`、`document` 这类长期存在的对象上添加监听，回调和它引用的对象一直存活 | 成对地调用 `removeEventListener` |
| 闭包持有大对象 | 长期存活的函数通过[闭包](/basics/javascript/02-closure)引用着外层的大对象 | 只保留需要的数据，用完解除引用 |
| 游离 DOM（detached DOM） | 节点已经从页面移除，但仍被 JS 变量、数组或 Map 引用 | 移除节点时一起清掉引用 |
| 无限增长的缓存 | `Map`、数组只增不删 | 设置上限（如 LRU）；以对象为键的缓存改用 `WeakMap` |
| 组件卸载时没清理 | 事件总线订阅、WebSocket 连接、图表和地图等第三方库实例没有销毁 | 在卸载钩子里取消订阅、调用实例的销毁方法 |
| `console.log` 打印的对象 | DevTools 打开时，控制台会保留被打印的对象，方便随时展开查看 | 去掉调试日志 |

游离 DOM 还有一个特点：只要引用了其中一个子节点，整棵被移除的子树都会被保留，因为子节点能通过 `parentNode` 访问到父节点。

### 代码示例：组件卸载后监听还在

```js
// ❌ 用匿名函数在 window 上添加监听，卸载时没有移除，也没有销毁图表（el、chart 的声明同下）
onMounted(() => {
  chart = echarts.init(el.value)
  window.addEventListener('resize', () => chart.resize())
})
```

组件卸载后，`window` 仍然持有这个匿名回调，回调又通过闭包引用着 `chart`，图表实例和它持有的 DOM、数据都无法回收；组件每挂载一次，还会多一个监听。修复后（Vue 3 `<script setup>`）：

```js
import { ref, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts'

const el = ref(null) // 模板中绑定到图表容器
let chart = null
const onResize = () => chart.resize()

onMounted(() => {
  chart = echarts.init(el.value)
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  // 移除时必须传入添加时的同一个函数
  window.removeEventListener('resize', onResize)
  chart.dispose() // 销毁第三方库实例
  chart = null
})
```

需要移除多个监听时，也可以给 `addEventListener` 传入 `AbortController` 的 `signal`，卸载时调用一次 `abort()` 全部移除。

### 排查步骤

1. **确认是否泄漏**：Performance 面板勾选 Memory 后录制，反复执行同一个操作（如打开再关闭弹窗），中途点 Collect garbage 按钮手动触发回收。如果每轮操作后 JS 堆都回落不到原来的水平，整体呈阶梯状上升，就可能有泄漏
2. **对比堆快照**：在 Memory 面板选 Heap snapshot，操作前拍一张，重复操作几次后再拍一张。在第二张快照中切换到 Comparison 视图，看哪些对象新增了却没有被释放；选中对象后，下方的 Retainers 面板会显示它的引用链，顺着引用链就能找到是谁一直持有它
3. **找游离 DOM**：在快照的类名筛选框中输入 Detached，可以看到已经脱离文档、但仍被引用的 DOM 节点
4. **定位分配位置**：Allocations on timeline（旧版 Chrome 叫 Allocation instrumentation on timeline）在录制期间持续记录内存分配，可以看到哪个时间段分配的内存一直没被回收，进而定位到对应的操作和代码

## 面试官可能追问

::: details WeakMap 为什么能避免一部分内存泄漏？
WeakMap 对键是弱引用：键对象在别处都不再被引用后就可以被回收，对应的值也随之释放，不需要手动删除。所以给 DOM 节点、组件实例这类对象关联数据时，用 WeakMap 就不怕忘记清理。但它只能解决"键已经不用了，却忘了从集合里删除"这一类问题，键还被别处引用时照样不会回收，详见 [Map 和 WeakMap](/basics/javascript/19-map-weakmap)。
:::

::: details Node.js 服务的内存泄漏怎么排查？
- 用 `process.memoryUsage()` 定期记录 `heapUsed`，看它是否随时间持续上升
- 用 `node --inspect` 启动服务，在 Chrome 中打开 `chrome://inspect` 连接，用同样的 Memory 面板在压测前后各拍一张堆快照对比
- 不方便连接调试器时，可以调用 `v8.writeHeapSnapshot()` 生成快照文件，再放到 DevTools 中加载分析
- 常见原因：全局缓存只增不减；在长期存在的 EventEmitter 上反复添加监听（同一个事件的监听超过 10 个时，Node.js 会打印 MaxListenersExceededWarning 警告）
:::

::: details 单页应用中怎么验证路由切换后没有泄漏？
从页面 A 进入页面 B 再返回 A，反复多次，然后手动触发垃圾回收并拍堆快照，和第一次的快照对比：页面 B 的组件实例、游离 DOM 节点的数量不应该随切换次数增长。也可以打开 Performance monitor 面板，实时观察 JS 堆大小、DOM 节点数和事件监听器数量在切换后能否回落。
:::

## 易错点

- 内存上涨不等于泄漏：垃圾回收是按需进行的，要看手动触发回收后内存能否回落
- `removeEventListener` 必须传入添加时的**同一个**函数（`capture` 也要一致），匿名函数没法移除
- 排查时注意 `console.log` 的干扰：DevTools 打开时，被打印过的对象会一直被保留
