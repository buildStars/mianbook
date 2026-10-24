---
difficulty: 2
tags: [手写题, 实践]
---

# 手写：用 Node.js 流逐行处理一个几 GB 的日志文件，统计每个状态码出现的次数

::: tip 一句话回答
不能用 `readFile`，它会把整个文件读进内存，几 GB 的文件直接超出堆上限。正确做法是用 `createReadStream` 按块读，再按换行切成行：最省事的是 **readline.createInterface + for await**；也可以自己写一个 **Transform 流**，关键是把每块末尾**没遇到换行的半行留到下一块**拼接，`flush` 里输出最后一行。用 `stream/promises` 的 **pipeline** 串起来，背压和出错时销毁所有流都由它处理，内存占用保持平稳。
:::

## 详细解析

### 为什么不能 readFile

`readFile` 要先把整个文件读成一个 Buffer，转成字符串还要再占一份。Buffer 和字符串都有长度上限，文件够大时会直接报错；即使没超限，几 GB 的内存占用也会让进程被系统杀掉。流每次只读 `highWaterMark` 大小的一块（文件流默认 64 KB），处理完再读下一块，内存和文件大小无关。

### 难点：块边界

文件流按字节数切块，不管行在哪里结束。一行很可能被切成两半：上一块的结尾是 `"GET /a HTTP/1.1" 2`，下一块开头是 `00 512\n`。所以：

1. 每块和上次剩下的半行拼接后再按 `\n` 切分
2. 切出来的最后一段不一定完整，留到下一块
3. 文件读完时（`flush`），剩下的那段就是最后一行，文件结尾没有换行符时它不为空
4. Windows 换行是 `\r\n`，切完要去掉行尾的 `\r`

多字节字符也可能被切开。给 `createReadStream` 传 `encoding: 'utf8'`，内部会用 StringDecoder 把不完整的字节留到下一块，不会出现乱码。

## 代码示例：两种写法

### 写法一：readline

```js
// count-readline.mjs
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

const re = /" (\d{3}) / // 请求行后面的状态码

export async function countByReadline(file) {
  const rl = createInterface({
    input: createReadStream(file),
    crlfDelay: Infinity, // \r 后面跟 \n 时一律当成一个换行
  })
  const counts = new Map()
  for await (const line of rl) {
    const m = re.exec(line)
    if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
  }
  return counts
}

console.log(await countByReadline(process.argv[2]))
```

### 写法二：自己写 Transform 切行

```js
// count-transform.mjs
import { createReadStream } from 'node:fs'
import { Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

function splitLines() {
  let rest = '' // 上一块末尾不完整的半行
  return new Transform({
    decodeStrings: false, // 保持上游解码好的字符串，不要转回 Buffer
    readableObjectMode: true, // 输出端每次推出一行字符串
    transform(chunk, encoding, callback) {
      const parts = (rest + chunk).split('\n')
      rest = parts.pop() // 最后一段可能被截断，留到下一块
      for (const line of parts) this.push(line.replace(/\r$/, ''))
      callback()
    },
    flush(callback) {
      if (rest) this.push(rest.replace(/\r$/, '')) // 文件末尾没有换行符的最后一行
      callback()
    },
  })
}

const counts = new Map()
const re = /" (\d{3}) /
await pipeline(
  createReadStream(process.argv[2], { encoding: 'utf8' }),
  splitLines(),
  new Writable({
    objectMode: true,
    write(line, encoding, callback) {
      const m = re.exec(line)
      if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
      callback()
    },
  }),
)
console.log(counts)
```

用一个 1000 行、最后一行没有换行符的测试日志验证，并把两种写法的 `highWaterMark` 都临时改成 64 字节，让几乎每一行都被块边界切断。生成文件时算出的期望值是 200 出现 501 次、404 出现 167 次、500 和 301 各 166 次，两种写法输出一致：

```text
Map(4) { '200' => 501, '404' => 167, '500' => 166, '301' => 166 }
```

如果去掉 `rest` 直接对每块 `split('\n')`，被切断的行会变成两条残缺的行，正则匹配不上，统计结果就会偏少。

### 性能

- 统计逻辑要轻：每行只做一次正则匹配，正则提到循环外面定义；能用 `indexOf` 定位就不必用复杂正则
- `highWaterMark` 调大（例如 1 MB）可以减少读取次数，对纯顺序读通常有帮助，具体收益要实测
- 两种写法里 readline 写起来最短，自己写 Transform 的好处是可以插进任意 pipeline，比如前面接 `zlib.createGunzip()` 直接处理 `.gz` 日志

## 面试官可能追问

::: details 这里的背压体现在哪？
`pipeline` 会自动处理：下游 Writable 处理慢、内部缓冲满了，上游 Transform 的 `push` 就会积压，文件流随之暂停读取。`for await` 读 readline 也一样，循环体里 `await` 一个慢操作时，不会继续往内存里塞数据。概念细节见 [Stream 是什么？背压怎么处理？](/basics/node/03-stream)。
:::

::: details 为什么用 pipeline 而不是 pipe？
`pipe` 不转发错误：中间某个流出错，其他流不会被销毁，文件描述符可能泄漏，还要给每个流单独监听 `error`。`pipeline` 任何一个流出错都会销毁全部流，返回的 Promise 被 reject，一个 `try/catch` 就能兜住。
:::

::: details 文件有几十 GB、要求更快怎么办？
单线程顺序读的瓶颈通常是 CPU 上的解析。可以按字节偏移把文件分成几段，交给多个 worker 各自用 `createReadStream({ start, end })` 读取，每段开头跳过第一个不完整的行、结尾多读到下一个换行为止，最后汇总各段的计数。
:::

## 易错点

- 直接对每个块 `split('\n')`，块边界上被截断的行会被当成两行
- 忘了写 `flush`，文件结尾没有换行符时最后一行丢失
- 读流不设 `encoding` 却对每块自己 `chunk.toString()`，中文等多字节字符在块边界上会被切开变成乱码。Transform 不设 `decodeStrings: false` 倒不会乱码：上游解码好的完整字符串被重新编码成 Buffer，`rest + chunk` 时又整块转回字符串，只是多了一次无谓的编解码
- 用 `on('data')` 加异步处理，不会等异步完成就继续读，失去背压
