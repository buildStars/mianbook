---
difficulty: 2
tags: [手写题, 场景题]
---

# 怎么让异步任务按顺序执行？红绿灯循环用 Promise 怎么写？

::: tip 一句话回答
关键是**等上一个任务的 Promise 落定，再启动下一个**。两种写法：**reduce** 把任务串成一条 then 链，初始值是 `Promise.resolve()`；**for...of + await** 逐个等待，可读性更好，也是现在的首选。注意数组里要放"返回 Promise 的函数"而不是 Promise 本身，Promise 一创建任务就开始跑了。红绿灯就是"亮灯、sleep、换下一个灯"的无限循环，用递归 then 或 `while (true)` + await 都能写，要停下来就给 sleep 传 **AbortController** 的 signal。
:::

## 详细解析

### 任务必须是函数

```js
// ❌ 三个请求在创建数组时就同时发出了，后面怎么 await 都不是串行
const tasks = [fetch('/a'), fetch('/b'), fetch('/c')]
// ✅ 放函数，轮到它时才调用
const tasks = [() => fetch('/a'), () => fetch('/b'), () => fetch('/c')]
```

这是这道题最常见的错误。Promise 代表一个"已经在进行"的操作，它没有"启动"按钮。

### 两种串行写法

- **reduce**：`tasks.reduce((chain, task) => chain.then(() => task()), Promise.resolve())`。每一步都在上一个 then 里才调用 task，从而形成串行
- **for...of + await**：循环里 `await task()`，写法和同步代码一样，收集结果、错误处理都直观

注意 `forEach` 不行：它不会等回调返回的 Promise，`tasks.forEach(async (t) => await t())` 实际上是并发。async/await 的原理见 [async/await](/basics/javascript/12-async-await)。

### 三种异步编排的区别

| 需求 | 做法 |
| --- | --- |
| 全部同时跑 | `Promise.all` |
| 同时最多 N 个 | [并发上限调度器](/basics/handwriting/04-concurrency-limit) |
| 一个接一个 | 本题的串行写法 |

单个任务的超时和重试见 [超时和重试](/basics/handwriting/07-retry-timeout)。

### 红绿灯题目

要求：红灯 3 秒、绿灯 2 秒、黄灯 1 秒，一直循环。核心是一个返回 Promise 的 sleep，加一个循环。用 then 写时用递归实现循环；用 async 写就是 `while (true)`。死循环不会卡住线程，因为每次 await 都把控制权交了出去。

## 代码示例：串行执行和红绿灯

```js
// sleep 支持中断：signal 触发时清掉定时器并拒绝
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}

// 写法一：reduce 把任务串成一条 then 链
function runInOrder(tasks) {
  const results = []
  return tasks
    .reduce((chain, task) => chain.then(() => task()).then((r) => results.push(r)), Promise.resolve())
    .then(() => results)
}

// 写法二：for...of + await，可读性更好
async function runInOrderAsync(tasks) {
  const results = []
  for (const task of tasks) results.push(await task())
  return results
}

const job = (name, ms) => () => sleep(ms).then(() => { console.log(name, '完成'); return name })
runInOrder([job('A', 300), job('B', 100), job('C', 200)]).then(console.log)
// 300ms: A 完成  400ms: B 完成  600ms: C 完成  然后 [ 'A', 'B', 'C' ]

const lights = [['红', 3000], ['绿', 2000], ['黄', 1000]]

// then 写法：递归实现循环
function trafficLightThen(i = 0) {
  const [color, ms] = lights[i]
  console.log(color)
  return sleep(ms).then(() => trafficLightThen((i + 1) % lights.length))
}

// async 写法：可以用 signal 停下来
async function trafficLight(signal) {
  try {
    while (true) {
      for (const [color, ms] of lights) {
        console.log(color)
        await sleep(ms, signal)
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') throw err
    console.log('红绿灯已停止')
  }
}

const controller = new AbortController()
trafficLight(controller.signal) // 红 → 3s 后绿 → 2s 后黄 → 1s 后红 ...
setTimeout(() => controller.abort(), 7500) // 7.5s 时正亮着红灯，打印"红绿灯已停止"
```

`controller.abort()` 不传参数时，`signal.reason` 是一个 name 为 AbortError 的 DOMException，所以 catch 里按 name 判断，别的错误继续抛出。

## 面试官可能追问

::: details 串行执行时某个任务失败了怎么办？
默认两种写法都会在第一个失败处中断，外层 Promise 拒绝。要"失败也继续"，在循环里对单个任务 try/catch，把错误记进结果；或者把每个任务包成 allSettled 风格的 `{ status, value/reason }`。要不要继续，取决于后一个任务是否依赖前一个的结果。
:::

::: details 递归的 then 写法会不会栈溢出？
调用栈不会溢出：每次递归发生在定时器回调里，上一层的调用栈早已清空。但内存有隐患：外层 Promise 要跟随内层返回的 Promise，内层又跟随更内层的，永不结束的递归会让这条"等待链"一直变长，每轮都留下一个无法回收的 Promise，内存只增不减。在 Node 里实测：用 `Promise.resolve().then(loop)` 递归 3 秒，堆从几 MB 涨到上 GB；同样时长的 `while (true)` + await 堆基本不变。红绿灯每几秒才一轮，涨得很慢，但长期运行仍是泄漏。所以无限循环更推荐 `while (true)` + await 的写法，它只有一个 Promise 在等；坚持用 then 递归的话，回调里不要 return 内层 Promise，就不会形成链。
:::

::: details 不用 AbortController 怎么停下红绿灯？
可以在循环条件里检查一个外部标志，比如 `while (running)`，但它只能在当前灯亮完之后才停。用 signal 的好处是能立即打断正在进行的 sleep，并且同一个 signal 还能传给 fetch，一次取消整条任务链。
:::

## 易错点

- 数组里放的是 Promise 而不是函数，任务在创建时就全部并发了
- 用 forEach 加 async 回调，以为是串行
- reduce 的初始值忘了写 `Promise.resolve()`，第一个任务被当成了链的起点而不会被调用
- 中断时只清标志不清定时器，sleep 的 Promise 永远不落定
