---
difficulty: 2
tags: [实践]
---

# Web Worker 有什么用？有哪些限制？

::: tip 一句话回答
Web Worker 让 JS 运行在**独立的线程**里，耗时的计算放进去，不会阻塞主线程上的渲染和交互，适合大数据计算、加解密、图片处理、大文件算 hash 等 **CPU 密集型任务**。主线程和 Worker 之间用 `postMessage` 通信，数据默认经过**结构化克隆**复制一份，`ArrayBuffer` 等可转移对象可以零拷贝转移。Worker 里不能访问 DOM、`window`、`document`，也不能用 `localStorage`。
:::

## 详细解析

### 适合做什么

- 大量数据的计算、排序、筛选、聚合
- 加解密、压缩和解压
- 图片、音视频处理；配合 `OffscreenCanvas` 还能在 Worker 里绘图
- 大文件分片计算 hash，用于秒传和断点续传（见[大文件上传](/basics/network/18-large-file-upload)）
- 复杂的解析工作，如 Markdown 渲染、代码高亮、Excel 解析

网络请求本身就是异步的，不会阻塞主线程，单纯为了发请求而用 Worker 没有收益。

### 通信和数据传递

- 一方调用 `postMessage(data)`，另一方监听 `message` 事件，从 `event.data` 取数据
- 数据经过**结构化克隆**：支持普通对象、数组、`Map`、`Set`、`Date`、`ArrayBuffer`、`Blob` 等，也能处理循环引用；对象的原型不会保留，class 实例传过去会变成普通对象
- 数据很大时复制有明显开销。`ArrayBuffer`、`MessagePort`、`ImageBitmap`、`OffscreenCanvas` 等**可转移对象（Transferable）**可以放进第二个参数转移所有权，不复制数据；转移后原来的一方就不能再使用了

### 限制

- 不能访问 DOM、`window`、`document`，Worker 里的全局对象是 `self`
- 不能使用 `localStorage`、`sessionStorage`，也不能调用 `alert` 这类界面相关的 API
- 可以使用 `fetch`、`XMLHttpRequest`、`WebSocket`、`IndexedDB`、定时器等
- Worker 脚本必须和页面同源
- 和主线程不共享变量，只能通过消息通信（`SharedArrayBuffer` 除外）

### 创建成本

每个 Worker 都是一个独立的线程，有自己的 JS 运行环境，创建要花时间、占内存。频繁的任务应该复用同一个 Worker，或者按 `navigator.hardwareConcurrency`（CPU 逻辑核数）建一个 **Worker 池**，任务排队分配给空闲的 Worker。不再需要时，主线程调用 `worker.terminate()`，或者 Worker 内部调用 `self.close()` 释放。

### Worker 的种类

| 种类 | 特点 |
| --- | --- |
| 专用 Worker（`Worker`） | 只属于创建它的页面，最常用 |
| 共享 Worker（`SharedWorker`） | 同源的多个页面共用一个实例，通过 `port` 通信，可以用来做[跨标签页通信](/basics/browser/17-cross-tab) |
| Service Worker | 页面和网络之间的代理，用于拦截请求、离线缓存，见 [Service Worker](/basics/browser/16-service-worker) |

### 工程化

- Vite 中这样创建：`new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`，构建时会单独打包 Worker 文件；webpack 5 也支持这种写法
- `canvas.transferControlToOffscreen()` 可以把画布的控制权转给 Worker，在 Worker 里用 `OffscreenCanvas` 绘图
- Comlink 库用 `Proxy` 把 `postMessage` 包装成函数调用，主线程可以像调用异步函数一样调用 Worker 里的方法

## 代码示例

主线程把 500 万个数字交给 Worker 排序，排序期间页面照常响应：

```js
// main.js：主线程
const worker = new Worker(new URL('./sort.worker.js', import.meta.url), { type: 'module' })

worker.addEventListener('message', (e) => {
  const sorted = new Float64Array(e.data)
  console.log('最小值', sorted[0], '最大值', sorted[sorted.length - 1])
  worker.terminate() // 用完释放线程
})

worker.addEventListener('error', (e) => {
  console.error('Worker 出错：', e.message)
})

const data = new Float64Array(5_000_000).map(() => Math.random())
// 第二个参数是转移列表：ArrayBuffer 的所有权交给 Worker，不复制数据
worker.postMessage(data.buffer, [data.buffer])
console.log(data.length) // 0，已经转移，主线程不能再使用
```

```js
// sort.worker.js：Worker 线程，全局对象是 self
self.addEventListener('message', (e) => {
  const data = new Float64Array(e.data)
  data.sort() // TypedArray 默认按数值排序，耗时操作放在这里不会卡住页面
  self.postMessage(data.buffer, [data.buffer]) // 排好后再转移回主线程
})
```

## 面试官可能追问

::: details Worker 中的错误怎么捕获？
- Worker 里没有被捕获的异常，会在主线程的 worker 对象上触发 `error` 事件，能拿到错误信息、文件名和行号
- 收到的消息无法反序列化时，接收方会触发 `messageerror` 事件
- 实践中常在 Worker 里用 try/catch 包住任务，把错误作为一条普通消息发回主线程，方便和具体的任务对应起来
:::

::: details postMessage 能传函数吗？
不能。结构化克隆不支持函数，也不支持 DOM 节点，会抛出 `DataCloneError`。需要"远程调用"时，可以传方法名和参数，Worker 里按方法名分发；Comlink 就是把这个过程封装好了。
:::

::: details SharedArrayBuffer 有什么使用条件？
SharedArrayBuffer 让主线程和 Worker 共享同一块内存，不用复制也不用转移，配合 `Atomics` 做同步。出于对 Spectre 这类侧信道攻击的防范，浏览器要求页面处于**跨源隔离**状态才能使用：响应头设置 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: require-corp`（或 `credentialless`）。可以用 `self.crossOriginIsolated` 检查当前页面是否满足条件。
:::

## 易错点

- Worker 不是越多越好：创建有成本，数量超过 CPU 核数也不会更快
- 传大数据时默认是复制，要用 Transferable 转移；转移后原来的一方不能再访问
- Worker 只解决 CPU 密集型任务的卡顿，对网络请求这类异步 I/O 没有帮助
