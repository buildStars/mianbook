---
difficulty: 2
tags: [高频, 实践]
---

# 工具调用出错了怎么处理？

::: tip 一句话回答
工具出错时不要直接抛异常中断对话，而是**把错误作为工具结果回传给模型**，让它修正参数、换一种方法，或者如实告诉用户。按错误类型分别处理：**参数不合法**先按 Schema 校验，把具体错在哪里告诉模型；**暂时性故障**在代码里做有限次重试，写操作要保证**幂等**；**超时**要考虑操作可能已经执行；**权限不足**直接拒绝，不重试。整个循环设置最大轮数，防止模型反复调用。
:::

## 详细解析

### 错误分类

| 类型 | 例子 | 处理方式 |
| --- | --- | --- |
| 工具不存在 | 模型编造了一个工具名 | 回传错误，并列出可用的工具 |
| 参数不合法 | JSON 解析失败、缺字段、类型不对、日期格式错 | 按 Schema 校验，回传具体哪个字段错在哪里 |
| 业务规则不满足 | 订单已发货不能取消、余额不足 | 回传原因和可行的替代做法 |
| 暂时性故障 | 网络抖动、下游 5xx、限流 429 | 代码里自动重试，仍失败再回传 |
| 超时 | 下游接口长时间无响应 | 读操作可以重试；写操作结果未知，先查询状态 |
| 权限不足 | 查询别人的订单 | 直接拒绝并说明原因，不重试，也不让模型想办法绕过 |

分两层处理：暂时性故障在**代码层**重试，对模型透明；参数错误和业务错误交给**模型层**，模型看到错误信息后自己修正。工具失败时还要防止模型"假装成功"，系统提示里要求它如实说明，不要编造结果。

### 错误信息写给谁看

- **给模型**：哪里错了、怎么改、值不值得再试，比如"参数 date 格式错误：应为 YYYY-MM-DD，收到'明天'"。不要把堆栈、SQL、内部地址放进去，既浪费 token，又可能被模型复述给用户
- **给用户**：友好、可操作，比如"物流系统暂时不可用，请稍后再试"
- **给日志**：工具名、脱敏后的参数、错误类型、堆栈、重试次数、耗时、链路 ID，见 [怎么给 LLM 调用链做链路追踪](/engineering/eval/07-tracing)

有的接口支持给工具结果加错误标记，比如 Anthropic 的 `is_error`、MCP 的 `isError`，能更明确地告诉模型这次调用失败了。

### 重试、幂等和轮数上限

- 只对暂时性错误重试，次数有限，用指数退避加随机抖动，遵守 `Retry-After`。调用大模型接口本身的限流和重试见 [大模型 API 的限流、重试和降级](/engineering/deploy/08-rate-limit-fallback)
- 读操作重试是安全的；写操作要先做到幂等：请求带上幂等键，服务端用它去重，重复的请求返回第一次的结果
- 幂等键可以由工具调用 id 生成，它能防住代码层重试造成的重复。但模型在下一轮重新发起同样的操作时，调用 id 是新的，这种重复要靠业务规则拦住，比如同一用户对同一订单只能有一笔进行中的退款
- 整个循环设置最大轮数；同一工具、同一参数连续失败几次后不再执行，直接告诉模型"已多次失败，请换一种方法或向用户说明"。更完整的防护见 [怎么防止 Agent 失控](/ai/agent/07-guardrails)

## 代码示例

```ts
import { z } from 'zod'

class RetryableError extends Error {} // 网络抖动、5xx、限流等暂时性错误
class BizError extends Error {} // 业务错误，信息可以给模型看

interface Tool {
  schema: z.ZodType
  idempotent: boolean // 读操作，或带幂等键的写操作
  execute(args: unknown): Promise<unknown>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function runTool(call: { name: string; arguments: string }, registry: Map<string, Tool>) {
  const tool = registry.get(call.name)
  if (!tool) return { isError: true, content: `不存在工具 ${call.name}，可用的有：${[...registry.keys()].join('、')}` }

  // 1. 解析并校验参数，错误具体到字段
  let raw: unknown
  try {
    raw = JSON.parse(call.arguments || '{}')
  } catch {
    return { isError: true, content: '参数不是合法的 JSON，请重新生成' }
  }
  const parsed = tool.schema.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || '参数'}：${i.message}`).join('；')
    return { isError: true, content: `参数错误：${detail}。请修正后重试` }
  }

  // 2. 执行：只有幂等操作遇到暂时性错误才自动重试
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await tool.execute(parsed.data)
      return { isError: false, content: JSON.stringify(result) ?? '执行成功' }
    } catch (err) {
      console.error({ tool: call.name, attempt, err }) // 完整错误只写日志
      const transient = err instanceof RetryableError
      if (transient && tool.idempotent && attempt < 3) {
        await sleep(2 ** attempt * 200 + Math.random() * 200) // 指数退避加随机抖动
        continue
      }
      if (transient && !tool.idempotent) {
        return { isError: true, content: '操作结果未知，可能已经执行。请先查询状态，不要直接重试' }
      }
      if (err instanceof BizError) return { isError: true, content: `执行失败：${err.message}` }
      return { isError: true, content: transient ? '服务暂时不可用，请稍后再试' : '内部错误，无法完成该操作' }
    }
  }
}
```

调用方拿到 `{ isError, content }` 后，按所用 SDK 的格式组装成工具结果消息，接口支持错误标记时一并带上。

## 面试官可能追问

::: details 工具调用超时了，可以直接重试吗？
要看操作类型。查询可以重试。写操作超时时，请求可能已经在下游执行成功，只是响应没回来，直接重试可能重复扣款、重复下单。正确做法是用幂等键让重试变得安全，或者先调用查询接口确认状态；回传给模型时说明"结果未知"，而不是"失败"。
:::

::: details 模型一直用同样的错误参数调用同一个工具，怎么办？
多半是错误信息不够具体，或者工具描述有歧义。先改进错误信息，明确指出正确的格式和示例值。代码层面检测"同一工具加同一参数"的重复失败，超过次数就停止执行，让模型换方法或向用户确认。参数格式问题频繁出现时，可以考虑平台的严格模式来约束参数。
:::

::: details 工具失败了，模型却回答"已经帮您办好了"，怎么防？
这是工具失败场景下的幻觉。措施：错误结果要明确标记为失败；系统提示里要求"工具失败时如实说明，不要编造结果"；关键操作的状态以工具的真实返回为准，比如前端直接渲染工具返回的订单状态，而不是只展示模型写的文字。
:::

::: details 参数校验失败，应该返回协议错误还是工具结果？
返回工具结果，让模型能看到并修正。MCP 规范也是这样划分的：未知工具、请求格式不对属于协议错误，以 JSON-RPC 错误返回；参数校验失败、接口调用失败、业务错误属于工具执行错误，放在结果里并标记 `isError: true`，便于模型自我纠正。
:::

## 易错点

- 工具报错时直接 throw，整个对话中断，模型没有机会修正
- 不区分错误类型一律重试，参数错误和权限错误重试多少次都没用
- 写操作没有幂等保护就自动重试，造成重复执行
- 把堆栈和内部错误原样回传给模型，既浪费 token 又有泄露风险
