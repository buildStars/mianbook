---
difficulty: 2
tags: [手写题, 高频]
---

# 手写一个最小的 Agent 循环

::: tip 一句话回答
最小的 Agent 循环由四部分组成：**消息数组**保存完整的对话和工具结果；**工具注册表**登记每个工具的名称、描述、参数 Schema 和执行函数；**循环**调用模型，有工具调用就执行，把结果按调用 id 追加到消息里，**没有工具调用就结束**；再加上**最大步数和错误处理**，工具出错时把错误作为结果回传，让模型自己修正。生产环境还要补上流式输出、持久化、观测和权限控制。
:::

## 详细解析

### 设计要点

- **消息顺序**：先追加模型的回复（包含工具调用），再追加每个调用的结果，用调用 id 对应
- **错误处理**：工具出错不要抛异常中断循环，把错误作为结果回传；只有模型接口不可用这类系统级错误才向上抛
- **边界**：执行前按 Schema 校验参数，结果过长要截断，设置最大步数防止循环永远不结束

### 适配不同的 SDK

下面的代码使用通用的 `llm.chat` 接口，实际使用时写一层适配器，转换成各家的格式。差异主要在三处：

| 差异点 | 说明 |
| --- | --- |
| 工具定义 | 参数 Schema 的字段名不同，如 `parameters`、`input_schema`；支持的 JSON Schema 关键字范围也不同 |
| 调用参数 | 有的返回 JSON 字符串，需要自己解析；有的已经是对象 |
| 结果回传 | 有的用 `role: 'tool'` 的独立消息加调用 id；有的把结果作为内容块放进 user 消息，并可以标记错误 |

## 代码示例：手写 Agent 循环

```ts
import { z } from 'zod'

// ===== 通用的模型接口，各家 SDK 通过适配器转换成这个形状 =====
type ToolCall = { id: string; name: string; arguments: string } // arguments 是模型生成的 JSON 字符串
type AssistantMessage = { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
type Message =
  | { role: 'system' | 'user'; content: string }
  | AssistantMessage
  | { role: 'tool'; toolCallId: string; content: string; isError?: boolean }
type ToolDef = { name: string; description: string; parameters: object }
declare const llm: { chat(req: { messages: Message[]; tools: ToolDef[] }): Promise<AssistantMessage> }

// ===== 工具注册表 =====
interface Tool<S extends z.ZodType = z.ZodType> {
  name: string
  description: string
  schema: S
  execute(args: z.infer<S>): Promise<unknown>
}
const defineTool = <S extends z.ZodType>(tool: Tool<S>) => tool

const tools: Tool[] = [
  defineTool({
    name: 'get_weather',
    description: '查询指定城市今天的天气。用户问天气、穿衣、是否带伞时使用。',
    schema: z.object({ city: z.string().describe('城市名，如：北京') }),
    async execute({ city }) {
      return { city, weather: '小雨', temp: 18 } // 示例数据，实际应请求天气接口
    },
  }),
]
const toolDefs: ToolDef[] = tools.map((t) => ({
  name: t.name,
  description: t.description,
  parameters: z.toJSONSchema(t.schema, { io: 'input' }), // 按输入类型生成，带默认值的字段不会被标成必填
}))

// ===== 执行单个工具：任何错误都转成结果，交给模型处理 =====
async function runTool(call: ToolCall): Promise<{ content: string; isError: boolean }> {
  const tool = tools.find((t) => t.name === call.name)
  if (!tool) return { content: `不存在工具 ${call.name}`, isError: true }
  try {
    const parsed = tool.schema.safeParse(JSON.parse(call.arguments || '{}'))
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '参数'}：${i.message}`).join('；')
      return { content: `参数校验失败：${detail}`, isError: true }
    }
    const result = await tool.execute(parsed.data)
    const text = typeof result === 'string' ? result : (JSON.stringify(result) ?? '执行成功')
    return { content: text.length > 8000 ? `${text.slice(0, 8000)}\n（结果过长，已截断）` : text, isError: false }
  } catch (err) { // JSON 解析失败和执行时抛出的异常都会到这里
    return { content: `出错：${err instanceof Error ? err.message : String(err)}`, isError: true }
  }
}

// ===== Agent 循环：没有工具调用时结束，最多 MAX_STEPS 步 =====
const MAX_STEPS = 10

export async function runAgent(input: string): Promise<string> {
  const messages: Message[] = [
    { role: 'system', content: '你是一个能使用工具的助手。工具出错时根据错误信息调整；无法完成时如实说明，不要编造结果。' },
    { role: 'user', content: input },
  ]
  for (let step = 0; step < MAX_STEPS; step++) {
    const reply = await llm.chat({ messages, tools: toolDefs })
    messages.push(reply) // 先追加模型的回复，再追加工具结果
    if (!reply.toolCalls?.length) return reply.content // 没有工具调用，这就是最终回答
    for (const call of reply.toolCalls) {
      const { content, isError } = await runTool(call)
      messages.push({ role: 'tool', toolCallId: call.id, content, isError })
    }
  }
  return `已执行 ${MAX_STEPS} 步仍未完成，请缩小问题范围后重试。`
}
```

### 生产环境还需要什么

| 方面 | 要补充的内容 |
| --- | --- |
| 流式输出 | 文本和工具执行状态实时推给前端，见 [服务端怎么转发流式响应](/engineering/streaming/08-server-relay) |
| 持久化 | 消息按会话存库，进程重启或断线后能恢复；恢复时不能重复执行已经执行过的工具 |
| 上下文管理 | 截断或压缩历史，工具调用和它的结果不能拆开，见 [多轮对话的上下文怎么管理](/ai/prompt/06-conversation-memory) |
| 观测 | 记录每一步的输入输出、token、耗时和错误，见 [怎么给 LLM 调用链做链路追踪](/engineering/eval/07-tracing) |
| 权限 | 工具以当前用户的身份执行，敏感操作人工确认，见 [工具调用的权限和安全](/ai/tools/09-tool-permissions) |
| 预算和中断 | token、费用、时间上限，用户可以随时停止，见 [怎么防止 Agent 失控](/ai/agent/07-guardrails) |

## 面试官可能追问

::: details 循环结束的条件有哪些？
正常结束是模型不再调用工具；异常结束包括达到最大步数、token 预算或超时，以及用户中断。也有的设计专门提供一个"提交最终答案"的工具，让结束变得显式、结构化。还要检查模型的结束原因：如果是输出达到长度上限被截断，最后一个工具调用的参数可能不完整，不能当成正常结束处理。
:::

::: details 同一轮的多个工具调用怎么改成并行执行？
用 `Promise.allSettled` 并发执行同一轮的调用，限制并发数，结果按调用 id 回传；有副作用的工具仍然按顺序执行。见 [并行工具调用和多轮工具调用怎么处理](/ai/tools/04-parallel-calls)。
:::

::: details 怎么支持流式输出？
改用流式接口，文本片段一到就推给前端。工具调用的参数也是分片到达的，要拼接完整后再解析和执行，见 [流式输出中的工具调用怎么增量解析](/engineering/streaming/09-streaming-structured)。执行工具期间给前端发"正在查询天气"这类状态事件，下一轮继续流式输出。
:::

## 易错点

- 没有先追加模型的回复（含工具调用）就追加工具结果，或者漏回传某个调用的结果，多数接口会直接报错
- `JSON.parse` 解析参数时没有捕获异常，模型生成一次不合法的 JSON，整个 Agent 就崩溃了
- 工具结果不截断，一次读取大文件或大接口响应就把上下文撑满
- 没有最大步数，模型反复调用工具时程序永远不结束
