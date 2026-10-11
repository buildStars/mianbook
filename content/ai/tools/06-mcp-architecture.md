---
difficulty: 2
tags: [原理, 新技术]
---

# MCP 的架构是怎样的？Host、Client、Server 分别是什么？

::: tip 一句话回答
MCP 是**客户端-服务端**架构。**Host** 是用户直接使用的 AI 应用（如 IDE、桌面 AI 客户端），负责调用模型、管理权限和用户确认；Host 为每个要连接的 Server 创建一个 **Client**，两者**一对一**通信；**Server** 对外提供工具、资源和提示模板。消息格式是 **JSON-RPC 2.0**，传输方式有本地的 **stdio** 和远程的 **Streamable HTTP**。双方要对齐协议版本和各自支持的能力：2025-11-25 及更早的版本靠连接时的 `initialize` 握手协商；2026-07-28 版规范取消了握手，每个请求自带协议版本和客户端能力，Server 的能力通过它必须实现的 `server/discover` 查询。
:::

## 详细解析

### 三个角色

```text
Host（IDE、桌面 AI 客户端、自研 Agent）
 │ 管理对话、调用大模型、权限确认、汇总各 Server 的能力
 ├─ Client A ── stdio ─────────── Server：本地文件系统
 ├─ Client B ── stdio ─────────── Server：本地 Git
 └─ Client C ── Streamable HTTP ── Server：远程工单系统 → 工单系统 API
```

| 角色 | 职责 |
| --- | --- |
| Host | 创建和管理多个 Client，决定连接哪些 Server；执行安全策略，向用户请求授权和确认；把各 Server 的工具交给模型，再把模型发起的调用转给对应的 Server |
| Client | Host 内部的协议组件，只和一个 Server 通信：收发消息，在请求里带上协议版本和能力信息，处理订阅和通知 |
| Server | 通过 Tools、Resources、Prompts 对外提供能力，可以是本地进程，也可以是远程服务 |

规范里有一条关键的设计原则：**Server 看不到完整的对话，也看不到其他 Server**。对话历史留在 Host，Server 只收到完成请求所需的信息，跨 Server 的协作由 Host 控制。这样来源不同、可信度不同的 Server 被互相隔离。另外，MCP 只规定上下文和能力怎么交换，不规定 AI 应用怎么使用大模型。基础概念见 [MCP 是什么](/ai/tools/02-mcp)。

### 数据层和传输层

- **数据层**：基于 JSON-RPC 2.0，定义消息结构和语义。消息分三种：请求（带 id，要求响应）、响应（结果或错误）、通知（不带 id，不需要响应）。各种能力对应具体的方法，如 `tools/list`、`tools/call`
- **传输层**：负责建立连接、消息分帧和认证，同一套 JSON-RPC 消息可以跑在不同的传输方式上

| | stdio | Streamable HTTP |
| --- | --- | --- |
| 运行位置 | Host 把 Server 作为子进程启动，在同一台机器上 | Server 独立运行，通常部署在远程 |
| 通信方式 | 通过标准输入输出收发，每行一条 JSON-RPC 消息 | 每条消息一个 HTTP POST；Server 返回一个 JSON，或者针对这个请求的 SSE 流 |
| 服务对象 | 通常只服务一个 Client | 通常同时服务很多 Client |
| 认证 | 凭证从环境变量等本地配置获取 | 支持标准的 HTTP 认证，推荐用 OAuth 获取令牌 |
| 典型场景 | 访问本地文件、本地开发工具 | SaaS 服务、团队共享的工具 |

stdio 模式下 Server 的 stdout 只能输出协议消息，日志要写到 stderr，见 [怎么开发一个 MCP Server](/ai/tools/08-mcp-server)。远程传输早期用的是 HTTP + SSE（两个端点加一条长连接），已被 Streamable HTTP 取代并标记为弃用。

### 版本和能力协商

