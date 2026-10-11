---
difficulty: 2
tags: [实践, 新技术]
---

# 怎么开发一个 MCP Server？

::: tip 一句话回答
用官方 TypeScript SDK（`@modelcontextprotocol/server`）：在工厂函数里创建 `McpServer`，用 `registerTool` 注册工具，参数用 zod 定义，处理函数返回 `content`；再把工厂函数交给 `serveStdio`，就能以 stdio 方式运行。然后在客户端的配置文件里写上启动命令来注册这个 Server，开发时用 MCP Inspector 调试。stdio 模式下 stdout 是协议通道，**日志只能写到 stderr**。安全上要校验输入、限制可访问的范围，密钥通过环境变量传入。
:::

## 详细解析

### 开发步骤

1. 初始化项目并安装依赖：`npm install @modelcontextprotocol/server zod`（SDK v2 不再支持 zod v3，要用 v4），开发依赖装 `typescript` 和 `@types/node`
2. `package.json` 里设置 `"type": "module"`，用 `tsc` 把代码编译到 `build` 目录
3. 编写 Server：在工厂函数里注册工具，交给 `serveStdio` 运行
4. 用 MCP Inspector 调用工具，检查输入输出
5. 在客户端配置文件里注册，重启客户端后使用

### stdio 模式下不能往 stdout 打日志

stdio 传输中，Server 从 stdin 读消息、往 stdout 写消息，每行一条 JSON-RPC 消息。规范要求 stdout 上只能出现合法的 MCP 消息，一句 `console.log` 就会混进协议流，导致客户端解析失败、连接断开。日志用 `console.error` 写到 stderr，或者写到文件。客户端一般会收集 Server 的 stderr，比如 Claude Desktop 会把它写进这个 Server 对应的日志文件。HTTP 方式运行的 Server 没有这个限制。规范里还有一个通过协议消息给客户端发日志的 Logging 能力，2026-07-28 版已将它标记为弃用，建议改为 stdio 下写 stderr、用 OpenTelemetry 做观测。

### 安全注意事项

- **校验输入**：SDK 会按 zod Schema 校验参数，路径范围、数值上限、权限这类业务约束还要自己检查
- **限制访问范围**：接收路径参数时，先解析成绝对路径，再检查是否在允许的目录内，防止 `../` 越界；访问数据库用只读账号
- **密钥不进代码**：API Key 通过环境变量传入，不要出现在工具结果和日志里
- **本地 Server 以用户权限运行**：它能做用户能做的所有文件操作，只开放必要的目录和能力
- **远程 Server**：用 Streamable HTTP 时要做认证授权，校验 `Origin` 请求头，本地监听时只绑定 127.0.0.1
- **描述要如实**：工具描述会进入模型的上下文，要和实际行为一致，不要写诱导模型的内容。接入第三方 Server 的风险见 [MCP 是什么](/ai/tools/02-mcp)

## 代码示例

一个按关键词搜索本地 Markdown 笔记的 Server（`src/index.ts`）：

```ts
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

// 笔记目录通过命令行参数传入：node build/index.js /path/to/notes
const dirArg = process.argv[2]
if (!dirArg) {
  console.error('用法：node build/index.js <笔记目录>')
  process.exit(1)
}
const NOTES_DIR = path.resolve(dirArg)

// 工厂函数：serveStdio 为每个连接调用它，创建一个 Server 实例
function createServer() {
  const server = new McpServer({ name: 'notes', version: '1.0.0' })

  server.registerTool(
    'search_notes',
    {
      title: '搜索笔记',
      description:
        '在用户的本地 Markdown 笔记里按关键词搜索，返回匹配的文件名和所在行。用户提到"我的笔记""之前记过"时使用。只能搜索，不能修改笔记。',
      inputSchema: z.object({
        keyword: z.string().min(1).describe('要搜索的关键词，区分大小写'),
        limit: z.number().int().min(1).max(20).optional().describe('最多返回几条，默认 5'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ keyword, limit }) => {
      const max = limit ?? 5
      const files = (await readdir(NOTES_DIR)).filter((f) => f.endsWith('.md'))
      const hits: string[] = []
      for (const file of files) {
        if (hits.length >= max) break
        const text = await readFile(path.join(NOTES_DIR, file), 'utf8')
        const line = text.split('\n').find((l) => l.includes(keyword))
        if (line) hits.push(`${file}：${line.trim()}`)
      }
      return {
        content: [{ type: 'text', text: hits.length ? hits.join('\n') : `没有找到包含"${keyword}"的笔记` }],
      }
    },
  )
  return server
}

serveStdio(createServer)
console.error(`notes server 已启动，笔记目录：${NOTES_DIR}`) // 日志写 stderr
```

