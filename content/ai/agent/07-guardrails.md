---
difficulty: 2
tags: [安全, 实践]
---

# 怎么防止 Agent 失控？

::: tip 一句话回答
不能只靠提示词，要在代码里做多层限制：**资源上限**（最大步数、token 和费用预算、总超时、单个工具超时）；**权限控制**（工具最小权限，敏感操作人工确认）；**行为检测**（发现重复动作和死循环就打断）；**环境隔离**（在沙箱里执行代码和命令，限制网络）；**可中断、可回滚**（用户随时能停，操作前留检查点）；**完整记录轨迹**，便于审计和复盘。超出限制时要优雅地停下来：保留进度、说明原因，而不是直接报错。
:::

## 详细解析

### 失控的几种表现

- **死循环**：同一个操作反复执行，或者在两个动作之间来回切换
- **成本失控**：上下文越滚越长，一个任务烧掉大量 token
- **越权或造成破坏**：删错数据、发错邮件、执行危险命令
- **偏离目标**：被工具结果里的内容带偏，甚至被提示注入劫持

### 分层防护

| 层面 | 措施 |
| --- | --- |
| 资源 | 最大步数、token 和费用预算、总超时、单个工具超时 |
| 权限 | 工具最小权限、读写分级、敏感和不可逆操作人工确认，见 [工具调用的权限和安全](/ai/tools/09-tool-permissions) |
| 环境 | 代码和命令在沙箱里执行，限制网络和文件系统访问，环境里不放生产凭证，见 [让 AI 执行代码时，沙箱应该怎么做](/engineering/security/06-sandbox) |
| 行为 | 检测重复动作、来回切换、长时间没有进展；校验工具参数 |
| 恢复 | 用户随时可以中断；操作前留检查点，出错可以回滚 |
| 审计 | 完整记录每一步的输入、输出、工具调用和耗时，见 [怎么给 LLM 调用链做链路追踪](/engineering/eval/07-tracing) |

### 检测死循环

- 给每个动作算一个指纹（工具名加参数），同一个指纹出现超过阈值，就不再执行，而是提示模型换一种方法
- 检测"A → B → A → B"这类来回切换
- 检测没有进展：连续多步没有产生新信息，或者待办清单的状态一直没变
- 打断后把原因告诉模型，给它一次调整的机会；仍然不行就停止，交给用户处理

### 中断和回滚

- **中断**：把 `AbortSignal` 一路传给模型调用和工具执行，用户点击停止后立即生效；无法中途打断的写操作，等它完成、记录结果后再停
- **回滚**：尽量把操作设计成可逆的，比如先生成草稿而不是直接发送，软删除而不是物理删除；编程 Agent 在修改前用 git 提交或快照留下检查点。转账、对外发送这类无法回滚的操作，只能靠事前确认

## 代码示例

带预算、步数限制和重复检测的循环（`llm.chat` 是伪接口，用量字段的名字各家不同）：

```ts
interface Budget {
  maxSteps: number
  maxTokens: number // 可以按模型单价换算成费用上限
  maxMs: number
}

type AgentResult = { status: 'done'; answer: string } | { status: 'stopped'; reason: string }

async function runGuardedAgent(messages: Message[], budget: Budget, signal: AbortSignal): Promise<AgentResult> {
  const startedAt = Date.now()
  let tokens = 0
  const seen = new Map<string, number>() // 动作指纹 → 出现次数

  for (let step = 0; step < budget.maxSteps; step++) {
    if (signal.aborted) return { status: 'stopped', reason: '用户中断' }
    if (Date.now() - startedAt > budget.maxMs) return { status: 'stopped', reason: '超时' }
    if (tokens > budget.maxTokens) return { status: 'stopped', reason: 'token 预算已用完' }

    // 执行中途被中断时，llm.chat 和工具会抛出 AbortError，由调用方处理
    const res = await llm.chat({ messages, tools: toolDefs, signal })
    tokens += res.usage.inputTokens + res.usage.outputTokens
    messages.push(res.message)
    if (!res.toolCalls?.length) return { status: 'done', answer: res.message.content }

    for (const call of res.toolCalls) {
      const key = `${call.name}:${call.arguments}` // 参数写法稍有不同就会被当成不同动作，这里从简
      const count = (seen.get(key) ?? 0) + 1
      seen.set(key, count)
      const content =
        count > 2
          ? '这个操作已经用相同参数执行过多次，请换一种方法，或者停下来向用户说明情况。'
          : await executeTool(call, { signal }) // 内部做权限检查、人工确认和单个工具的超时
      messages.push({ role: 'tool', toolCallId: call.id, content })
    }
  }
  return { status: 'stopped', reason: '步数已用完' }
}
```

返回 `stopped` 时，消息历史仍然是完整的。应用可以把原因和当前进度展示给用户，由用户决定是否追加预算继续执行。

## 面试官可能追问

::: details 步数上限设多少合适？
没有通用的值，要根据评测数据定：统计成功完成的任务用了多少步，上限设在绝大多数成功任务之上，再留一些余量；不同类型的任务分别设置。达到上限时不要直接判失败，先总结已有进展，让用户决定是否继续。
:::

::: details 怎么区分"兜圈子"和正常的重试？
正常的重试会带来新东西：改了参数、换了方法，或者拿到了新的结果。兜圈子则是相同的动作得到相同的结果。所以指纹要包含参数，必要时也比较结果；还可以看待办清单、任务进度有没有推进。规则判断不了时，可以定期让一个便宜的模型检查"最近几步有没有进展"。
:::

::: details 用户点了停止，正在执行的操作怎么办？
能取消的（模型调用、只读查询、网络请求）通过 `AbortSignal` 立即取消；正在进行的写操作要么等它完成，要么用事务保证原子性，不能停在一半。停止后告诉用户已经完成了什么、还有什么没做，并支持从检查点继续。
:::

::: details 在 System Prompt 里写"最多调用 10 次工具"行不行？
不行。模型不一定遵守，也不一定数得准，被提示注入后更不会遵守。提示词可以帮助模型合理安排步骤，但硬性限制必须在循环代码里执行。
:::

## 易错点

- 只限制步数，不限制 token 和时间。上下文很长时，一步的成本也可能很高
- 超出限制时直接抛异常，已经完成的进度和停止的原因都丢了
- 沙箱里留着生产环境的凭证，或者网络完全放开
- 只靠提示词约束 Agent 的行为，代码层没有硬性限制
