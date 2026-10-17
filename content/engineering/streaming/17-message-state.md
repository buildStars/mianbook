---
difficulty: 2
tags: [实践, 场景题]
---

# 聊天界面的消息状态怎么管理？发送中、失败重试和乐观更新怎么做？

::: tip 一句话回答
给每条消息一个明确的**状态机**：用户消息是待发送、发送中、已发送、失败；助手消息是流式中、完成、失败、已停止，只允许合法的状态转换，迟到或重复的事件直接丢弃。发送时先用**客户端临时 ID** 把消息显示出来（乐观更新），服务端确认后换成正式 ID；失败就标红并提供重试，重试复用同一个临时 ID 作为**幂等键**，防止重复提交。切换会话时，进行中的流要么在后台继续写进原会话，要么中断，但事件必须按会话 ID 路由，不能写到当前打开的会话里。
:::

## 详细解析

### 消息状态机

```text
用户消息：  pending ──send──▶ sending ──ack──▶ sent
                               │  ▲
                             fail retry
                               ▼  │
                              failed

助手消息：  streaming ──finish──▶ done
               │  ├──stop──▶ stopped（保留已生成的内容）
               │  └──fail──▶ failed（可重新生成）
               └─delta─▶ streaming（追加内容）
```

用状态机而不是几个布尔值（`isSending`、`isError`），是因为布尔值组合会出现不可能的状态，比如"又在发送又失败"。状态机把合法转换写死，所有事件经过同一个入口，好处很直接：

- 停止之后迟到的 delta 不会再追加内容（中断流程见 [停止生成](/engineering/streaming/04-abort)）
- 网络抖动导致的重复确认不会把消息改两次
- 界面只根据状态渲染：发送中显示转圈，失败显示重试按钮，流式中显示光标

### 乐观更新和 ID 对齐

用户点发送后不要等服务端返回才显示消息，那样会有明显的卡顿。流程是：

1. 前端生成临时 ID（如 `crypto.randomUUID()`），消息以 `pending` 状态插入列表并立刻渲染
2. 请求里带上这个临时 ID
3. 服务端落库后返回正式 ID，前端用临时 ID 找到消息，写入正式 ID，状态改为 `sent`
4. 之后对这条消息的编辑、引用、重新生成都用正式 ID

列表渲染的 key 一直用临时 ID，不要换成正式 ID，否则组件会被销毁重建，出现闪烁、丢失输入焦点。助手回复也可以先插一条空的 `streaming` 占位，收到第一个 token 前显示"思考中"。

### 失败重试和防重复提交

失败分两类处理：发送失败（请求没到服务端或服务端拒绝）标红并给重试按钮；流式中途失败保留已收到的部分，提供"重新生成"。

重复提交的来源很多：双击发送、弱网下用户以为没发出去又点一次、自动重试。防法是：

- 发送中禁用发送按钮，但输入框可以继续输入下一条
- 重试**复用原来的临时 ID**，服务端用它做幂等键：同一个 ID 已处理过就直接返回原结果，不再插入新消息，也不再调一次模型
- 自动重试只针对明确的网络错误，并设上限；超过上限交给用户手动重试

### 切换会话时进行中的流

用户在一个会话流式输出时切到另一个会话，常见两种策略：

| 策略 | 做法 | 适合 |
| --- | --- | --- |
| 后台继续 | 流不中断，事件写进原会话的状态，切回来能看到完整结果 | 生成耗时长、用户经常并行看多个会话 |
| 切走即停 | 切换时中断请求，消息标记为已停止 | 想省成本，或者服务端不支持后台继续 |

无论哪种，流的每个事件都要带上会话 ID 和消息 ID，按 ID 更新对应的状态，而不是更新"当前会话"。很多串台的 bug 就是回调里引用了当前会话的变量。服务端如果支持断线续传，切回来时还能接上（见 [续传](/engineering/streaming/10-resume)）。同一页面多路流的调度见 [多路流](/engineering/streaming/11-multi-stream)。

### 状态放在哪一层

