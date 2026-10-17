---
difficulty: 2
tags: [实践, 新技术]
---

# 工具调用的过程怎么在前端展示？什么是生成式 UI？

::: tip 一句话回答
前端把一条 AI 回复看成由多个**片段**组成：文字片段、工具调用片段。每个工具调用片段有自己的**状态**（生成参数中、执行中、成功、失败、待确认），按状态显示不同的样式，参数和结果可以折叠查看。**生成式 UI** 是把工具结果映射成组件来渲染，比如天气工具返回数据就显示一张天气卡片，而不是一段文字，模型决定调哪个工具，前端决定长什么样。
:::

## 详细解析

### 消息的数据结构

传统聊天消息只有一段文本。带工具调用的消息要拆成有序的片段列表：

```text
assistant 消息
├─ text      "我帮你查一下订单"
├─ tool_call get_order_progress  状态: 成功  参数 {...}  结果 {...}
└─ text      "你的订单正在派送中，预计今天送达"
```

每个工具调用片段至少要有：调用 ID、工具名、参数、状态、结果或错误信息。调用 ID 用来把后到的执行结果对应回同一个片段。

### 状态和展示

| 状态 | 什么时候 | 前端展示 |
| --- | --- | --- |
| 生成参数中 | 模型正在流式输出参数 | 显示工具名和"准备中"，参数可以逐步显示 |
| 待确认 | 写操作，需要用户同意 | 确认卡片，列出关键参数和"确认 / 取消"按钮 |
| 执行中 | 参数完整，后端在执行 | 加载动画，用友好的文字描述，比如"正在查询订单" |
| 成功 | 拿到结果 | 折叠成一行摘要，点开看参数和结果 |
| 失败 | 执行报错或超时 | 显示失败原因，模型通常会接着处理或换方式 |

几个细节：

- 工具名对用户不友好，前端维护一张"工具名 → 中文描述"的映射
- 参数和原始结果默认折叠，普通用户不需要看，排查问题时有用
- 多个并行调用分别显示，各自更新状态，见 [并行工具调用](/ai/tools/04-parallel-calls)

### 需要确认的操作卡片

发邮件、下单、删除这类操作，后端暂停执行，推送一个"待确认"事件。前端渲染确认卡片：

- 卡片里展示的是**模型实际要提交的参数**，而不是模型的自然语言描述，避免"说的和做的不一样"
- 用户点确认后，前端把确认结果发回后端，后端再执行
- 用户可以修改参数再确认，修改后的参数要重新校验

暂停和恢复流程的设计见 [人在回路](/ai/agent/11-human-in-the-loop)。

### 流式的增量展示

模型流式输出时，工具调用的参数是一段一段 JSON 片段到达的。前端按调用 ID 累加字符串，参数完整前可以只显示工具名，或者用容错解析显示已到达的部分。流式 JSON 的解析方法见 [流式结构化输出](/engineering/streaming/09-streaming-structured)。

下面用一个 reducer 把流式事件合并成片段列表，事件格式是简化后的通用形式，各家 SDK 的字段名不同：

```js
function reduce(parts, ev) {
  const next = parts.slice()
  const idx = next.findIndex((p) => p.type === 'tool' && p.id === ev.id)
  switch (ev.type) {
    case 'text': {
      const last = next[next.length - 1]
      if (last?.type === 'text') next[next.length - 1] = { ...last, text: last.text + ev.delta }
      else next.push({ type: 'text', text: ev.delta })
      break
    }
    case 'tool_start':
      next.push({ type: 'tool', id: ev.id, name: ev.name, argsText: '', status: 'streaming' })
      break
    case 'tool_args': // 参数是 JSON 片段，先拼字符串
      next[idx] = { ...next[idx], argsText: next[idx].argsText + ev.delta }
      break
    case 'tool_run':
      next[idx] = { ...next[idx], args: JSON.parse(next[idx].argsText), status: 'running' }
      break
    case 'tool_result':
      next[idx] = { ...next[idx], status: ev.error ? 'error' : 'done', result: ev.result, error: ev.error }
      break
  }
  return next
}

const events = [
  { type: 'text', delta: '我帮你' },
  { type: 'text', delta: '查一下。' },
  { type: 'tool_start', id: 'c1', name: 'get_weather' },
  { type: 'tool_args', id: 'c1', delta: '{"city":' },
  { type: 'tool_args', id: 'c1', delta: '"杭州"}' },
  { type: 'tool_run', id: 'c1' },
  { type: 'tool_result', id: 'c1', result: { temp: 22, sky: '多云' } },
]
const parts = events.reduce(reduce, [])
console.log(parts.map((p) => (p.type === 'text' ? p.text : `${p.name} ${p.status} ${JSON.stringify(p.args)}`)))
// [ '我帮你查一下。', 'get_weather done {"city":"杭州"}' ]
```

### 生成式 UI

生成式 UI 的核心是一张"工具 → 组件"的映射表：

1. 后端定义工具，工具返回结构化数据
2. 前端为每个工具注册一个组件，比如 `get_weather` 对应天气卡片、`search_flights` 对应航班列表
3. 渲染工具调用片段时，成功状态用对应组件渲染结果，没注册组件的工具退回默认的折叠视图

有的框架支持服务端直接流式返回组件，但常见、也更安全的做法是：**模型只产出数据，组件由前端预先写好**。不要让模型生成任意 HTML 或脚本直接渲染，那是 XSS 风险，见 [输出渲染安全](/engineering/security/05-output-rendering)。

## 面试官可能追问

::: details 工具结果卡片里的按钮，点了之后怎么和模型交互？
两种方式：按钮直接调前端或后端接口完成操作，再把结果作为一条消息告诉模型；或者按钮生成一条用户消息发给模型，比如"预订第 2 个航班"，让模型继续走工具调用。涉及写操作时，第一种更可控。
:::

::: details 刷新页面后，工具调用的展示怎么恢复？
消息要把片段列表完整存到后端，包括工具调用的参数、状态和结果。加载历史时按片段重新渲染。待确认状态也要持久化，否则刷新后用户就找不到确认按钮了。
:::

::: details 工具执行很慢，前端怎么处理？
先显示执行中的状态和友好的描述；长任务可以让后端推送进度事件；超过一定时间给出"仍在处理"的提示。真的超时要显示失败，并告诉模型，让它给用户一个说法。
:::

## 易错点

- 确认卡片里只显示模型的文字描述，不显示实际参数，用户确认的和执行的可能不一致
- 参数没到齐就 `JSON.parse`，流式过程中直接报错
- 让模型生成 HTML 直接插入页面，这不是生成式 UI，而是 XSS 漏洞
