---
difficulty: 1
tags: [实践]
---

# 怎么用 Node.js 写一个命令行工具？参数解析、管道输入和退出码怎么处理？

::: tip 一句话回答
入口文件第一行写 **shebang**（`#!/usr/bin/env node`），在 `package.json` 的 **bin** 字段里注册命令名，本地用 `npm link` 调试。参数用内置的 **util.parseArgs** 解析；没有文件参数且 `process.stdin.isTTY` 不为真时，从 stdin 读管道输入。**数据写 stdout，提示和错误写 stderr**；成功退出码 0、失败非 0，优先设置 **process.exitCode** 让进程自然退出，而不是直接 `process.exit()`。
:::

## 详细解析

### 注册成命令

```json
{
  "name": "line-tool",
  "type": "module",
  "bin": { "line-tool": "./cli.mjs" }
}
```

- `npm install -g` 或 `npm link` 时，npm 会把 `bin` 里的文件链接到全局 bin 目录，在 Windows 上还会生成一个 `.cmd` 包装脚本
- 类 Unix 系统靠 shebang 知道用 node 执行，文件还需要可执行权限，npm 安装时会处理
- `npm link` 把当前目录链接到全局，改完代码立即生效；发布后别人可以 `npx line-tool` 直接运行，不用全局安装

### 参数解析：util.parseArgs

`util.parseArgs` 已经是稳定 API，简单工具不必再装 commander、yargs。每个选项配置 `type`（`'boolean'` 或 `'string'`）、`short`（单字符别名）、`default`、`multiple`。默认 `strict: true`：遇到没配置的选项抛 `ERR_PARSE_ARGS_UNKNOWN_OPTION`，类型不符抛 `ERR_PARSE_ARGS_INVALID_OPTION_VALUE`；有位置参数（比如文件名）要设 `allowPositionals: true`，否则抛 `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL`。需要子命令、自动生成帮助信息时，再考虑第三方库。

### stdin、stdout、stderr

- 管道输入：`echo hi | line-tool` 时 stdin 是管道，`process.stdin.isTTY` 是 `undefined`；直接在终端里运行时它是 `true`。据此决定是读 stdin 还是提示用户
- stdout 只放"数据"，进度、提示、错误都写 stderr。这样 `line-tool a.txt > out.txt` 或接下一个命令时，管道里只有干净的数据
- 颜色用 `util.styleText`。它默认会检查输出流能否显示颜色，并参考 `NO_COLOR`、`FORCE_COLOR`、`NODE_DISABLE_COLORS` 环境变量，输出被重定向到文件时不会混进转义码。写 stderr 的颜色要传 `{ stream: process.stderr }`，让它检查的是 stderr

## 代码示例

```js
#!/usr/bin/env node
// cli.mjs：给每行加前缀，可选转大写
import { parseArgs, styleText } from 'node:util'
import { readFile } from 'node:fs/promises'
import { text } from 'node:stream/consumers'

const err = (color, msg) => console.error(styleText(color, msg, { stream: process.stderr }))

const { values, positionals } = parseArgs({
  options: {
    upper: { type: 'boolean', short: 'u', default: false },
    prefix: { type: 'string', short: 'p', default: '' },
  },
  allowPositionals: true, // 位置参数是文件名
})

try {
  let input
  if (positionals.length > 0) {
    input = (await Promise.all(positionals.map((f) => readFile(f, 'utf8')))).join('\n')
  } else if (!process.stdin.isTTY) {
    input = await text(process.stdin) // 读完整个管道输入
  } else {
    err('yellow', '没有输入：请传文件名，或通过管道输入')
    process.exitCode = 2
  }
  if (input !== undefined) {
    const lines = input.split('\n').filter(Boolean)
    for (const line of lines) {
      process.stdout.write(values.prefix + (values.upper ? line.toUpperCase() : line) + '\n')
    }
    err('green', `处理了 ${lines.length} 行`) // 提示走 stderr
  }
} catch (e) {
  err('red', `出错: ${e.message}`)
  process.exitCode = 1
}
```

```bash
$ printf 'foo\nbar\n' | node cli.mjs -u --prefix '> '
> FOO
> BAR
处理了 2 行
$ node cli.mjs -p '# ' in.txt          # in.txt 内容是 hello、world 两行
# hello
# world
处理了 2 行
$ printf 'a\nb\n' | node cli.mjs 2>/dev/null | wc -l   # 丢掉 stderr，只剩数据
2
$ node cli.mjs nope.txt; echo $?
出错: ENOENT: no such file or directory, open '.../nope.txt'
1
```

### 退出码、Ctrl+C 和 EPIPE

- `process.exit()` 会立刻结束进程，stdout 还没写完的数据（写到管道时是异步的）可能被截断。设置 `process.exitCode = 1` 后让事件循环自然清空，更安全
- 用户按 Ctrl+C 时进程收到 SIGINT。监听 `process.on('SIGINT', ...)` 后默认退出行为就没了，要自己删临时文件再退出，按惯例退出码用 130（128 + 信号值 2）
- `line-tool big.txt | head -2`：`head` 读够两行就关掉管道，再写 stdout 会触发 `EPIPE` 错误。可以给 stdout 加错误处理，遇到 `EPIPE` 就安静退出：

```js
process.stdout.on('error', (e) => {
  if (e.code === 'EPIPE') process.exit(0) // 下游不要数据了，正常结束
  throw e // 其他错误照常抛出，让进程带着错误退出
})
```

## 面试官可能追问

::: details 为什么 Windows 上也能直接运行带 shebang 的文件？
Windows 不认 shebang。是 npm 在安装或 `npm link` 时额外生成了 `line-tool.cmd`、PowerShell 脚本等包装文件，里面调用 `node cli.mjs`。所以要通过 `bin` 安装后再运行，直接双击 `.mjs` 不行。
:::

::: details 读 stdin 时，如果没有管道输入又没传参数会怎样？
如果不判断 `isTTY` 就去读 stdin，程序会一直等用户在终端里输入，直到按 Ctrl+D（Windows 上是 Ctrl+Z 回车），看起来像卡住了。所以要先判断：是终端就打印用法并以非 0 退出码结束。
:::

::: details 退出码有哪些约定？
0 表示成功，非 0 表示失败，shell 的 `&&`、CI 脚本都靠它判断。常见约定是 1 表示一般错误，2 表示用法错误（参数不对），被信号终止时是 128 加信号值。Node 自己遇到未捕获异常时以 1 退出。
:::

## 易错点

- 把日志和提示用 `console.log` 打到 stdout，下游程序会把它们当成数据处理
- 失败了却以 0 退出，CI 和 shell 脚本会以为成功了
- 在异步写 stdout 之后马上 `process.exit()`，输出被截断
- 往终端以外的地方输出写死的 ANSI 颜色码，重定向到文件后全是乱码
