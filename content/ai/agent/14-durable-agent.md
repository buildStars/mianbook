---
difficulty: 3
tags: [系统设计, 实践]
---

# Agent 的状态怎么持久化？中断后怎么从断点恢复？

::: tip 一句话回答
跑几十分钟甚至几小时的 Agent，中途会遇到进程重启、部署、网络断开、等待用户审批。要能恢复，就要在**每一步结束时保存检查点**：消息历史、待执行的工具调用、计划和进度、步数和预算用量。恢复时读出最新的检查点继续跑。难点在**副作用**：工具执行完、检查点还没写就崩溃了，恢复后会再执行一次，所以写操作必须**幂等**。常见实现是"事件日志 + 状态快照"，也可以用现成的持久化执行框架或 Agent 框架自带的检查点功能。
:::

## 详细解析

### 状态里有什么

| 部分 | 内容 |
| --- | --- |
| 对话 | 完整消息历史，包括工具调用和结果；压缩过的话存摘要和压缩点 |
| 待办 | 模型已发起、还没执行或还在等审批的工具调用 |
| 计划 | 待办清单、当前阶段、外部笔记的位置 |
| 计量 | 已用步数、token、费用、开始时间，恢复后继续累计，不能清零 |
| 环境 | 工作目录或沙箱的快照 ID、浏览器会话等外部状态的引用 |
| 元数据 | 任务 ID、用户、状态（运行中 / 等待审批 / 已暂停 / 已完成 / 失败）、版本号 |

模型调用本身无状态，所以"恢复 Agent"就是"恢复这些数据然后继续循环"。外部环境比如沙箱、浏览器很难完整保存，要么存快照，要么在恢复时重建并告诉模型环境已重置。

### 什么时候写检查点

一步的过程是：调用模型 → 得到工具调用 → 执行工具 → 追加结果。在两个位置各写一次：

1. **模型返回之后、执行工具之前**：记下"准备执行这些调用"。等待审批的任务就停在这里，见 [人在回路怎么设计](/ai/agent/11-human-in-the-loop)
2. **工具执行之后**：记下结果

恢复时如果发现停在第 1 点之后、第 2 点之前，说明工具可能执行了也可能没执行，这正是要靠幂等处理的地方。模型调用没有外部副作用，重来一次只是多花点钱。

### 副作用和幂等

崩溃发生在"工具已执行、结果没保存"之间，恢复后重放就会重复执行。解决办法：

- 每个工具调用用 `任务 ID + 步骤号 + 调用 ID` 作幂等键，重放时同一个键直接拿到第一次的结果，见 [模型可能重复调用写操作工具，怎么保证幂等](/ai/tools/15-idempotent-tools)
- 不支持幂等的下游，恢复时先查询状态再决定要不要执行
- 实在无法确认的，把这一步标记为"状态未知"，交给人处理

### 两种存储方式

- **状态快照**：每步覆盖保存一份完整状态，读取简单；可以多保留几个历史版本，用来回到某一步重新分支
- **事件日志**：只追加"模型返回了什么、工具返回了什么"的事件，恢复时按顺序重放得到状态。天然保留了完整轨迹，方便审计和调试，但重放要保证确定性：模型调用和工具结果都从日志读取，不能重新调用

不少持久化执行框架用的就是事件日志的思路，把每个有副作用的步骤的结果记下来，重放时直接复用。

### 版本兼容

任务暂停了一天，期间代码发了新版本：工具改了参数、提示词变了。检查点要带版本号，恢复时检查兼容性；不兼容的要么迁移，要么让旧任务在旧版本的执行器上跑完。

## 代码示例

```ts
interface Checkpoint {
  taskId: string
  step: number
  status: 'running' | 'awaiting_tool' | 'done'
  messages: { role: string; content: string }[]
  pending?: { callId: string; name: string; args: unknown }
}

const store = new Map<string, Checkpoint>() // 实际用数据库，写入要保证原子性
const save = (cp: Checkpoint) => store.set(cp.taskId, structuredClone(cp))

async function resume(taskId: string, runTool: (key: string, name: string, args: unknown) => Promise<string>) {
  const cp = store.get(taskId)
  if (!cp || cp.status === 'done') return cp
  if (cp.status === 'awaiting_tool' && cp.pending) {
    // 停在"准备执行"之后：用幂等键执行，就算之前已经执行过也不会重复
    const key = `${cp.taskId}:${cp.step}:${cp.pending.callId}`
    const result = await runTool(key, cp.pending.name, cp.pending.args)
    cp.messages.push({ role: 'tool', content: result })
    cp.pending = undefined
    cp.status = 'running'
    cp.step += 1
    save(cp)
  }
  return cp // 之后回到正常的 Agent 循环
}

save({ taskId: 't1', step: 3, status: 'awaiting_tool', messages: [], pending: { callId: 'c9', name: 'send_email', args: {} } })
const cp = await resume('t1', async (key) => `已发送（幂等键 ${key}）`)
console.log(cp?.status, cp?.step, cp?.messages[0].content) // running 4 已发送（幂等键 t1:3:c9）
```

## 面试官可能追问

::: details 流式输出到一半断了，怎么恢复？
模型调用中途断开，这一步还没产生检查点，直接重新调用模型即可。前端展示可以用续传机制接上，见 [流式连接断了，怎么续传](/engineering/streaming/10-resume)。不要试图把半截的模型输出拼回去，重新生成更可靠。
:::

::: details 恢复时要不要告诉模型"刚才中断过"？
一般不需要，模型只看到完整的消息历史。但如果环境被重建了，比如沙箱里的临时文件没了、浏览器重新打开了，要在消息里说明，否则模型会基于已经不存在的状态继续操作。
:::

::: details 能不能用检查点回到某一步，换个方向重来？
可以，这就是保留历史快照的好处：从第 5 步的状态复制出一个新分支，修改指令后继续。调试 Agent 时很有用。但已经执行过的外部副作用不会因为分支而撤销，回到过去只是回到上下文的过去。
:::

## 易错点

- 只保存消息历史，步数和预算没保存，恢复后从零计数，限制形同虚设
- 恢复时重新执行最后一步的工具调用，没有幂等保护
- 事件日志重放时又真的调用了模型，结果和原来不一样，状态就对不上了
- 以为回滚检查点就能撤销已经发出的邮件、已经执行的转账
