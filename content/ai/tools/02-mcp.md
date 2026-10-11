---
difficulty: 2
tags: [高频, 新技术]
---

# MCP 是什么？和 Function Calling 是什么关系？

::: tip 一句话回答
MCP（Model Context Protocol，模型上下文协议）是 Anthropic 在 2024 年 11 月开源的开放协议，用来**统一 AI 应用连接外部工具和数据源的方式**。Function Calling 是模型的能力，解决"模型怎么表达要调用工具"；MCP 是应用层的协议，解决"工具怎么被发现、描述和调用"。一个工具做成 MCP Server 后，支持 MCP 的客户端都能直接接入使用。
:::

## 详细解析

### 解决什么问题

没有 MCP 时，每个 AI 应用都要给每个工具单独写对接代码：M 个应用 × N 个工具，需要 M × N 份集成。有了 MCP，工具方实现一次 Server，应用方实现一次 Client，变成 M + N。官方把它比作 AI 应用的"USB-C 接口"。

2025 年 12 月，MCP 被捐赠给 Linux 基金会下新成立的 Agentic AI Foundation，由社区中立治理。

### 架构概览

- **Host**：用户直接使用的 AI 应用，比如 Claude Desktop、IDE
- **Client**：Host 内部的连接器，和一个 Server 一对一通信
- **Server**：对外提供能力的程序，比如 GitHub、数据库、文件系统的 MCP Server

消息格式是 **JSON-RPC 2.0**。本地 Server 通常用 **stdio**，作为 Host 的子进程运行；远程 Server 用 **Streamable HTTP**（早期规范的 HTTP + SSE 已弃用）。各角色的职责、两种传输方式的区别和版本协商，见 [MCP 的架构](/ai/tools/06-mcp-architecture)。

### Server 能提供的三类能力

| 能力 | 说明 | 由谁决定使用 |
| --- | --- | --- |
| Tools（工具） | 可执行的操作，比如查数据库、创建 issue | 模型 |
| Resources（资源） | 只读的上下文数据，比如文件内容、表结构 | 应用 |
| Prompts（提示模板） | 预置的提示词模板，比如"代码审查" | 用户 |

三者的详细区别见 [MCP 的 Tools、Resources 和 Prompts 有什么区别](/ai/tools/07-mcp-primitives)。

### 和 Function Calling 的关系

| | Function Calling | MCP |
| --- | --- | --- |
| 层次 | 模型能力 | 应用和工具之间的协议 |
| 解决的问题 | 模型如何表达"我要调用某个工具" | 工具如何被发现、描述、调用和复用 |

两者是配合关系：MCP Client 从 Server 拿到工具列表后，通常还是通过 Function Calling 交给模型使用；模型提出调用后，再由 Client 转发给对应的 Server 执行。

## 代码示例

用官方 TypeScript SDK 写一个最小的 MCP Server。完整的开发、注册和调试流程见 [怎么开发一个 MCP Server](/ai/tools/08-mcp-server)：

```ts
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'

// 工厂函数：每个连接由它创建一个 Server 实例
function createServer() {
  const server = new McpServer({ name: 'weather', version: '1.0.0' })
  server.registerTool(
    'get_weather',
    {
      description: '查询指定城市今天的天气',
      inputSchema: z.object({ city: z.string().describe('城市名') }),
    },
    async ({ city }) => ({
      content: [{ type: 'text', text: `${city}：小雨，18℃` }],
    }),
  )
  return server
}

serveStdio(createServer)
```

网上不少示例还是 SDK v1 的写法（从 `@modelcontextprotocol/sdk/server/mcp.js` 导入），区别见 [怎么开发一个 MCP Server](/ai/tools/08-mcp-server) 的追问。

## 面试官可能追问

::: details 什么时候用 MCP，什么时候直接写 Function Calling？
工具只给自己的一个应用用、逻辑简单，直接写 Function Calling 更轻量。希望工具在多个 AI 应用之间复用（IDE、桌面客户端、自研 Agent），或者想直接接入现成的 MCP Server 生态，就用 MCP。
:::

::: details MCP 有哪些安全风险？
- **工具投毒**：恶意 Server 在工具描述里藏指令，诱导模型做危险操作
- **提示注入**：工具返回的内容里夹带恶意指令
- **权限过大**：Server 能访问的数据和操作超出实际需要

应对：只安装可信的 Server，按最小权限配置，敏感操作需要用户确认，见 [工具调用的权限和安全](/ai/tools/09-tool-permissions)。
:::

::: details 除了 Tools、Resources、Prompts，还有哪些能力？
这三类是 Server 提供给 Client 的。反过来，Client 也能为 Server 提供能力，现行的主要是 **Elicitation**：Server 处理请求时，通过 Client 向用户索取补充信息或确认。早期规范里的 **Sampling**（Server 请 Client 代为调用模型）和 **Roots**（告诉 Server 应该在哪些目录工作）在 2026-07-28 版规范中已被标记为弃用，弃用期内仍然可用，但新实现不建议再采用，见 [MCP 的 Tools、Resources 和 Prompts 有什么区别](/ai/tools/07-mcp-primitives)。
:::

::: details MCP 的协议版本是怎么协商的？
2025-11-25 及更早的版本基于握手：连接建立后 Client 先发 `initialize`，双方协商出协议版本和各自的能力。2026-07-28 版规范取消了握手，协议变成无状态的：每个请求在 `_meta` 里声明协议版本和客户端能力，Streamable HTTP 下还要带 `MCP-Protocol-Version` 请求头；Server 必须实现 `server/discover`，Client 可以先用它查询 Server 支持的版本和能力。细节见 [MCP 的架构](/ai/tools/06-mcp-architecture)。
:::

## 易错点

- MCP 不是模型，也不是开发框架，而是一个协议
- MCP 不能取代 Function Calling：模型使用 MCP 工具，通常还是靠 Function Calling 发起调用
- MCP Server 不一定在远程，本地 stdio 方式是最常见的用法之一
