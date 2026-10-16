---
difficulty: 2
tags: [场景题, 实践]
---

# 模型可能重复调用写操作工具，怎么保证幂等？

::: tip 一句话回答
重复调用很常见：网络超时后的**自动重试**、模型**忘了已经做过**又调一次、Agent **崩溃后从断点恢复**时重放了上一步。只靠提示词"不要重复调用"不可靠，要在工具这一层保证：给每次写操作一个**幂等键**，同一个键只执行一次，重复请求直接返回第一次的结果；写操作前**先查当前状态**；有业务唯一约束的（如订单号）交给数据库保证；高风险操作拆成**"创建草稿 + 确认提交"**两步。
:::

## 详细解析

### 重复从哪来

| 来源 | 例子 |
| --- | --- |
| 传输层重试 | 调用下游接口超时，其实已经成功了，重试又执行一遍 |
| 模型重复 | 上下文很长，模型没注意到已经发过邮件，又发一次；或者结果不明确，模型以为失败了 |
| 恢复重放 | 进程在"工具执行完、结果还没保存"时崩溃，恢复后重新执行这一步，见 [Agent 的状态持久化和断点恢复](/ai/agent/14-durable-agent) |
| 并行调用 | 一次回复里发起了两个几乎一样的调用 |

读操作重复只是浪费，写操作重复就是事故：重复扣款、重复发通知、建出两张工单。

### 幂等键

思路和支付接口一样：每次写操作带一个唯一的键，服务端记录"键 → 结果"，同一个键第二次到达时不再执行，直接返回之前的结果。

幂等键由谁生成很关键：

- **不要让模型生成**，模型可能每次给出不同的值，也可能复用同一个值
- 由执行层生成，比如用 `任务 ID + 步骤序号 + 工具调用 ID` 组合。同一步重放时键不变，能去重；不同步骤的键不同，不会误拦。但同一次回复里两个几乎一样的并行调用，调用 ID 不同、键也不同，这种重复要靠下面的"先查状态"或业务唯一约束来挡
- 下游接口支持幂等键的（不少支付和消息服务支持），直接透传下去

### 其他配套手段

- **先查后写**：创建工单前先按标题和客户查一下有没有刚建过的；状态已经是"已退款"就不再退
- **数据库唯一约束**：业务上本来就唯一的东西（订单号、外部事件 ID），用唯一索引兜底
- **设计成天然幂等**：`set_status(id, "closed")` 执行多次结果一样；`increment_count(id)` 就不行，尽量用前者的形式
- **两段式**：`create_draft` 可以随便调，只有 `confirm_send(draft_id)` 才真正生效，且同一个草稿只能确认一次。这也方便插入人工确认
- **返回明确的结果**：工具返回"已发送，消息 ID 为 m_123"，而不是一个空字符串，模型才不会以为失败了再试

## 代码示例

```ts
type Result = { ok: true; data: unknown } | { ok: false; error: string }

// 简化版：生产环境用数据库或 Redis 存，并给记录加过期时间
const done = new Map<string, Result>()
const running = new Map<string, Promise<Result>>()

async function runIdempotent(key: string, fn: () => Promise<Result>): Promise<Result> {
  const cached = done.get(key)
  if (cached) return cached // 已执行过，直接返回第一次的结果
  const inflight = running.get(key)
  if (inflight) return inflight // 正在执行，等同一个结果
  const p = fn().then((r) => {
    if (r.ok) done.set(key, r) // 只缓存成功的结果，失败允许重试
    running.delete(key)
    return r
  })
  running.set(key, p)
  return p
}

let sent = 0
const sendEmail = async (): Promise<Result> => ({ ok: true, data: { messageId: `m_${++sent}` } })
const key = 'task42:step3:call_abc' // 任务 ID + 步骤 + 工具调用 ID，由执行层生成
const [a, b] = await Promise.all([runIdempotent(key, sendEmail), runIdempotent(key, sendEmail)])
const c = await runIdempotent(key, sendEmail)
console.log(sent, a === b, b === c) // 1 true true
```

## 面试官可能追问

::: details 工具超时了，不知道成功没有，怎么办？
不要直接重试。先用同一个幂等键重试（下游支持幂等就安全），或者先调查询接口确认状态。确认不了就把"状态未知"如实告诉模型和用户，而不是假装失败让模型再做一遍。错误处理的其他情况见 [工具调用出错了怎么处理](/ai/tools/05-tool-errors)。
:::

::: details 模型确实需要做两次同样的操作呢？
比如给两个人各发一封内容相同的邮件。这时它们是不同的步骤或不同的调用 ID，幂等键自然不同，不会被拦。幂等键防的是"同一次意图被执行两次"，不是"同样的参数不能出现两次"。
:::

::: details 只缓存成功结果，失败了重试会不会也重复？
会有这个风险，所以要区分失败类型。参数错误、权限不足这类确定没执行的失败可以放心重试；超时、连接断开这类状态不确定的失败，要先确认状态再决定。
:::

## 易错点

- 让模型自己生成幂等键，或者只靠提示词提醒不要重复
- 用"工具名 + 参数"做去重键，会误拦掉合法的重复操作
- 超时就当失败处理，导致操作实际执行了两次
- 幂等记录存在进程内存里，进程重启后恢复执行时就失效了
