---
difficulty: 2
tags: [场景题, 实践]
---

# 后台运行的 Agent 怎么设计？定时、事件触发和结果通知怎么做？

::: tip 一句话回答
后台 Agent 没有人在旁边盯着，所以设计重点从"对话"变成了"任务系统"：**触发**可以是定时（cron）、事件（webhook、消息队列、仓库事件）或用户提交后异步执行；**授权**要事先划定工具范围，写操作**先出草稿或进待审核队列**，不能指望临时弹窗问人；**运行**要有并发上限、单次预算和超时，对重复事件**去重**；**交付**靠通知、可追溯的运行记录、失败告警和一键重跑。
:::

## 详细解析

### 整体结构

```text
触发源                     调度层                       执行层                    交付
cron ─────────┐                                                               ┌─ IM / 邮件通知
webhook ──────┼──> 事件入库 + 去重 ──> 任务队列 ──> Worker 跑 Agent 循环 ──>──┼─ PR 评论 / 工单
消息队列 ─────┤      (幂等键)         (并发上限)    (预算 / 超时 / 权限)      ├─ 运行记录
用户提交 ─────┘                                                               └─ 失败告警
```

它本质上是一个异步任务系统，Agent 循环只是 Worker 里执行的那部分。

### 触发方式

- **定时**：每天早上汇总告警、每周整理依赖升级。注意时区和"上一次还没跑完下一次又到了"的情况，通常选择跳过或排队，不并发跑同一个任务
- **事件**：代码仓库的 issue 被打上某个标签、CI 失败、工单创建、监控告警。webhook 要校验签名，收到后快速返回，把事件放进队列再慢慢处理，不在请求里同步跑 Agent
- **用户提交后异步执行**：用户在界面上发起一个耗时任务，立即返回任务 ID，完成后通知。和同步对话相比，用户可以关掉页面

### 没人盯着时怎么授权

同步场景里遇到敏感操作可以停下来问用户，见 [人在回路怎么设计](/ai/agent/11-human-in-the-loop)。后台场景没人可问，要换思路：

1. **事先授权**：每类任务在配置里写明能用哪些工具、能访问哪些资源，用最小权限的专用凭证，而不是借用某个人的完整权限
2. **写操作降级成提案**：改代码就开分支提 PR，不直接合入；发邮件就存成草稿；改配置就生成变更单。真正生效要等人审核
3. **需要人决定时就暂停**：任务进入"等待审批"状态并发通知，人处理后再继续。暂停期间状态要持久化，见 [Agent 的状态怎么持久化](/ai/agent/14-durable-agent)
4. **不在运行中扩大权限**：工具调用被拒绝就记录下来，结束时报告，不提供"临时提权"的口子

权限规则本身怎么设计见 [Agent 的权限模式怎么设计](/engineering/harness/02-permission-modes)。

### 运行约束

- **并发上限**：全局和单个租户都要有，避免一次批量事件把模型配额和下游系统打满
- **单次预算和超时**：限制 token、工具调用次数和墙钟时间，超出就停下并标记为"超预算"，不要悄悄失败
- **去重**：webhook 会重发，定时任务可能被补跑。用"事件来源 + 事件 ID"或"任务类型 + 目标对象"做幂等键，已有运行中或已完成的就不再创建
- **隔离**：每次运行用独立的工作目录或沙箱，结束后清理

### 结果交付

- **通知**：结果发到用户已经在看的地方，例如 IM 消息、邮件、PR 评论。内容要短：做了什么、结论、需要谁处理什么，附上详情链接
- **运行记录**：保存触发原因、输入、每一步的工具调用、产出和耗费，出问题能回放，见 [Agent 怎么调试](/engineering/harness/05-agent-debugging)
- **失败告警和重跑**：失败要主动通知负责人，并提供带原参数的重跑入口；连续失败的任务自动暂停，避免反复消耗预算

## 代码示例

去重 + 排队 + 并发上限 + 单次超时的调度骨架：

```js
const runs = new Map() // 幂等键 -> 状态，排队中的也算，重发的事件不会再进队
const queue = []
let running = 0
const MAX_CONCURRENCY = 2

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('超时')), ms)),
  ])
}

function onEvent(event, agentTask) {
  const key = `${event.source}:${event.id}`
  if (runs.has(key)) return console.log(`重复事件 ${key}，跳过`)
  runs.set(key, 'queued')
  queue.push({ key, event, agentTask })
  drain()
  if (runs.get(key) === 'queued') console.log(`${key} 达到并发上限，排队`)
}

// 有空位就从队列里取，出队的任务直接执行，不再走去重判断
function drain() {
  while (running < MAX_CONCURRENCY && queue.length) run(queue.shift())
}

async function run({ key, event, agentTask }) {
  runs.set(key, 'running')
  running++
  try {
    const result = await withTimeout(agentTask(event), 1000)
    runs.set(key, 'done')
    console.log(`通知：${key} 完成，${result}`)
  } catch (err) {
    runs.set(key, 'failed')
    console.log(`告警：${key} 失败（${err.message}），可重跑`)
  } finally {
    running--
    drain()
  }
}

const fast = async () => '已生成 PR 草稿'
const slow = () => new Promise(r => setTimeout(() => r('不会到这里'), 2000))

onEvent({ source: 'github', id: 1 }, fast)
onEvent({ source: 'github', id: 1 }, fast) // webhook 重发
onEvent({ source: 'github', id: 2 }, slow)
onEvent({ source: 'github', id: 3 }, fast)
// 重复事件 github:1，跳过
// github:3 达到并发上限，排队
// 通知：github:1 完成，已生成 PR 草稿
// 通知：github:3 完成，已生成 PR 草稿
// 告警：github:2 失败（超时），可重跑
```

## 面试官可能追问

::: details 后台 Agent 和普通的定时任务有什么不同？
普通任务的步骤是写死的，结果可预期；Agent 每次走的路径可能不同，消耗也不固定。所以要额外加预算上限、完整的轨迹记录，以及写操作的审核环节。
:::

::: details 事件处理到一半服务重启了怎么办？
事件先持久化再确认接收，任务状态存数据库。重启后扫描"运行中"但没有心跳的任务，从断点续跑或标记失败后重跑。重跑依赖工具调用本身是幂等的，见 [工具调用怎么做到幂等](/ai/tools/15-idempotent-tools)。
:::

::: details 通知太多被大家屏蔽了怎么办？
只在需要人行动或者出现失败时打扰人，其余结果汇总成定期摘要；同一类结果合并发送；让用户能订阅或退订某类任务的通知。
:::

## 易错点

- 在 webhook 请求里同步跑完整的 Agent，导致超时，触发方重发，又跑一遍
- 沿用同步对话的思路，运行中弹出确认请求，结果没人响应，任务一直挂着
- 没有去重，同一个 issue 被处理两次，提了两个重复的 PR
- 失败只写日志不告警，几天后才发现任务一直没成功过
