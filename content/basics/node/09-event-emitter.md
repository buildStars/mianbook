---
difficulty: 2
tags: [高频, 手写题]
---

# EventEmitter 的原理是什么？手写发布订阅

::: tip 一句话回答
EventEmitter 内部保存一张"事件名 → 监听器数组"的表。`on` 往数组末尾追加监听器；`emit` 按注册顺序**同步**调用这个事件的所有监听器；`off` 从数组里移除一个；`once` 注册一个包装函数，第一次执行时先把自己移除，再调用原函数。还有两个特殊约定：触发 `error` 事件时如果没有监听器，错误会被直接抛出；同一个事件的监听器超过 `maxListeners`（默认 10 个）会打印警告，提示可能有内存泄漏。
:::

## 详细解析

### 基本语义

| 方法 | 作用 |
| --- | --- |
| `on(name, fn)` | 添加监听器；同一个函数添加两次，就会被调用两次 |
| `prependListener(name, fn)` | 添加到数组开头，最先执行 |
| `once(name, fn)` | 只执行一次，执行前自动移除 |
| `off(name, fn)` | 移除一个监听器；同一个函数添加过多次时，只移除最近添加的那一个 |
| `emit(name, ...args)` | 同步调用所有监听器，有监听器时返回 `true`，否则返回 `false` |
| `removeAllListeners(name)` | 移除这个事件的全部监听器，不传参数时移除所有事件的 |

还有几个细节：

- **同步执行**：`emit` 返回时，所有监听器都已经执行完了。某个监听器抛出异常，会直接从 `emit` 抛给调用方，后面的监听器不再执行
- **快照**：`emit` 开始时会复制一份监听器数组，执行过程中新增或移除监听器，不影响这一次 `emit`
- **this**：普通函数作为监听器时，`this` 指向 emitter 实例；箭头函数没有自己的 `this`

```js
import { EventEmitter } from 'node:events'

const emitter = new EventEmitter()
emitter.on('data', () => console.log('A'))
emitter.on('data', () => console.log('B'))
console.log('before')
emitter.emit('data')
console.log('after')
// 输出 before、A、B、after：emit 是同步的
```

### error 事件

`emit('error', err)` 时如果没有任何 `error` 监听器，EventEmitter 会把 `err` 直接抛出（传入的不是 Error 时，抛出一个 `ERR_UNHANDLED_ERROR` 错误）。流、socket、HTTP server 都继承自 EventEmitter，出错时触发的就是 `error` 事件，没有监听就会变成未捕获的异常，让进程退出。只想记录错误、不改变这个行为时，可以监听 `events.errorMonitor`：它在普通的 `error` 监听器之前执行，但没有普通监听器时照样会抛出。

### maxListeners 警告

同一个事件的监听器超过 10 个（`events.defaultMaxListeners`）时，Node.js 会打印一次 `MaxListenersExceededWarning`。它只是警告，监听器照样会被添加。这个设计是为了发现泄漏：正常代码很少给同一个事件挂这么多监听器，常见原因是每个请求都 `on` 一次却没有 `off`，例子见 [Node.js 服务内存泄漏怎么排查](/basics/node/08-memory-leak)。确实需要很多监听器时，再用 `emitter.setMaxListeners(n)` 调大。

## 代码示例：手写 EventEmitter

```js
class MyEmitter {
  #events = new Map() // 事件名 -> 监听器数组

  on(name, listener) {
    if (!this.#events.has(name)) this.#events.set(name, [])
    this.#events.get(name).push(listener)
    return this // 支持链式调用
  }

  once(name, listener) {
    const wrapper = (...args) => {
      this.off(name, wrapper) // 先移除再执行：监听器里再次 emit 也不会重复触发
      listener.apply(this, args)
    }
    wrapper.listener = listener // 记住原函数，off(name, listener) 时也能找到它
    return this.on(name, wrapper)
  }

  off(name, listener) {
    const list = this.#events.get(name)
    if (!list) return this
    // 从后往前找，和 Node.js 一样只移除最近添加的一个
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i] === listener || list[i].listener === listener) {
        list.splice(i, 1)
        break
      }
    }
    if (list.length === 0) this.#events.delete(name)
    return this
  }

  emit(name, ...args) {
    const list = this.#events.get(name)
    if (!list) {
      if (name === 'error') throw args[0] instanceof Error ? args[0] : new Error(`未处理的 error 事件：${args[0]}`)
      return false
    }
    // 先复制再遍历：once 的包装函数执行时会修改原数组，直接遍历会跳过下一个监听器
    for (const listener of [...list]) listener.apply(this, args)
    return true
  }
}
const bus = new MyEmitter()
const hello = (name) => console.log('hello', name)
bus.once('greet', hello)
bus.on('greet', (name) => console.log('hi', name))
bus.emit('greet', 'Tom')   // hello Tom、hi Tom
bus.emit('greet', 'Jerry') // hi Jerry：once 的监听器已经被移除
```

如果 `emit` 不复制数组：第一个监听器是 once 的包装函数，执行时把自己从数组中删掉，后面的元素整体前移一位，`for...of` 的下一次迭代就跳过了原来的第二个监听器。

## 面试官可能追问

::: details 监听器是 async 函数时，出错了会怎样？
EventEmitter 不会等待监听器返回的 Promise，也不处理它的拒绝。async 监听器里的错误会变成未处理的 Promise 拒绝，默认导致进程退出。可以在监听器内部 try/catch；也可以在创建 emitter 时传入 `{ captureRejections: true }`，把这类拒绝转交给 `error` 事件处理。
:::

::: details 怎么用 await 等待一个事件？
用 `events.once()`，它返回一个 Promise，事件第一次触发时 resolve 为参数数组；等待期间触发了 `error` 事件，Promise 会被拒绝。还可以传入 `signal` 设置超时：

```js
import { once } from 'node:events'

const [value] = await once(emitter, 'ready', { signal: AbortSignal.timeout(5000) })
```

需要持续处理同一个事件时，用 `events.on()` 得到一个异步迭代器，配合 `for await...of` 使用。
:::

::: details EventEmitter 和浏览器的 EventTarget 有什么区别？
EventTarget 的 `dispatchEvent` 只能传一个 Event 对象，DOM 中的事件还有捕获和冒泡阶段（见 [事件流和事件委托](/basics/browser/04-event-delegation)）；同一个函数以相同的 capture 设置重复 `addEventListener` 会被忽略；`error` 事件没有特殊处理。EventEmitter 可以传任意多个参数，允许重复添加同一个监听器，也没有传播过程。Node.js 也内置了 EventTarget，主要服务于 `AbortSignal` 这类 Web 标准 API。
:::

::: details EventEmitter 算观察者模式还是发布订阅模式？
emitter 自己保存监听器，触发时直接调用它们。用在流、socket 这类对象上时，更接近观察者模式：谁关心这个对象的事件，就直接订阅这个对象。把一个全局的 emitter 当作事件总线，让互不相关的模块通过它通信时，它扮演的就是发布订阅中的事件中心。两者的区别见 [观察者模式和发布订阅模式](/basics/design-pattern/02-observer-pubsub)。
:::

## 易错点

- `emit` 是同步的，监听器里的耗时操作会阻塞 `emit` 的调用方
- 用匿名函数添加的监听器没法通过 `off` 移除，要保存函数的引用
- `error` 事件没有监听器时会直接抛出，可能让整个进程退出
- `MaxListenersExceededWarning` 不是上限，看到它先排查是不是在重复添加监听，而不是直接调大限制
