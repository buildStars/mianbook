---
difficulty: 2
tags: [原理]
---

# Buffer 是什么？和字符编码有什么关系？

::: tip 一句话回答
Buffer 是 Node.js 用来表示**一段固定长度的原始字节**的对象，是 `Uint8Array` 的子类，文件、网络、加密这些处理二进制数据的地方都会用到它。字符串和 Buffer 互相转换时要指定**字符编码**：`Buffer.from(str, 'utf8')` 把字符串编码成字节，`buf.toString('base64')` 把字节按指定编码转成字符串。UTF-8 中一个汉字通常占 3 个字节，把 Buffer 从字符中间切开、再分别转成字符串就会出现乱码，流式处理文本时用 `StringDecoder` 或流的 `setEncoding` 解决。
:::

## 详细解析

### Buffer 和 Uint8Array

- 每个元素是 0～255 的整数，`length` 是字节数，创建后长度不能改变
- 继承自 `Uint8Array`，能用在任何接收 `Uint8Array` 的地方；额外提供了按编码转字符串、`readUInt32BE` 这类按格式读写数字的方法
- 数据存放在 V8 堆外，`process.memoryUsage()` 里的 `arrayBuffers` 统计的就是这部分内存
- 字符串的 `length` 是 UTF-16 码元的个数，不是字节数：`'中文'.length` 是 2，`Buffer.byteLength('中文')` 是 6

### 创建方式

| 方法 | 说明 |
| --- | --- |
| `Buffer.from(string, encoding)` | 按编码把字符串转成字节，默认 utf8 |
| `Buffer.from(array)`、`Buffer.from(buffer)` | 复制一份数据 |
| `Buffer.from(arrayBuffer)` | 和这个 ArrayBuffer **共享内存**，不复制 |
| `Buffer.alloc(size, fill)` | 分配内存并清零（或填充指定的值），安全 |
| `Buffer.allocUnsafe(size)` | 分配但不初始化，更快；内容可能是这块内存上残留的旧数据，较小的 Buffer 还会从预先分配的内存池里切出来 |
| `new Buffer()` | 已废弃，行为随参数类型变化，容易误用 |

`allocUnsafe` 适合马上会被完整写满的场景，比如分配好之后立刻把读到的数据填进去。如果没写满就发送出去，残留的旧数据（可能是别的请求的内容、密钥）会一起泄露。

### 编码转换

Buffer 支持的编码有 `utf8`、`utf16le`、`latin1`、`ascii`、`base64`、`base64url`、`hex` 等，不支持 GBK 这类中文编码。

```js
const buf = Buffer.from('你好', 'utf8')
console.log(buf)                    // <Buffer e4 bd a0 e5 a5 bd>：每个汉字 3 个字节
console.log(buf.toString('hex'))    // e4bda0e5a5bd
console.log(buf.toString('base64')) // 5L2g5aW9
console.log(Buffer.from('5L2g5aW9', 'base64').toString()) // 你好
```

要分清两类编码：`utf8`、`utf16le` 是字符编码，决定一个字符对应哪几个字节；`hex`、`base64` 是把任意字节表示成可打印文本的方式，常用来在 JSON、URL、HTTP 头里传输二进制数据。

### 为什么会出现乱码

UTF-8 是变长编码：ASCII 字符占 1 个字节，常用汉字占 3 个字节，多数 emoji 占 4 个字节。从文件或网络读数据时，每一块的边界按字节数划分，完全可能落在一个汉字的中间：

```js
import { StringDecoder } from 'node:string_decoder'

const buf = Buffer.from('你好')
const part1 = buf.subarray(0, 4) // "你"的 3 个字节 + "好"的第 1 个字节
const part2 = buf.subarray(4)    // "好"的后 2 个字节

// 错误：每块单独解码，不完整的字节被替换成 U+FFFD
console.log(part1.toString() + part2.toString()) // 你���

// 正确：StringDecoder 把末尾不完整的字节先存起来，和下一块拼成完整的字符
const decoder = new StringDecoder('utf8')
let text = decoder.write(part1) // "你"
text += decoder.write(part2)    // "好"
text += decoder.end()
console.log(text) // 你好
```

