---
difficulty: 2
tags: [实践, 场景题]
---

# Node.js 读写文件要注意哪些问题？同步 API、原子写入和打开文件过多怎么处理？

::: tip 一句话回答
fs 有**同步、回调、Promise** 三套 API，服务端代码用 `node:fs/promises`，同步 API 会阻塞事件循环，只适合启动阶段和命令行脚本。`writeFile` **不是原子的**，写到一半进程崩溃会留下半个文件，正确做法是**先写临时文件、fsync，再 rename 覆盖**。同时打开太多文件会报 **EMFILE**，要限制并发，`FileHandle` 用完及时关闭（可以用 `await using`）。
:::

## 详细解析

### 三套 API 怎么选

| 写法 | 例子 | 特点 |
| --- | --- | --- |
| 同步 | `fs.readFileSync` | 阻塞主线程，读完才往下走 |
| 回调 | `fs.readFile(path, cb)` | 历史写法，回调地狱 |
| Promise | `import { readFile } from 'node:fs/promises'` | 配合 `await`，推荐 |

服务器处理请求时调一次 `readFileSync` 读个大文件，这段时间所有请求都在等。启动时读配置、命令行脚本里用同步 API 没问题。异步 fs 操作在 libuv 线程池里执行（默认 4 个线程），大量并发的文件操作会排队，也会拖慢同样走线程池的 DNS 查询、crypto 等操作。

`readFile` 一次把文件全部读进内存，大文件要用流，见 [Stream 是什么？](/basics/node/03-stream) 和 [逐行处理大日志文件](/basics/node/26-line-by-line-stream)。

### 原子写入

`writeFile` 先截断文件再写入。写到一半进程被杀、机器断电，或者另一个进程恰好此时读取，看到的都是空文件或半个文件。配置文件、状态文件被写坏，下次启动就解析失败。

做法：

1. 在**同一个目录**下写临时文件（保证和目标在同一个文件系统上）
2. `fsync`（`filehandle.sync()`）把数据真正刷到磁盘，否则断电后可能只剩文件名、没有内容
3. `rename` 临时文件到目标路径。同一文件系统上 rename 是原子替换，读者要么看到完整的旧文件，要么看到完整的新文件
4. 出错时删掉临时文件

对数据可靠性要求更高时，还要对所在目录做 fsync，确保 rename 本身落盘。

### 并发写和 EMFILE

- 两个异步操作同时 `writeFile` 同一个文件，结果取决于谁最后完成，前一次的内容会被覆盖；`appendFile` 并发追加也可能交错。同一个文件的写操作要串行化（排队），或者交给一个专门的写入方
- 每个进程能打开的文件描述符数有上限。`Promise.all(files.map(f => readFile(f)))` 一次处理上万个文件，就会抛 `EMFILE: too many open files`。要把并发限制在几十个左右，例如用 p-limit 这类并发控制库，或者分批处理
- 用 `fs.promises.open` 拿到的 `FileHandle` 必须显式关闭。`FileHandle` 实现了 `Symbol.asyncDispose`，可以用 `await using` 让它离开作用域时自动关闭，抛异常也不会漏

### 路径、watch 和新 API

- ESM 里没有 `__dirname`，用 `import.meta.dirname`、`import.meta.filename`。相对路径是相对 `process.cwd()` 解析的，不是相对当前文件，从别的目录启动就会找不到文件
- 路径用 `path.join` / `path.resolve` 拼接，它会处理分隔符和多余的斜杠；字符串相加在 Windows 上容易出问题
- `fs.watch` 官方明确说各平台行为不 100% 一致：一次保存可能触发多次事件，文件名参数可能拿不到，网络文件系统和 Docker 挂载的目录上可能不可靠。要防抖，必要时用 chokidar 这类封装库
- `fs.glob`、`fs.promises.glob` 在较新的版本里已经稳定，可以按模式找文件，不必再装 glob 包；`fs.cp` 可以递归复制目录

## 代码示例：原子写入

```js
import { open, rename, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export async function writeFileAtomic(file, data) {
  // 临时文件和目标放在同一目录，保证 rename 不跨文件系统
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`)
  try {
    {
      await using fh = await open(tmp, 'w') // 离开这个块时自动 close
      await fh.writeFile(data)
      await fh.sync() // 先把数据刷到磁盘，再改名
    }
    await rename(tmp, file) // 原子替换
  } catch (err) {
    await rm(tmp, { force: true }) // 失败时清理临时文件
    throw err
  }
}

const target = path.join(import.meta.dirname, 'config.json')
await writeFileAtomic(target, JSON.stringify({ v: 1 }))
await writeFileAtomic(target, JSON.stringify({ v: 2 }))
console.log(await readFile(target, 'utf8')) // {"v":2}，目录里不留 .tmp 文件
```

## 面试官可能追问

::: details writeFile 的 flush 选项能代替这套流程吗？
不能。`flush: true` 只是在写完后调用 fsync，保证写完的数据落盘，但写的过程中仍然是在原文件上截断再写，崩溃时照样留下半个文件。原子性靠的是"写临时文件再 rename"。
:::

::: details rename 在 Windows 上也是原子的吗？
Node 的 `rename` 在 Windows 上会替换已存在的目标文件，但 Windows 并不像 POSIX 那样明确保证这个替换是原子的，实践中通常够用。另外，如果目标正被别的进程以不允许共享的方式打开（例如杀毒软件、编辑器），rename 可能失败，常见做法是短暂重试几次。跨盘符、跨文件系统的 rename 不会成功，所以临时文件一定要和目标在同一目录。
:::

::: details 多个进程同时写同一个文件怎么办？
进程内的排队管不到别的进程。可以每个进程写自己的文件再合并，或者用锁文件协调，例如以 `wx` 标志创建锁文件（文件已存在就失败），持有锁的进程写完再删除；还要处理进程崩溃后锁文件残留。更根本的办法是交给数据库。
:::

## 易错点

- 在请求处理函数里用 `readFileSync`、`writeFileSync`，并发一高就卡住整个服务
- 直接 `writeFile` 覆盖重要的配置或状态文件，崩溃后文件被写坏
- 临时文件放在系统临时目录（如 `/tmp`），和目标不在一个文件系统上，rename 失败
- 用 `'./data.json'` 这样的相对路径，以为是相对当前文件，实际相对的是进程的工作目录