双方要对齐两件事：用哪个协议版本；各自支持哪些能力，比如 Server 是否提供工具、工具列表变化时会不会通知，Client 是否支持向用户索取信息。

**2025-11-25 及更早的版本**：连接建立后先握手，握手完成前一般不发送其他请求。

```text
Client → Server  initialize（客户端支持的协议版本、clientInfo、客户端能力）
Server → Client  响应（选定的协议版本、serverInfo、服务端能力）
Client → Server  notifications/initialized
之后才开始 tools/list、tools/call 等正常请求
```

**2026-07-28 版规范**：取消了握手和协议层的会话，协议变成无状态的。

- 每个请求在 `_meta` 里携带协议版本和客户端能力（Streamable HTTP 下还要在 `MCP-Protocol-Version` 请求头里带上同一个版本号），Server 独立处理每个请求，不依赖之前的请求
- Server 必须实现 `server/discover`，Client 可以先调用它，一次拿到 Server 支持的版本、能力和身份信息
- 版本不支持时，Server 返回 `UnsupportedProtocolVersionError` 并列出支持的版本，Client 换一个版本重试
- 需要跨请求保存的状态（如购物车），由 Server 生成一个显式的句柄，作为普通的工具参数在后续调用中传入

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "search_tickets",
    "arguments": { "keyword": "退款" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { "name": "my-ide", "version": "1.0.0" },
      "io.modelcontextprotocol/clientCapabilities": { "elicitation": {} }
    }
  }
}
```

无状态的好处是远程 Server 更容易水平扩展：任何一个实例都能处理任何请求，不需要粘性会话，也不需要在实例之间共享会话数据。

## 面试官可能追问

::: details 为什么要为每个 Server 单独创建一个 Client？
一是隔离：每个连接各自独立，Server 之间互相看不到，一个 Server 出问题不影响其他连接，Host 还可以对不同的 Server 采用不同的权限策略。二是职责单一：每个 Client 只负责和一个 Server 的通信、订阅和通知，Host 在上层汇总所有 Server 的能力。
:::

::: details MCP Server 会直接调用大模型吗？
一般不会，调用模型的是 Host。规范里有一个 Sampling 能力，让 Server 通过 Client 请 Host 代为调用模型；2026-07-28 版规范已经把它标记为弃用（弃用期内仍然可用），建议需要模型能力的 Server 直接对接模型厂商的 API。
:::

::: details stdio 和 Streamable HTTP 怎么选？
只在用户本机使用、需要访问本地文件或本地工具时用 stdio，由 Host 负责启动和关闭进程，部署最简单。要给多个用户或多个应用共享、对接 SaaS 服务时用 Streamable HTTP，这时要做好认证和授权，还要校验 `Origin` 请求头；HTTP Server 在本机运行时只绑定 127.0.0.1，防止 DNS 重绑定攻击。
:::

::: details Server 的工具列表变了，Client 怎么知道？
Server 在能力里声明 `listChanged` 后，可以在工具列表变化时发送 `notifications/tools/list_changed` 通知，Client 收到后重新调用 `tools/list`。2026-07-28 版规范中，Client 要先用 `subscriptions/listen` 订阅这类通知，Server 在这个请求的响应流上持续推送。通知是尽力送达的，不保证不丢；列表结果还带有 `ttlMs` 缓存提示，Client 用到列表时发现已经过期，就重新获取。
:::

## 易错点

- 把 Client 理解成"用户用的客户端软件"。用户用的是 Host，Client 是 Host 内部和某个 Server 一对一连接的组件
- 认为 MCP Server 都在远程。本地 stdio 是很常见的用法，这时 Server 以用户的权限运行在本机上
- 认为只有 Client 能发起交互。Server 可以发通知，也能在处理请求时要求 Client 补充用户输入，见 [MCP 的 Tools、Resources 和 Prompts 有什么区别](/ai/tools/07-mcp-primitives)
