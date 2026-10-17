---
difficulty: 2
tags: [手写题, 输出题]
---

# 手写 LazyMan：链式调用和任务队列怎么实现？

::: tip 一句话回答
LazyMan 的核心是**任务队列**：`eat`、`sleep` 这些方法不立刻执行，只把任务放进队列并 `return this` 支持链式调用；构造时用 **`setTimeout(fn, 0)` 延迟启动**，等同步的链式调用全部登记完再开始跑。每个任务做完自己的事后调用 **`next()`** 取下一个，sleep 任务就是在定时器回调里再调 next。`sleepFirst` 用 `unshift` **插到队首**，所以会排在打招呼之前。
:::

## 详细解析

### 题目要求

```text
LazyMan('Tony')
// Hi, I am Tony

LazyMan('Tony').sleep(10).eat('lunch')
// Hi, I am Tony
// (等待 10 秒)
// Wake up after 10s
// Eat lunch

LazyMan('Tony').eat('lunch').sleepFirst(5).eat('dinner')
// (等待 5 秒)
// Wake up after 5s
// Hi, I am Tony
// Eat lunch
// Eat dinner
```

难点有两个：sleep 要阻塞后面的任务，但不能阻塞线程；sleepFirst 写在链的后面，却要最先执行。

### 为什么要延迟启动

如果构造函数里立即执行队列，打招呼时后面的 `.eat()` 还没调用，sleepFirst 也来不及插队。用 `setTimeout(0)` 把启动推迟到当前同步代码之后，此时整条链已经登记完毕，队列是完整的。用 `Promise.resolve().then(...)` 推到微任务也可以，只要晚于同步代码就行。

### next 驱动执行

队列里每一项都是一个函数，执行完自己的逻辑再调用 `this.next()`。同步任务（打招呼、吃饭）做完马上调 next；sleep 任务在 setTimeout 回调里调 next，于是后面的任务自然被"暂停"了。这和 Express、Koa 中间件里的 next 是同一种思路。

### 和并发调度器的区别

[并发上限调度器](/basics/handwriting/04-concurrency-limit) 同时跑多个任务，关心的是"同时最多几个"；LazyMan 是严格串行，一次只跑一个，关心的是链式 API 和插队。

## 代码示例：手写 LazyMan

```js
class LazyManImpl {
  constructor(name) {
    this.tasks = []
    this.tasks.push(() => { console.log(`Hi, I am ${name}`); this.next() })
    // 等同步的链式调用全部登记完，再开始执行
    setTimeout(() => this.next(), 0)
  }
  next() {
    const task = this.tasks.shift()
    if (task) task()
  }
  sleepTask(seconds) {
    return () => setTimeout(() => {
      console.log(`Wake up after ${seconds}s`)
      this.next()
    }, seconds * 1000)
  }
  eat(food) {
    this.tasks.push(() => { console.log(`Eat ${food}`); this.next() })
    return this
  }
  sleep(seconds) {
    this.tasks.push(this.sleepTask(seconds))
    return this
  }
  sleepFirst(seconds) {
    this.tasks.unshift(this.sleepTask(seconds)) // 插到队首，排在打招呼之前
    return this
  }
}
const LazyMan = (name) => new LazyManImpl(name)

LazyMan('Tony').eat('lunch').sleepFirst(1).sleep(1).eat('dinner')
// 1 秒后：Wake up after 1s / Hi, I am Tony / Eat lunch
// 再过 1 秒：Wake up after 1s / Eat dinner
```

### async 写法

任务都返回 Promise（同步任务返回 undefined 也行），用一个 while 循环逐个 await，就不需要每个任务自己调 next：

```js
class LazyManAsync {
  constructor(name) {
    this.tasks = [() => console.log(`Hi, I am ${name}`)]
    setTimeout(() => this.run(), 0)
  }
  async run() {
    while (this.tasks.length) await this.tasks.shift()()
  }
  wait(s) { return () => new Promise((r) => setTimeout(() => { console.log(`Wake up after ${s}s`); r() }, s * 1000)) }
  eat(food) { this.tasks.push(() => console.log(`Eat ${food}`)); return this }
  sleep(s) { this.tasks.push(this.wait(s)); return this }
  sleepFirst(s) { this.tasks.unshift(this.wait(s)); return this }
}
```

同样的调用，输出和时间点与上面一致。

## 面试官可能追问

::: details 连续调用两次 sleepFirst，顺序是什么？
后调用的会排在更前面，因为每次都 unshift 到队首。如果要求多个 sleepFirst 按调用顺序执行，可以单独维护一个 firstTasks 数组，启动时拼成 `[...firstTasks, ...tasks]`。
:::

::: details 启动之后再调用 eat 还有效吗？
有效，前提是队列还没跑空。上面的实现里，队列跑空后 next 什么都不做，之后再 push 的任务不会自动启动。要支持这种情况，可以记一个 running 标志，入队时发现没在运行就重新触发 next。
:::

::: details 能不能用 Promise 链实现，而不是数组？
可以。实例上存一个 `this.chain = Promise.resolve()`，每个方法都 `this.chain = this.chain.then(task)`。但 sleepFirst 要插到前面，Promise 链做不到插队，所以这道题用数组队列更自然。
:::

## 易错点

- 构造函数里直接执行第一个任务，sleepFirst 来不及插队
- sleep 用 while 循环忙等，会卡死整个线程，所有定时器都不会触发
- 方法忘了 `return this`，链式调用第二步就报错
- 同步任务忘了调用 next，队列在第一个任务后就停住
