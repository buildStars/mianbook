---
difficulty: 3
tags: [手写题, 场景题, 高频]
---

# 怎么实现一个带并发上限的请求调度器？

::: tip 一句话回答
维护一个**等待队列**和一个**正在运行的计数**：一开始启动 N 个任务，之后每完成一个（无论成败）就计数减一，再从队列里取下一个补上，所以同时运行的永远不超过 N 个。结果按任务的**下标**写入数组，顺序和传入顺序一致；每个任务的成败都单独记录，像 `Promise.allSettled` 一样，一个失败不影响其他。传入的必须是返回 Promise 的**函数**：直接传 Promise 的话，请求在创建时就已经发出，调度器无法再控制并发。
:::

## 详细解析

### 题目要求

- 传入一组任务（返回 Promise 的函数）和并发上限 N，同时最多 N 个在执行，其余排队
- 完成一个立刻补一个，而不是"每 N 个一批、整批完成再开始下一批"：分批的话，一批里最慢的那个会拖住整批
- 结果按传入顺序返回；单个失败不影响其他任务，最后拿到每一项的成败
- 常见场景：批量上传文件、批量拉取接口、爬虫，避免同时发出太多请求被浏览器排队或被服务端限流

### 两种写法

核心相同：启动任务时计数加一，任务结束时计数减一，再尝试启动下一个。**实现一**一次性传入所有任务，用"下一个任务的下标"代替队列，返回全部结果，适合"跑完这一批"的场景；**实现二**是类似 p-limit 的 `limit` 函数，每次调用 `limit(fn)` 把任务放进队列，返回一个和该任务结果绑定的 Promise，可以随时追加任务，配合 `Promise.allSettled` 拿到按顺序排列的结果。

## 代码示例：实现一，任务下标 + 运行计数

```js
// tasks 是返回 Promise 的函数数组；结果按传入顺序排列，格式和 Promise.allSettled 一致
function runWithLimit(tasks, limit) {
  return new Promise((resolve) => {
    const results = new Array(tasks.length)
    let next = 0 // 下一个要启动的任务下标
    let running = 0 // 正在执行的任务数
    let settled = 0 // 已经结束的任务数
    if (tasks.length === 0) return resolve(results)
    function launch() {
      // 有空位、还有任务就继续启动：一开始跑满 limit 个，之后完成一个补一个
      while (running < limit && next < tasks.length) {
        const i = next++
        running++
        new Promise((r) => r(tasks[i]())) // 任务同步抛错也会变成 rejected
          .then(
            (value) => (results[i] = { status: 'fulfilled', value }), // 按下标存，和完成顺序无关
            (reason) => (results[i] = { status: 'rejected', reason }), // 失败只记录，不影响其他任务
          )
          .then(() => {
            running--
            settled++
            settled === tasks.length ? resolve(results) : launch()
          })
      }
    }
    launch()
  })
}
```

## 代码示例：实现二，limit 函数

```js
function createLimit(concurrency) {
  const queue = [] // 排队中的任务
  let active = 0
  const next = () => {
    while (active < concurrency && queue.length > 0) {
      active++
      const { fn, resolve, reject } = queue.shift()
      // 任务的结果原样交给 limit 返回的 Promise；结束后释放名额，再启动下一个
      new Promise((r) => r(fn())).then(resolve, reject).finally(() => { active--; next() })
    }
  }
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject })
    next()
  })
}

// 用法：const limit = createLimit(3); await Promise.allSettled(urls.map((url) => limit(() => fetch(url))))
```

### 测试：用 setTimeout 模拟请求

```js
const t0 = Date.now()
let current = 0 // 当前正在执行的请求数
const time = () => `${Math.round((Date.now() - t0) / 100) * 100}ms`.padStart(6)
// 模拟请求：ms 毫秒后成功，fail 为 true 时失败
const fakeRequest = (id, ms, fail = false) => () => {
  console.log(`${time()} 开始 ${id}，进行中 ${++current} 个`)
  return new Promise((resolve, reject) => setTimeout(() => {
    console.log(`${time()} 结束 ${id}${fail ? '（失败）' : ''}`)
    current--
    fail ? reject(new Error(`${id} 失败`)) : resolve(`结果 ${id}`)
  }, ms))
}
const tasks = [fakeRequest(1, 300), fakeRequest(2, 100), fakeRequest(3, 400, true), fakeRequest(4, 100), fakeRequest(5, 200)]

const results = await runWithLimit(tasks, 2)
// 换成实现二：const limit = createLimit(2)，再 await Promise.allSettled(tasks.map((task) => limit(task)))，输出相同
console.log(results.map((r) => (r.status === 'fulfilled' ? r.value : r.reason.message)))
```

```text
   0ms 开始 1，进行中 1 个
   0ms 开始 2，进行中 2 个
 100ms 结束 2
 100ms 开始 3，进行中 2 个      ← 2 一结束就补上 3，不用等 1
 300ms 结束 1
 300ms 开始 4，进行中 2 个
 400ms 结束 4
 400ms 开始 5，进行中 2 个
 500ms 结束 3（失败）            ← 3 失败不影响 5 继续执行
 600ms 结束 5
[ '结果 1', '结果 2', '3 失败', '结果 4', '结果 5' ]
```

## 面试官可能追问

::: details 怎么支持优先级？
入队时按优先级插入，而不是直接 push：用 `queue.findIndex((job) => job.priority < priority)` 找到第一个优先级比它低的任务（数字越大越先执行），把新任务插在它前面，找不到就放到末尾，同优先级的保持先来先服务。任务很多时，插入是 O(n)，可以换成堆（优先队列），见 [堆和 Top K](/basics/algorithm/06-heap-topk)。
:::

::: details 怎么取消任务？
给 `limit(fn, { signal })` 传一个 AbortController 的 signal，分两种情况：还在排队的，监听 abort 事件，把它从队列里移除，并以 `signal.reason` 拒绝；已经在运行的，调度器停不下它，要把 signal 传给任务本身，比如 `fetch(url, { signal })`，请求被中止后任务失败，名额照常释放。加入队列前 signal 已经是 aborted 的，直接拒绝。
:::

::: details 怎么动态调整并发数？
暴露一个修改上限的方法，改完立刻调用一次 `next()`：调大时，`while` 循环会马上补满新增的名额；调小时不打断正在运行的任务，只是等运行数降到新上限以下才启动新任务。比如根据服务端返回的 429 自动调小，恢复正常后再调大。
:::

## 易错点

- 传入 Promise 数组而不是函数数组：Promise 一创建请求就已经发出，调度器只能等结果，控制不了并发
- 只在成功时补位，失败时忘了减计数或启动下一个，名额被永久占住，最后整个调度卡死
- 在一个受限任务内部，用同一个 limit 再调度子任务并等待它们：外层占着名额等子任务，子任务又在排队等名额，会死锁
