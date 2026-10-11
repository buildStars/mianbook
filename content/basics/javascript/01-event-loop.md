---
difficulty: 2
tags: [高频, 输出题]
---

# 说说浏览器的事件循环（Event Loop）

::: tip 一句话回答
JS 主线程同一时间只能做一件事。每一轮循环先执行一个**宏任务**（第一轮是整个 script），执行完后**清空所有微任务**（Promise.then、queueMicrotask、MutationObserver），然后浏览器视情况渲染页面，再取下一个宏任务，如此循环。
:::

## 详细解析

### 为什么需要事件循环

浏览器的主线程既要执行 JS，又要负责样式计算、布局和绘制。网络请求、定时器这类耗时操作交给浏览器的其他线程处理，完成后把**回调**放进队列，等主线程空闲时再取出来执行。负责"取任务、执行、再取任务"的机制就是事件循环。

### 一轮循环的顺序

1. 从任务队列中取出**一个**宏任务执行
2. 执行过程中产生的微任务进入微任务队列
3. 宏任务执行完毕后**清空**微任务队列，微任务里新产生的微任务也会在这一轮执行完
4. 浏览器判断是否需要渲染：执行 `requestAnimationFrame` 回调 → 样式计算 → 布局 → 绘制
5. 进入下一轮

| 类型 | 常见来源 |
| --- | --- |
| 宏任务（task） | script 整体代码、setTimeout / setInterval、用户交互事件、网络回调、MessageChannel |
| 微任务（microtask） | Promise.then / catch / finally、queueMicrotask、MutationObserver、`await` 之后的代码 |

> HTML 规范里只有 task 和 microtask，"宏任务"是国内面试的习惯叫法。

## 代码示例

```js
console.log('1')

setTimeout(() => console.log('2'), 0)

Promise.resolve()
  .then(() => console.log('3'))
  .then(() => console.log('4'))

async function foo() {
  console.log('5')
  await null
  console.log('6')
}
foo()

console.log('7')
```

输出顺序：`1 5 7 3 6 4 2`

- 同步代码依次输出 `1`、`5`、`7`。async 函数在第一个 `await` 之前是同步执行的
- 微任务队列按入队顺序执行：先 `3`，再 `6`；`3` 执行完后它后面的 `.then` 才入队，所以 `4` 排在 `6` 后面
- 最后执行下一轮的宏任务，输出 `2`

## 面试官可能追问

::: details setTimeout(fn, 0) 是 0 毫秒后执行吗？
不是。它只是把回调尽快放进任务队列，实际执行要等当前宏任务和所有微任务执行完。HTML 规范还规定，定时器嵌套超过 5 层后最小延迟为 4ms；页面在后台标签页时，浏览器会进一步节流定时器。
:::

::: details 微任务里不断产生新的微任务会怎样？
当前这一轮会一直执行微任务，宏任务和页面渲染都没有机会执行，页面会卡死。所以不能用递归的 `Promise.then` 做轮询。
:::

::: details requestAnimationFrame 属于宏任务还是微任务？
都不是。它在浏览器渲染前执行，频率跟随屏幕刷新率（60Hz 屏幕约 16.7ms 一次），适合做动画。页面在后台时会暂停执行。
:::

::: details Node.js 的事件循环和浏览器一样吗？
不完全一样。Node 的事件循环分为 timers、poll、check 等阶段，还有一个比 Promise 优先级更高的 `process.nextTick` 队列。Node 11 之后，每执行完一个 setTimeout 回调就会清空微任务，行为和浏览器基本一致。
:::

## 易错点

- async 函数在第一个 `await` 之前的代码是**同步**执行的
- `await` 后面的代码相当于放进了 `.then`，属于微任务
- 每轮只执行**一个**宏任务，但会清空**全部**微任务
