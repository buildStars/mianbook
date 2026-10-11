---
difficulty: 2
tags: [高频, 原理]
---

# Stream 是什么？背压怎么处理？

::: tip 一句话回答
Stream 把数据切成一小块一小块（chunk）依次处理，不用把全部数据装进内存，可以边读、边处理、边写。Node.js 有四种流：**可读流**、**可写流**、**双工流**和**转换流**。读得快、写得慢时，数据会堆积在内存里，这就是**背压**问题：`write()` 返回 `false` 表示缓冲区已经达到 `highWaterMark`，应该暂停写入，等 `drain` 事件后再继续。实际开发中用 `stream/promises` 的 `pipeline` 串联各个流，它自动处理背压，并且任何一环出错都会销毁所有流、把错误交给调用方。
:::

## 详细解析

### 四种流

| 类型 | 作用 | 例子 |
| --- | --- | --- |
| Readable 可读流 | 数据的来源 | `fs.createReadStream`、服务端收到的请求 `req`、`process.stdin` |
| Writable 可写流 | 数据的去处 | `fs.createWriteStream`、服务端的响应 `res`、`process.stdout` |
| Duplex 双工流 | 可读也可写，两端互相独立 | TCP 连接 `net.Socket` |
| Transform 转换流 | 写入的数据经过处理，再从可读端输出 | `zlib.createGzip()`、加解密流 |

所有流都是 EventEmitter；可读流还实现了异步迭代器，可以用 `for await...of` 逐块读取。

### 为什么要用流

`readFile` 会把整个文件读进内存，文件多大就占多少内存，几个请求同时下载大文件就可能耗尽内存，而且要等全部读完才能开始处理。用流的话，内存占用只取决于缓冲区大小，和文件大小无关，第一块数据到了就能开始处理和发送：

```js
// 整个文件读进内存再发送
const data = await readFile('big.zip')
res.end(data)

// 边读边发，内存里只保留缓冲区大小的数据
await pipeline(createReadStream('big.zip'), res)
```

### highWaterMark 和背压

每个流内部都有缓冲区，`highWaterMark` 是缓冲区的**阈值**：可读流的缓冲达到它就暂停从底层读取；可写流缓冲的数据达到它，`write()` 就返回 `false`，等缓冲区清空后触发 `drain` 事件。默认值可以用 `stream.getDefaultHighWaterMark()` 查看，和平台、版本有关，`fs.createReadStream` 默认是 64 KiB；对象模式下按对象个数计算，默认 16 个。

关键在于它是阈值，不是上限。`write()` 返回 `false` 后继续调用，数据照样会被接收，缓冲区会一直增长。从本地磁盘读、往网速很慢的客户端写，不理会返回值的话内存就会持续上涨。手动处理背压的写法：

```js
import { createReadStream, createWriteStream } from 'node:fs'
import { once } from 'node:events'

const reader = createReadStream('input.log')
const writer = createWriteStream('output.log')

for await (const chunk of reader) {
  if (!writer.write(chunk)) {
    // 缓冲区满了：先不读下一块，等写入方消化完再继续
    await once(writer, 'drain')
  }
}
writer.end()
```

循环在等待 `drain` 时不会取下一块，可读流的缓冲区满了也会停止读取，压力就这样一路传回数据源。

### pipe 和 pipeline

`readable.pipe(writable)` 会自动处理背压，但**不处理错误**：源流出错时，目标流不会被关闭，要给每个流单独监听 `error` 并手动销毁，否则文件描述符、连接等资源会泄漏。

`pipeline` 解决了这个问题：任何一个流出错或提前关闭，它都会销毁链上的所有流并把错误抛出来。`stream/promises` 中的版本返回 Promise，中间还可以放异步生成器函数作为转换步骤：

```js
import http from 'node:http'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'

// 压缩一个大日志文件
await pipeline(createReadStream('access.log'), createGzip(), createWriteStream('access.log.gz'))

// 用异步生成器做转换。指定编码后拿到的是字符串，多字节字符不会被切开
await pipeline(
  createReadStream('access.log', { encoding: 'utf8' }),
  async function* (source) {
    for await (const chunk of source) yield chunk.toUpperCase()
  },
  createWriteStream('access-upper.log'),
)

// 把文件发给客户端：客户端中途断开时，pipeline 以 ERR_STREAM_PREMATURE_CLOSE 结束，并关闭文件
http.createServer(async (req, res) => {
  try {
    await pipeline(createReadStream('big.zip'), res)
  } catch (err) {
    console.error('传输中断：', err.code)
  }
}).listen(3000)
```

转大写是逐字符的处理，和分块的位置无关。如果要按单词或按行处理，一个单词、一行内容可能被切在两块里，需要自己缓存跨块的部分，按行处理可以直接用 readline。

## 面试官可能追问

::: details 在 data 事件的回调里 await 异步操作，能控制读取速度吗？
不能。`readable.on('data', async (chunk) => { await db.insert(chunk) })` 中，事件不会等回调返回的 Promise，数据照样源源不断地进来，未完成的写库操作越积越多。要么在回调开头调用 `readable.pause()`，异步操作完成后再 `resume()`；更简单的是改用 `for await...of`，循环体 await 期间不会读取下一块。
:::

::: details 怎么逐行读取一个几 GB 的日志文件？
用 `node:readline` 包装可读流，它会处理跨块的换行，按行产出：

```js
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

const rl = createInterface({ input: createReadStream('app.log'), crlfDelay: Infinity })
let errors = 0
for await (const line of rl) {
  if (line.includes('ERROR')) errors++
}
console.log('错误行数：', errors)
```

`crlfDelay: Infinity` 让 `\r\n` 始终被当作一个换行。整个过程的内存占用很小，和文件大小无关。
:::

::: details 什么是对象模式（objectMode）？
默认情况下流传输的是 Buffer 或字符串，`highWaterMark` 按字节计算。开启 `objectMode` 后，每个 chunk 可以是任意 JS 值，`highWaterMark` 按对象个数计算。适合逐条处理数据，比如从数据库游标逐行读出记录，经过转换流加工后，再写入另一个系统。
:::

::: details Node.js 的流和浏览器的 Web Streams 是什么关系？
Web Streams（`ReadableStream`、`WritableStream`、`TransformStream`）是 Web 标准 API，Node.js 也在全局提供了它们，`fetch` 返回的 `res.body` 就是一个 `ReadableStream`。两套 API 可以互通：`Readable.fromWeb()`、`Readable.toWeb()` 互相转换，`pipeline` 也能直接接收 Web Streams，比如 `await pipeline(res.body, createWriteStream('file.zip'))` 把下载的内容直接写进文件。
:::

## 易错点

- `highWaterMark` 是阈值不是上限：忽略 `write()` 的返回值继续写，缓冲区会无限增长
- `pipe` 在出错时不会销毁其他流，生产代码用 `pipeline`
- 按块处理文本时，多字节字符、单词和行都可能被切开。读取时指定编码能保证字符完整，原理见 [Buffer 和字符编码](/basics/node/04-buffer)
