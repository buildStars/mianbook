---
difficulty: 2
tags: [原理, 对比]
---

# MCP 的 Tools、Resources 和 Prompts 有什么区别？

::: tip 一句话回答
三者的核心区别是**由谁决定使用**。**Tools** 由模型决定调用，用来执行操作，可以有副作用；**Resources** 由应用决定读取，是用 URI 标识的只读上下文数据，比如文件内容、表结构；**Prompts** 由用户主动选择，是 Server 预置的提示模板，常以斜杠命令的形式出现。反过来，Client 也能为 Server 提供能力，比如向用户索取信息的 Elicitation；Sampling 和 Roots 在 2026-07-28 版规范中已被标记为弃用。
:::

## 详细解析

### 对比

| | Tools | Resources | Prompts |
| --- | --- | --- | --- |
| 控制方 | 模型 | 应用（Host） | 用户 |
| 作用 | 执行操作、查询实时数据 | 提供只读的上下文数据 | 提供可复用的提示模板 |
| 标识 | 工具名 | URI，如 `file:///project/README.md` | 模板名 |
| 主要方法 | `tools/list`、`tools/call` | `resources/list`、`resources/read`、`resources/templates/list` | `prompts/list`、`prompts/get` |
| 常见界面 | 模型自动调用，敏感操作弹窗确认 | 资源选择器、搜索后手动添加，或由应用自动附加 | 斜杠命令、命令面板 |
| 例子 | 搜索航班、创建工单、执行 SQL | 日历数据、数据库表结构、项目文档 | "代码审查""总结会议纪要" |

基础介绍见 [MCP 是什么](/ai/tools/02-mcp)，三者在架构中的位置见 [MCP 的架构](/ai/tools/06-mcp-architecture)。

### Tools：模型控制的操作

- 定义包含 `name`、`description` 和参数的 `inputSchema`，可选 `title`（显示名）、`outputSchema`（结构化结果的格式）和 `annotations`（行为提示）
- 结果放在 `content` 数组里，可以是文本、图片、音频、资源链接或内嵌资源；声明了 `outputSchema` 时，还要返回符合它的 `structuredContent`
- 执行失败时在结果里标记 `isError: true`，让模型看到错误并修正
- 规范建议始终保留人工把关：界面上让用户知道开放了哪些工具、何时被调用，敏感操作执行前请用户确认

### Resources：应用控制的上下文

- 每个资源用 URI 唯一标识，常见的有 `file://`、`https://`、`git://`，也可以自定义，比如 `calendar://events/2024`
- 内容是文本（`text`）或 base64 编码的二进制（`blob`），带 `mimeType`
- **资源模板**用 URI 模板描述一类带参数的资源，比如 `weather://forecast/{city}/{date}`，参数可以配合补全接口给出提示
- Client 可以订阅某个资源，资源变化时 Server 发送更新通知
- 怎么使用由应用决定：让用户手动选择，按关键词或 Embedding 筛选，或者全部交给模型

### Prompts：用户选择的模板

- 内容由 Server 定义，用户在界面上显式选用，比如输入 `/` 后从列表里选
- 可以带参数，`prompts/get` 返回一组填好参数的消息，角色是 user 或 assistant，内容可以包含文本、图片或资源
- 适合把"怎么用好这个 Server"的经验固化下来，比如数据库 Server 提供一个带示例查询的"分析慢查询"模板

```json
{
  "resultType": "complete",
  "description": "分析一条慢查询并给出优化建议",
  "messages": [
    {
      "role": "user",
      "content": { "type": "text", "text": "请分析下面这条 SQL 慢在哪里，并给出索引建议：\nSELECT * FROM orders WHERE ..." }
    }
  ]
}
```

上面是 `prompts/get` 返回的结果，Host 把这些消息放进对话，再交给模型处理。

### Client 提供给 Server 的能力

| 能力 | 作用 | 状态 |
| --- | --- | --- |
| Elicitation | Server 处理请求时，通过 Client 向用户索取信息或确认，分为表单模式和 URL 模式 | 正常使用 |
| Sampling | Server 请 Client 代为调用大模型，Server 不需要自己的模型密钥 | 2026-07-28 版标记为弃用，建议直接对接模型 API |
| Roots | Client 告诉 Server 应该在哪些目录范围内工作 | 2026-07-28 版标记为弃用，建议通过工具参数、资源 URI 或 Server 配置传递目录 |

2026-07-28 版规范中，这类交互不再由 Server 主动向 Client 发请求，而是在响应里返回一个 `input_required` 类型的结果，说明需要什么输入，Client 收集好之后带着这些输入重试原请求。

## 面试官可能追问

::: details 同一个能力，做成 Tool 还是 Resource？
有副作用的操作只能是 Tool。只读数据要看由谁决定什么时候用：需要模型根据对话自己判断何时获取（比如按关键词搜索），做成 Tool；用户或应用明确要附加的上下文（比如某个文件、某张表的结构），做成 Resource。
:::

::: details 工具注解（annotations）能当作安全保证吗？
不能。`readOnlyHint`、`destructiveHint` 这类注解是 Server 自己声明的，只是提示。规范要求 Client 除非信任这个 Server，否则必须把注解当作不可信信息。是否需要用户确认，应由 Host 根据自己的安全策略决定。
:::

::: details Elicitation 能用来让用户输入密码或 API Key 吗？
表单模式不能。规范禁止通过表单模式索取密码、API Key、访问令牌、支付凭证等敏感信息，这类场景必须用 URL 模式：Client 展示完整的链接，经用户同意后在浏览器中打开，用户直接在 Server 方的页面上输入，数据不经过 Client，也不会进入模型的上下文。完整的用法见 [MCP 的 Elicitation](/ai/tools/18-mcp-elicitation)。
:::

::: details 所有客户端都支持这几类能力吗？
不一定。规范里除了基础协议，其余能力都是可选的，客户端按需实现，所以不同客户端对 Tools、Resources、Prompts 和 Elicitation 等能力的支持程度不一样。开发 Server 前先查目标客户端的文档确认支持情况，并准备退路，比如把重要的只读数据同时做成一个查询工具。
:::

## 易错点

- 把三种能力都当成"模型调用的函数"，实际上只有 Tools 由模型控制
- 认为 Resource 只能是文件。URI 可以指向数据库表结构、日历、接口数据等任何数据，文件只是其中一种
- 把 Roots 当成安全边界。Roots 只是告诉 Server 应该在哪里工作，并不强制限制访问，真正的隔离要靠操作系统权限或沙箱