几种解决方法：

1. 数据量不大时，先收集所有块，拼接后再统一解码：`Buffer.concat(chunks).toString('utf8')`
2. 用 `StringDecoder` 逐块解码，如上
3. 流式读取时调用 `readable.setEncoding('utf8')`，或在创建流时传入 `encoding`，内部用的就是 StringDecoder，见 [Stream 和背压](/basics/node/03-stream)
4. Web 标准的 `TextDecoder` 加上 `{ stream: true }` 选项，效果相同

常见的错误写法是 `req.on('data', (chunk) => { body += chunk })`：`+=` 会把每个 chunk 单独转成字符串，汉字恰好跨块时就会乱码。正确写法：

```js
const chunks = []
for await (const chunk of req) chunks.push(chunk)
const body = Buffer.concat(chunks).toString('utf8')
```

## 面试官可能追问

::: details Buffer、ArrayBuffer、Uint8Array 是什么关系？
ArrayBuffer 是一块原始内存，本身不能直接读写；Uint8Array 等类型化数组是访问这块内存的视图；Buffer 是 Node.js 在 Uint8Array 基础上扩展的子类。`buf.buffer` 能拿到底层的 ArrayBuffer，但用 `Buffer.from`、`Buffer.allocUnsafe` 创建的较小 Buffer 往往是从共享的内存池里切出来的，这时 `buf.buffer` 是整个内存池，要配合 `buf.byteOffset` 和 `buf.byteLength` 才能取到正确的范围。
:::

::: details 读取 GBK 编码的文件为什么乱码？怎么处理？
`readFile` 指定 `'utf8'` 时按 UTF-8 解码，而 Buffer 本身不支持 GBK。可以先读成 Buffer，再用 `new TextDecoder('gbk').decode(buf)` 解码（Node.js 官方发布的版本内置了完整的 ICU 数据，支持 GBK、GB18030 等编码），也可以用 iconv-lite 这类库。流式读取时用 `TextDecoder` 的 `stream: true` 选项，或者 iconv-lite 提供的解码流。
:::

::: details base64 和 base64url 有什么区别？
base64 用 `A-Z`、`a-z`、`0-9`、`+`、`/` 这 64 个字符，结尾用 `=` 补齐长度；`+`、`/`、`=` 在 URL 里都有特殊含义。base64url 把 `+`、`/` 换成 `-`、`_`，并省略结尾的 `=`，可以直接放进 URL 和文件名，JWT 的三段用的就是它。两者都是每 3 个字节编码成 4 个字符，体积增加约三分之一。
:::

::: details 怎么用 Buffer 解析二进制协议？
用 `readUInt32BE`、`readInt16LE`、`writeUInt32BE` 这类方法按指定的字节序读写数字，用 `subarray` 截取消息体。TCP 是字节流，还要自己处理消息边界，比如"4 字节长度 + 消息体"的格式，示例见 [TCP 和 UDP 的区别](/basics/network/04-tcp-vs-udp)。
:::

## 易错点

- `buf.subarray()` 和 `buf.slice()` 返回的都是共享同一块内存的视图，改一个另一个也会变；`Uint8Array.prototype.slice` 才会复制。Buffer 的 `slice` 已经废弃，需要复制时用 `Buffer.from(buf)`
- 拼接流数据时写 `body += chunk`，汉字跨块就会乱码
- `Buffer.allocUnsafe` 的内容可能是旧数据，没写满就发送会泄露内存里的敏感信息
- 设置 `Content-Length` 这类按字节计算的值时用 `Buffer.byteLength(str)`，不能用 `str.length`
