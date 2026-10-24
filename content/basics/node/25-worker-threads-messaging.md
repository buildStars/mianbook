---
difficulty: 3
tags: [原理, 性能优化]
---

# worker_threads 之间怎么通信？postMessage、transferList 和 SharedArrayBuffer 有什么区别？

::: tip 一句话回答
每个 worker 有独立的 V8 实例和堆，线程之间不能直接共享普通对象。`postMessage` 默认用**结构化克隆**复制一份数据过去，大对象复制成本高；把 `ArrayBuffer`、`MessagePort` 放进 **transferList** 是**转移所有权**，零拷贝，但原线程那份立刻变成不可用（`byteLength` 变成 0）；**SharedArrayBuffer** 是多个线程真正共享同一块内存，并发读写要用 **Atomics** 保证原子性。
:::

## 详细解析

### 三种传数据的方式

| 方式 | 数据怎么过去 | 发送后原线程 | 适合 |
| --- | --- | --- | --- |
| `postMessage(value)` | 结构化克隆，复制一份 | 不受影响 | 小消息、普通对象 |
| `postMessage(value, [ab])` | 转移底层内存，不复制 | 被转移的 `ArrayBuffer` 长度变 0 | 大块二进制数据单向交给对方 |
| `SharedArrayBuffer` | 两边指向同一块内存 | 照常读写 | 高频共享计数、状态、环形缓冲区 |

结构化克隆能处理 Map、Set、Date、循环引用、TypedArray，但函数、类实例的原型、带方法的对象传不过去（类实例会变成普通对象）。克隆是同步发生在发送方的，几十 MB 的对象每次克隆都要消耗 CPU 和内存，这时候就该考虑转移或共享。

### transferList：转移所有权

转移后发送方的 `ArrayBuffer` 被"分离"（detached），所有基于它的 TypedArray 视图都不能再用。几个细节：

- `Buffer.from()`、`Buffer.allocUnsafe()` 得到的小 Buffer 来自内部的共享池，不能转移，总是被克隆；要转移就用 `Buffer.alloc()` 或者直接 `new ArrayBuffer()`
- `markAsUntransferable(obj)` 可以标记某个对象不许转移，之后把它放进 transferList 会抛 `DataCloneError`。Node 自己就给 Buffer 池做了这个标记
- `MessagePort` 只能通过转移传递，放在 `workerData` 或消息里却没放进 transferList 会报错

### SharedArrayBuffer 和 Atomics

共享内存意味着会有数据竞争。`counter[0]++` 实际是"读、加一、写回"三步，两个线程交错执行就会丢失更新。`Atomics.add`、`Atomics.compareExchange` 等操作是原子的；`Atomics.wait` / `Atomics.notify` 可以让一个线程睡眠等待某个位置的值变化，再由另一个线程唤醒，用来实现锁或生产者消费者队列。主线程里不要调 `Atomics.wait`，它会阻塞事件循环。

### 通道：parentPort、MessageChannel、BroadcastChannel

- **parentPort / worker.postMessage**：父子之间的默认通道
- **MessageChannel**：`new MessageChannel()` 得到相连的 `port1` 和 `port2`，把其中一个 port 转移给某个 worker，就能让任意两个线程直接通信，不用主线程转发
- **BroadcastChannel**：同名频道的所有实例一对多广播，适合"配置更新了，所有 worker 重新加载"这类通知
- **workerData**：创建 worker 时传的初始数据，同样是克隆过去的

## 代码示例

```js
// demo.mjs：同一个文件既是主线程也是 worker
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'

if (isMainThread) {
  // 1. transferList：转移所有权
  const buf = new ArrayBuffer(1024 * 1024)
  const w = new Worker(new URL(import.meta.url), { workerData: { mode: 'echo' } })
  w.postMessage(buf, [buf])
  console.log('转移后主线程 byteLength:', buf.byteLength)
  const len = await new Promise((r) => w.once('message', r))
  console.log('worker 收到 byteLength:', len)
  await w.terminate()

  // 2. SharedArrayBuffer + Atomics：4 个 worker 各加 10 万次
  const sab = new SharedArrayBuffer(4)
  const counter = new Int32Array(sab)
  const workers = Array.from({ length: 4 }, () =>
    new Worker(new URL(import.meta.url), { workerData: { mode: 'count', sab } }))
  await Promise.all(workers.map((w) => new Promise((r) => w.once('exit', r))))
  console.log('计数结果:', Atomics.load(counter, 0))
} else if (workerData.mode === 'echo') {
  parentPort.once('message', (ab) => parentPort.postMessage(ab.byteLength))
} else {
  const counter = new Int32Array(workerData.sab) // sab 不会被复制，两边是同一块内存
  for (let i = 0; i < 100_000; i++) Atomics.add(counter, 0, 1) // ✅ 原子加
}
```

```text
转移后主线程 byteLength: 0
worker 收到 byteLength: 1048576
计数结果: 400000
```

把 `Atomics.add(counter, 0, 1)` 换成 `counter[0]++`，每次运行的结果都小于 400000，而且每次不一样。

### 线程池和适用场景

创建 worker 要启动新的 V8 实例、加载模块，有明显开销。生产里一般建固定大小的线程池（大小接近 CPU 核数），任务进队列，空闲 worker 取任务执行，常用的库例如 Piscina。还可以用 `resourceLimits`（`maxOldGenerationSizeMb` 等）限制单个 worker 的堆大小，超限时该 worker 被终止，不会拖垮整个进程。

worker 只对 **CPU 密集**的任务有用，例如图片处理、压缩、大 JSON 解析、加密计算。数据库查询、HTTP 请求这类 I/O 本来就是异步的，放进 worker 只会多出通信和克隆开销。多进程和多线程怎么选见 [Node.js 怎么利用多核](/basics/node/06-multi-core)。

## 面试官可能追问

::: details 转移和共享都能避免复制，怎么选？
转移是"交接"：数据从一个线程交给另一个线程，同一时刻只有一个线程拥有它，不需要加锁，适合流水线式的一次性交接。共享是两边同时访问，适合高频读写的小状态，代价是要自己处理并发，用 Atomics 或在其上实现的锁。能用转移解决的就别用共享。
:::

::: details 怎么让两个兄弟 worker 直接通信？
主线程创建一个 `MessageChannel`，把 `port1` 转移给 worker A、`port2` 转移给 worker B，即 `a.postMessage({ port: port1 }, [port1])`。之后 A 和 B 在各自的 port 上 `postMessage` 和监听 `message`，消息不再经过主线程。
:::

::: details worker 里抛了未捕获的异常会怎样？
主线程上的 `worker` 对象触发 `'error'` 事件，随后这个 worker 被终止并触发 `'exit'`。线程池要监听这两个事件，把正在执行的任务标记失败，并补一个新 worker。
:::

## 易错点

- 以为 `postMessage` 传的是引用。普通对象是克隆的，worker 里改了不会影响主线程
- 转移之后还继续用原来的 `ArrayBuffer` 或它的 TypedArray 视图，读到的是长度为 0 的空数据
- 用 SharedArrayBuffer 却直接 `arr[i]++`，在多线程下会丢失更新，必须用 Atomics
- 每个请求新建一个 worker，创建开销可能比任务本身还大，应该用线程池复用
