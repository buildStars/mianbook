---
difficulty: 3
tags: [实践, 场景题]
---

# Node.js 服务内存泄漏怎么排查？

::: tip 一句话回答
服务端的泄漏危害比前端大：进程要连续运行几天甚至几周，每个请求漏一点，最终会撑满堆内存导致进程崩溃，或者 GC 越来越频繁、接口越来越慢。常见原因是**没有上限的内存缓存**、只增不减的全局数组和 Map、在长期存在的对象上反复添加**事件监听**、闭包或定时器持有大对象。排查分两步：先用 `process.memoryUsage()` 和监控确认 `heapUsed` 在 GC 后仍持续上涨；再用 `--inspect` 连接 Chrome DevTools（或用 `v8.writeHeapSnapshot()` 导出），在压测前后各拍一张**堆快照**对比，顺着引用链找到是谁持有这些对象。
:::

## 详细解析

### 服务端常见的泄漏

浏览器中的通用场景见 [常见的内存泄漏](/basics/javascript/16-memory-leak)，服务端最常见的是这几类：

| 场景 | 例子 | 解决 |
| --- | --- | --- |
| 没有上限的缓存 | 用模块级的 Map 按 URL、用户 ID 缓存结果，从不删除 | 设置条数上限和过期时间，如用 lru-cache；数据量大就放到 Redis |
| 只增不减的全局数据 | 把每个请求的信息 push 到全局数组里做统计 | 定期清理，或者只保留聚合后的统计值 |
| 重复添加的事件监听 | 每个请求都在全局的 EventEmitter 上 `on` 一次，请求结束时没有 `off` | 请求结束或连接关闭时移除监听 |
| 等待表里的残留 | 用 `Map<id, resolve>` 记录等待响应的请求，超时或出错的条目没有删除 | 超时、出错的分支里同样要删除 |
| 闭包、定时器持有大对象 | 回调里引用了整个 `req` 或大 Buffer；`setInterval` 从不清除 | 只保留需要的字段；不用时清除定时器 |

```js
// bus 是全局的 EventEmitter。每个 SSE 连接都在上面加一个监听，
// 断开后如果不移除，监听函数和它闭包里的 res 都无法回收
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  const onUpdate = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)
  bus.on('update', onUpdate)
  req.on('close', () => bus.off('update', onUpdate)) // 连接关闭时移除
})
```

同一个事件的监听器超过 10 个时，Node.js 会打印 `MaxListenersExceededWarning`，这往往就是重复添加监听的信号，见 [EventEmitter 的原理](/basics/node/09-event-emitter)。

### 第一步：确认是不是泄漏

| `process.memoryUsage()` 的字段 | 含义 |
| --- | --- |
| `rss` | 进程占用的物理内存总量，包括堆、代码、线程栈和堆外内存 |
| `heapTotal`、`heapUsed` | V8 堆的总大小和已使用的大小，JS 对象都在这里 |
| `external` | 绑定在 JS 对象上的 C++ 对象占用的内存 |
| `arrayBuffers` | ArrayBuffer 和 Buffer 占用的内存，包含在 `external` 里 |

```js
const toMB = (n) => (n / 1024 / 1024).toFixed(1)
setInterval(() => {
  const { rss, heapUsed, external } = process.memoryUsage()
  console.log(`rss=${toMB(rss)}MB heapUsed=${toMB(heapUsed)}MB external=${toMB(external)}MB`)
}, 60_000).unref()
```

生产环境一般接入监控看趋势，比如 Prometheus 的 prom-client 默认指标里就有这些数据。判断依据是 GC 后的低点：`heapUsed` 的曲线呈锯齿状，每次 GC 后回落到差不多的水平是正常的；如果每次回落的低点都比上次高，停止压测后也降不回去，就很可能有泄漏。`heapUsed` 平稳、`rss` 却持续上涨时，要看 `external` 和 `arrayBuffers`，问题可能出在 Buffer 或原生模块。

### 第二步：对比堆快照

1. 在测试环境用 `node --inspect server.mjs` 启动，Chrome 打开 `chrome://inspect`，点 Open dedicated DevTools for Node，进入 Memory 面板
2. 预热后拍第一张堆快照（Heap snapshot），拍摄前会先执行一次 GC
3. 用压测工具（如 autocannon）对可疑接口发几千个请求，拍第二张快照
4. 在第二张快照中切换到 Comparison 视图，按净增数量（# Delta）排序，找出数量随请求数一起增长的对象
5. 选中这类对象，在下方的 Retainers 面板看引用链，一路往上找到源头，比如某个模块里的 `cache` 变量、某个 EventEmitter 的监听器数组

不方便连接调试器时，可以在代码里调用 `v8.writeHeapSnapshot()` 生成 `.heapsnapshot` 文件；或者启动时加 `--heapsnapshot-signal=SIGUSR2`，之后执行 `kill -USR2 <pid>` 写出快照；加 `--heapsnapshot-near-heap-limit=2` 则会在堆快要用满时自动写出快照，保留崩溃前的现场。快照文件下载到本地，在 DevTools 的 Memory 面板加载分析。

生成快照是同步操作，会阻塞事件循环，堆越大耗时越长；还需要大约堆大小两倍的内存，可能直接触发 OOM。线上抓快照前，先把这个实例从负载均衡中摘掉。

### --max-old-space-size

它设置 V8 老生代内存的上限，单位是 MB。堆用满后进程会以 `JavaScript heap out of memory` 错误崩溃。调大它只能推迟崩溃，解决不了泄漏。在容器里还要给堆外内存留出空间：设置得比容器的内存限制还大，进程会先被系统的 OOM Killer 杀掉，而不是由 V8 报错退出，排查时连错误信息都没有。

## 面试官可能追问

::: details 内存一直在涨，就一定是泄漏吗？
不一定。V8 的垃圾回收是按需进行的，没到一定程度不会回收，`heapTotal` 也会随负载扩大；缓存在预热阶段增长也是正常的。另外，GC 释放的内存不一定马上还给操作系统，`rss` 降得比 `heapUsed` 慢。判断泄漏要看长时间的趋势和 GC 后的低点，最好在压测停止后观察能不能回落。
:::

::: details rss 很高，但 heapUsed 不高，可能是什么原因？
内存花在了 V8 堆外：Buffer 和 ArrayBuffer（看 `external`、`arrayBuffers`）、原生模块自己申请的内存（比如图片处理、压缩类的库）、线程栈，以及内存分配器产生的碎片。堆快照只记录 JS 堆，这部分内存在快照里看不到，要结合 `external` 的变化和原生模块的使用情况排查。
:::

::: details 用 WeakMap 或 WeakRef 做缓存，能避免泄漏吗？
WeakMap 只接受对象作为键，键对象被回收后对应的值也会释放，适合给请求、socket 这类对象关联数据；按字符串（URL、用户 ID）做键的缓存用不上它。WeakRef 持有的引用不阻止回收，但什么时候被回收由 GC 决定，缓存命中率不可控。服务端缓存更可靠的做法还是 LRU：明确的条数上限加过期时间。原理见 [Map 和 WeakMap](/basics/javascript/19-map-weakmap)。
:::

## 易错点

- 调大 `--max-old-space-size` 只是推迟崩溃，不能解决泄漏
- 只看 `rss` 判断 JS 对象泄漏不准确，要看 `heapUsed` 在 GC 后的低点
- 抓堆快照会阻塞进程、需要大量额外内存，线上要先摘掉流量
- `--inspect` 默认只监听 `127.0.0.1`，不要绑定 `0.0.0.0` 暴露到公网：能连上调试端口就能在进程里执行任意代码
