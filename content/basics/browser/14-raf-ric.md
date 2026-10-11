---
difficulty: 2
tags: [原理]
---

# requestAnimationFrame 和 requestIdleCallback 有什么区别？

::: tip 一句话回答
`requestAnimationFrame`（rAF）在浏览器**下一次重绘之前**执行，频率跟随屏幕刷新率，适合动画和需要与渲染同步的 DOM 更新。`requestIdleCallback`（rIC）在浏览器**空闲时**才执行，回调能通过 `deadline.timeRemaining()` 知道还剩多少空闲时间，适合数据上报、预加载等低优先级任务。一个是"每帧必做"，一个是"有空再做"，rIC 里不要修改 DOM。
:::

## 详细解析

### 在一帧中的位置

```text
一帧（60Hz 屏幕约 16.7ms），简化来看：
处理输入事件、执行任务 → rAF 回调 → 样式计算 → 布局 → 绘制 → 还有剩余时间才执行 rIC 回调
```

rAF 回调既不是宏任务也不是微任务，它在事件循环的渲染步骤里、样式计算和布局之前执行（见[事件循环](/basics/javascript/01-event-loop)）。rIC 的回调只在浏览器进入空闲期时才会被安排执行：一帧中处理完输入和渲染后还有剩余时间，或者当前根本没有待处理的工作。

### 对比

| | requestAnimationFrame | requestIdleCallback |
| --- | --- | --- |
| 执行时机 | 每次重绘之前 | 浏览器空闲时 |
| 频率 | 跟随屏幕刷新率 | 不固定，浏览器一直忙就一直不执行 |
| 回调参数 | 一个高精度时间戳 | `deadline`，提供 `timeRemaining()` 和 `didTimeout` |
| 是否保证执行 | 页面可见时每帧执行；后台标签页暂停 | 不保证，可以传 `{ timeout }` 兜底 |
| 能否改 DOM | 可以，正是它的用途 | 不建议，交给 rAF |
| 适合 | 动画、与渲染同步的 DOM 更新 | 数据上报、预加载、非紧急计算 |
| 兼容性 | 所有现代浏览器 | 不如 rAF，要做特性检测和降级 |

### requestAnimationFrame 做动画

```js
// 让方块在 1 秒内向右移动 300px
const box = document.querySelector('.box')
const duration = 1000
let startTime = null

function step(timestamp) {
  if (startTime === null) startTime = timestamp
  // 按经过的时间算进度，不按帧数算：60Hz 和 120Hz 屏幕上动画时长一致
  const progress = Math.min((timestamp - startTime) / duration, 1)
  box.style.transform = `translateX(${progress * 300}px)`
  if (progress < 1) requestAnimationFrame(step) // 回调只执行一次，要继续就再次调用
}

requestAnimationFrame(step)
```

### requestIdleCallback 分批处理任务

- 回调参数 `deadline.timeRemaining()` 返回当前空闲期还剩多少毫秒，规范规定最长 50ms
- 传入 `{ timeout: 2000 }` 时，超过 2 秒还没执行，就会被放进任务队列强制执行，此时 `deadline.didTimeout` 为 `true`，`timeRemaining()` 为 0
- 任务要拆小，每做完一个就检查剩余时间，不够了就让出，下次空闲再继续
- 不要在 rIC 里修改 DOM：执行时这一帧的渲染可能已经结束，改 DOM 会让浏览器重新计算样式和布局，回调的耗时又不可控，容易导致掉帧。需要改 DOM 时，在 rIC 里算好结果，再交给 rAF 去更新

```js
const tasks = [] // 待执行的低优先级任务
let scheduled = false

// 不支持时降级到 setTimeout，每次只执行一个任务
const requestIdle = 'requestIdleCallback' in window
  ? (cb, options) => requestIdleCallback(cb, options)
  : (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 1)

function addTask(task) {
  tasks.push(task)
  if (!scheduled) {
    scheduled = true
    requestIdle(runTasks, { timeout: 2000 })
  }
}

function runTasks(deadline) {
  // 至少执行一个：因超时被强制调用时 timeRemaining() 为 0，也要保证任务有进展
  do {
    tasks.shift()()
  } while (tasks.length > 0 && deadline.timeRemaining() > 0)

  if (tasks.length > 0) {
    requestIdle(runTasks, { timeout: 2000 }) // 没做完，等下次空闲
  } else {
    scheduled = false
  }
}
```

### React 为什么不用 requestIdleCallback

React 的调度器需要稳定地切分时间片，而 rIC 的触发时机不稳定，兼容性也不好。React 用 `MessageChannel` 自己实现了时间切片：每执行一小段时间就让出主线程，再通过 `postMessage` 安排一个新的宏任务继续，中间浏览器可以处理渲染和用户输入。不用 `setTimeout(fn, 0)` 是因为定时器嵌套多层后会有 4ms 的最小延迟。

## 面试官可能追问

::: details 为什么用 setTimeout 做动画会卡顿？
`setTimeout(fn, 16)` 的节奏和屏幕刷新对不齐：有时一帧里执行了两次，前一次的改动根本没被画出来；有时一帧里一次都没执行，这一帧画面不变，看起来就是掉帧、抖动。而且定时器只是到时间后把回调放进任务队列，主线程忙时还会推迟。rAF 由浏览器在每次绘制前调用，天然和刷新同步，页面在后台时还会暂停，更省电。
:::

::: details 在 rAF 回调中读写 DOM 要注意什么？
rAF 在样式计算和布局之前执行，在这里修改 DOM，正好赶上这一帧的渲染。但如果先写后读，比如改了样式再读 `offsetHeight`，就会触发强制同步布局；在循环里读写交替就是布局抖动。应该先集中读取，再集中写入（见[回流和重绘](/basics/browser/02-reflow-repaint)）。
:::

::: details 有没有更新的调度 API？
有。`scheduler.postTask(fn, { priority })` 可以按优先级安排任务，优先级分为 `user-blocking`、`user-visible`、`background`；`await scheduler.yield()` 可以在长任务中途让出主线程，让浏览器先处理输入和渲染，再接着执行后面的代码。目前只有部分浏览器支持，使用前要做特性检测。
:::

## 易错点

- rAF 的回调只执行一次，做连续动画要在回调里再次调用
- rIC 不保证执行时机，重要的任务要传 `timeout`；回调里不要修改 DOM
- 页面切到后台时 rAF 会暂停，不能用它执行必须按时完成的逻辑
