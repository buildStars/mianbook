---
difficulty: 1
tags: [高频, 实践]
---

# tool_choice 是什么？怎么强制或禁止模型调用工具？

::: tip 一句话回答
`tool_choice` 是请求里控制"这一轮要不要调工具、调哪个"的参数。常见四种模式：**自动**（默认，模型自己决定）、**必须调用**（至少调一个，调哪个模型选）、**指定某个工具**、**禁止调用**（工具定义还在，但这一轮只能回复文字）。各家命名不同，比如 OpenAI 叫 `required`，Anthropic 叫 `any`。强制调用适合"这一步一定要拿到结构化结果"的场景，但它会让模型失去"不调用"的选择，用错了就是硬凑参数。
:::

## 详细解析

### 四种模式

| 模式 | 含义 | OpenAI | Anthropic | Gemini（`function_calling_config.mode`） |
| --- | --- | --- | --- | --- |
| 自动 | 模型决定调不调、调哪个 | `auto` | `{ type: "auto" }` | `AUTO` |
| 必须调用 | 必须调至少一个工具 | `required` | `{ type: "any" }` | `ANY` |
| 指定工具 | 必须调这一个 | `{ type: "function", ... }` 里写函数名 | `{ type: "tool", name }` | `ANY` 加 `allowed_function_names` 只列一个 |
| 禁止调用 | 只回复文字 | `none` | `{ type: "none" }` | `NONE` |

字段的具体写法以各家文档为准，面试时讲清四种语义就够了。

### 什么时候强制调用

- **把工具当结构化输出用**：定义一个 `extract_order` 工具，强制调用它，模型就只能按参数的 JSON Schema 输出。很多 SDK 的"结构化输出"早期就是这么实现的，现在也可以直接用 JSON Schema 输出模式，见 [怎么让大模型稳定地输出 JSON](/ai/prompt/04-structured-output)
- **工作流里的固定步骤**：流程规定第一步必须先查用户信息，就指定 `get_user`，不让模型跳过
- **分类和路由**：给一个 `route` 工具，参数是枚举，强制调用，拿到的就是合法的类别

### 什么时候禁止调用

- **最后一轮总结**：Agent 步数或预算用完了，再请求一次并设成禁止调用，让模型基于已有信息给出回答，而不是又发起一个工具调用（见 [怎么防止 Agent 失控](/ai/agent/07-guardrails)）
- **保留工具定义但暂时不用**：工具列表不变，前缀缓存还能命中；直接把 `tools` 删掉会让缓存失效，见 [Prompt 缓存](/engineering/deploy/04-prompt-caching)

### 强制调用的副作用

- 模型没有足够信息也必须调用，于是**编造参数**。比如用户只说了"帮我查订单"，没给订单号，强制调用 `get_order` 就会得到一个瞎填的 ID
- 在强制模式下，有的模型会直接输出工具调用，不先输出解释或推理文字；有的平台在开启扩展思考时只支持自动和禁止两种模式
- 每一轮都强制调用，Agent 循环就**永远停不下来**，因为模型没有机会输出最终回答。强制通常只用在某一轮，下一轮要改回自动

## 代码示例

```ts
// 伪接口：llm.chat 的参数名各家不同，这里用通用写法表达意图
type ToolChoice = { mode: 'auto' } | { mode: 'any' } | { mode: 'tool'; name: string } | { mode: 'none' }

function pickToolChoice(step: number, maxSteps: number, firstTool?: string): ToolChoice {
  if (step === 0 && firstTool) return { mode: 'tool', name: firstTool } // 第一步固定先调某个工具
  if (step >= maxSteps - 1) return { mode: 'none' } // 最后一步禁止调用，逼模型给出回答
  return { mode: 'auto' }
}

console.log(pickToolChoice(0, 5, 'get_user')) // { mode: 'tool', name: 'get_user' }
console.log(pickToolChoice(2, 5)) // { mode: 'auto' }
console.log(pickToolChoice(4, 5)) // { mode: 'none' }
```

## 面试官可能追问

::: details 只想让模型在部分工具里选，怎么做？
有两种做法。一是这一轮的 `tools` 只传这几个，简单但会影响前缀缓存。二是用平台提供的"允许的工具"列表，比如 Gemini 的 `allowed_function_names`，以及 OpenAI 部分接口支持的 allowed tools，工具定义保持不变，只限制这一轮可选的范围。
:::

::: details 设了自动模式，模型却该调的时候不调，怎么办？
先查工具描述有没有写清"什么时候用"，见 [工具的描述和参数怎么写](/ai/tools/03-tool-description)。再看系统提示里是否有"尽量直接回答"之类的冲突指令。确实是固定流程的话，就在代码里对那一步指定工具，而不是靠提示词去劝。
:::

::: details 强制调用和并行调用能一起用吗？
可以。必须调用模式下模型仍可能一次发起多个调用。如果你只想要一个调用，比如把工具当结构化输出用，要关掉并行调用：Anthropic 用 `disable_parallel_tool_use`，OpenAI 用 `parallel_tool_calls: false`。并行调用的处理见 [并行工具调用和多轮工具调用](/ai/tools/04-parallel-calls)。
:::

## 易错点

- 在 Agent 循环的每一轮都设成必须调用，循环永远结束不了
- 用户信息不全时强制调用，得到的是编造的参数，应该先让模型追问
- 以为禁止调用就要把 `tools` 删掉。删掉会改变请求前缀，缓存命中率下降
- 记混各家的取值：Anthropic 的 `any` 对应 OpenAI 的 `required`，不是"随便"的意思