- 消息列表按会话 ID 分组，放在全局 store（如 Pinia、Redux），因为侧边栏、通知、多个组件都要读，切换会话也不能丢
- 正在进行的请求句柄（`AbortController`、读取器）放在 store 外的一个 Map 里，按消息 ID 索引，store 里只放可序列化的数据
- 输入框草稿、滚动位置这类纯界面状态留在组件里，或按会话 ID 存一份草稿

重新生成和分支的数据模型属于产品设计，见 [对话产品设计](/engineering/system-design/02-chat-product)。

## 代码示例：用 reducer 统一处理事件

```js
// 合法的状态转换，不在表里的事件直接忽略
const transitions = {
  pending: { send: 'sending' },
  sending: { ack: 'sent', fail: 'failed' },
  sent: {},
  failed: { retry: 'sending' },
  streaming: { delta: 'streaming', finish: 'done', fail: 'failed', stop: 'stopped' },
  done: {},
  stopped: {},
}

function reducer(messages, event) {
  const idx = messages.findIndex(m => m.clientId === event.clientId)
  if (event.type === 'add') return [...messages, event.message]
  if (idx === -1) return messages // 找不到消息（比如已切走的会话），丢弃
  const msg = messages[idx]
  const next = transitions[msg.status][event.type]
  if (!next) return messages // 非法转换：重复的 ack、停止后迟到的 delta 等
  const updated = { ...msg, status: next }
  if (event.type === 'ack') updated.id = event.serverId // 用服务端 ID 对齐
  if (event.type === 'delta') updated.content += event.text
  const copy = messages.slice()
  copy[idx] = updated
  return copy
}

let s = []
const dispatch = e => { s = reducer(s, e) }
// 乐观更新：先放进列表，再发请求
dispatch({ type: 'add', message: { clientId: 'c1', role: 'user', content: '你好', status: 'pending' } })
dispatch({ type: 'send', clientId: 'c1' })
dispatch({ type: 'fail', clientId: 'c1' })
dispatch({ type: 'retry', clientId: 'c1' })
dispatch({ type: 'ack', clientId: 'c1', serverId: 'm_101' })
dispatch({ type: 'ack', clientId: 'c1', serverId: 'm_102' }) // 重复确认被忽略
dispatch({ type: 'add', message: { clientId: 'a1', role: 'assistant', content: '', status: 'streaming' } })
dispatch({ type: 'delta', clientId: 'a1', text: '你好，' })
dispatch({ type: 'stop', clientId: 'a1' })
dispatch({ type: 'delta', clientId: 'a1', text: '迟到的内容' }) // 停止后的 delta 被忽略
console.log(s.map(m => `${m.role} ${m.id ?? '-'} ${m.status} ${m.content}`).join('\n'))
```

## 面试官可能追问

::: details 乐观更新的消息发送失败了，刷新页面后还在吗？
服务端没落库，刷新后就没了。如果要保留，可以把未确认的消息按会话 ID 存到本地存储，页面加载时恢复成失败状态，让用户决定重发还是删除。
:::

::: details 服务端返回的消息顺序和本地不一致怎么办？
排序以服务端为准，比如按服务端的创建时间或递增序号。本地的乐观消息先排在末尾，确认后按服务端顺序归位；同一会话的发送最好串行，避免两条消息并发落库后顺序颠倒。
:::

::: details 重新进入会话时，正在生成的消息怎么展示？
从服务端拉消息列表时，带上每条消息的状态。如果某条助手消息还在生成，就以流式中状态展示，并根据服务端能力续传或轮询；服务端已经中断的，显示为已停止或失败，给重新生成入口。
:::

## 易错点

- 列表 key 在确认后从临时 ID 换成正式 ID，导致组件重建、闪烁
- 重试时生成新的临时 ID，服务端无法去重，同一条消息出现两次、模型被调用两次
- 流式回调里引用"当前会话"，切换会话后内容写进了别的会话
- 用多个布尔值表示状态，出现"停止后还在追加内容"这类不可能的组合