`serveStdio` 接管 stdio 传输，根据客户端的第一个请求判断协议版本：既能服务 2026-07-28 版的客户端，也兼容还在用 `initialize` 握手的旧客户端。这个工具只接收关键词，文件名都来自 `readdir`，不存在路径越界的问题；如果工具要接收路径参数，就必须做上面说的目录检查。

以 Claude Desktop 为例，在 `claude_desktop_config.json`（macOS 位于 `~/Library/Application Support/Claude/`，Windows 位于 `%APPDATA%\Claude\`）里注册，路径要写绝对路径，需要传密钥时可以加 `env` 字段：

```json
{
  "mcpServers": {
    "notes": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/notes-server/build/index.js", "/Users/me/notes"]
    }
  }
}
```

其他客户端的配置方式类似，但文件位置和字段名可能不同，以客户端文档为准。开发时用 MCP Inspector 调试：

```bash
npm run build
# 打开网页界面，可以查看工具列表、填参数调用、查看收发的 JSON-RPC 消息
npx @modelcontextprotocol/inspector node build/index.js ~/notes
# 命令行模式，适合写进脚本
npx @modelcontextprotocol/inspector --cli node build/index.js ~/notes --method tools/list
```

## 面试官可能追问

::: details 工具执行失败应该怎么返回？
返回一个带 `isError: true` 的结果，`content` 里写清楚原因，让模型能看到错误并调整。官方 SDK 会把处理函数里抛出的异常、以及参数校验失败，都转换成这种结果。未知工具、请求格式错误等属于协议错误，以 JSON-RPC 错误返回，模型通常看不到。
:::

::: details 怎么把它改成远程 Server？
改用 Streamable HTTP 传输：用 SDK 的 `createMcpHandler` 把同一个工厂函数挂到一个接收 POST 请求的端点上（如 `/mcp`），SDK 还提供了 Node.js 原生 HTTP、Express、Hono 等适配包。2026-07-28 版协议是无状态的，不需要维护会话，多实例部署更简单。远程 Server 要做认证授权，规范推荐用 OAuth，还要校验 `Origin` 请求头。
:::

::: details 网上很多示例的导入路径不一样，是怎么回事？
TypeScript SDK 有过一次大版本调整。v1 只有一个包 `@modelcontextprotocol/sdk`，从 `@modelcontextprotocol/sdk/server/mcp.js` 这样的深层路径导入，很多示例把 `inputSchema` 写成 `{ city: z.string() }` 这样的字段对象；v2 拆分成 `@modelcontextprotocol/server`、`@modelcontextprotocol/client` 等包，`inputSchema` 写成 `z.object(...)`。v2 里 stdio 的启动也有两种写法：沿用 v1 风格的 `server.connect(new StdioServerTransport())` 只支持基于握手的旧版协议，`serveStdio(createServer)` 同时支持 2026-07-28 版。官方提供了自动迁移的 codemod，写新项目时以 SDK 文档当前的写法为准。
:::

::: details 客户端里看不到这个 Server，怎么排查？
先在终端里手动执行配置中的命令，看能否正常启动、有没有报错；检查配置里是不是绝对路径，改完代码有没有重新编译；再看客户端的日志，比如 Claude Desktop 在 macOS 上的 `~/Library/Logs/Claude` 目录下，有记录连接情况的日志，也有记录各个 Server stderr 输出的日志。最后用 Inspector 单独连接 Server，确认问题出在 Server 还是客户端配置。
:::

## 易错点

- 用 `console.log` 调试，stdout 被污染导致连接失败
- 配置文件里写相对路径，客户端启动 Server 时找不到文件
- 改完代码没有重新执行 `npm run build`、没有重启客户端，看到改动没生效，就误以为是代码写错了
