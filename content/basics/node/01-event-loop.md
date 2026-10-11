---
difficulty: 2
tags: [高频, 输出题]
---

# Node.js 事件循环：nextTick、Promise、setTimeout、setImmediate 谁先执行？

::: tip 一句话回答
同步代码最先执行；之后先清空 `process.nextTick` 队列，再清空 Promise 微任务队列；然后进入事件循环的各个阶段：`setTimeout` 在 timers 阶段执行，`setImmediate` 在 check 阶段执行。在主模块里 `setTimeout(fn, 0)` 和 `setImmediate` 谁先执行不确定；在 I/O 回调里一定是 `setImmediate` 先执行。
:::

## 详细解析

### 事件循环的六个阶段

```text
   ┌───────────────────────────┐
┌─>│           timers          │  setTimeout / setInterval 的回调
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │     pending callbacks     │  上一轮推迟的部分系统回调
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │       idle, prepare       │  内部使用
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │           poll            │  等待并执行 I/O 回调
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │           check           │  setImmediate 的回调
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
└──┤      close callbacks      │  如 socket.on('close')
   └───────────────────────────┘
```

每执行完一个回调，Node 都会先清空 `process.nextTick` 队列，再清空 Promise 微任务队列，然后才执行下一个回调。

## 代码示例

```js
// CommonJS 模块中执行
setTimeout(() => console.log('timeout'), 0)
setImmediate(() => console.log('immediate'))
process.nextTick(() => console.log('nextTick'))
Promise.resolve().then(() => console.log('promise'))
console.log('sync')
```

输出：`sync` → `nextTick` → `promise`，之后 `timeout` 和 `immediate` 的顺序**不确定**。

原因：`setTimeout(fn, 0)` 实际会被设为 1ms。事件循环启动时，如果已经过了 1ms，timers 阶段就会先执行 `timeout`；如果还没到，就跳过 timers，先在 check 阶段执行 `immediate`。

在 I/O 回调里顺序是确定的：

```js
const fs = require('node:fs')

fs.readFile(__filename, () => {
  setTimeout(() => console.log('timeout'), 0)
  setImmediate(() => console.log('immediate'))
})
// 一定先输出 immediate：I/O 回调在 poll 阶段执行，紧接着就是 check 阶段
```

## 面试官可能追问

::: details Node 11 前后，微任务的执行时机有什么变化？
```js
setTimeout(() => {
  console.log('t1')
  Promise.resolve().then(() => console.log('p1'))
})
setTimeout(() => console.log('t2'))
```

Node 11 及以后输出 `t1 p1 t2`：每执行完一个定时器回调就清空微任务，和浏览器一致。Node 10 及以前输出 `t1 t2 p1`：要等 timers 阶段的回调全部执行完，才清空微任务。
:::

::: details 递归调用 process.nextTick 会怎样？
`nextTick` 队列会一直被清空、又一直有新任务加入，事件循环无法进入下一个阶段，I/O 回调永远得不到执行，这叫 I/O 饥饿。需要"稍后执行"时，优先用 `setImmediate`。
:::

::: details 在 ES 模块（.mjs）里，nextTick 还一定比 Promise 先执行吗？
不一定。ES 模块的代码本身是在一个微任务中执行的，模块执行期间加入的 Promise 回调，会在同一轮微任务里先执行完，之后才轮到 `nextTick` 队列。所以上面的示例放在 `.mjs` 里，会先输出 `promise` 再输出 `nextTick`。
:::

## 易错点

- `process.nextTick` 不属于事件循环的任何阶段，它在当前操作完成后立即执行
- `setImmediate` 的意思不是"立即执行"，而是"在本轮 check 阶段执行"
