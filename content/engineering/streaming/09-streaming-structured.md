---
difficulty: 3
tags: [原理, 实践]
---

# 流式输出中的工具调用和 JSON 怎么增量解析？

::: tip 一句话回答
流式模式下，工具调用的参数是一个 JSON 字符串，被拆成很多**片段**陆续到达，单独的片段不是合法的 JSON。要按工具调用的 **index** 把片段拼接起来，等调用结束后再 `JSON.parse` 并校验。一次返回多个并行调用时，不同调用的片段可能交替到达，所以必须按 index 分别累积。如果想边生成边展示 JSON 的内容，可以用**容错的部分 JSON 解析**补全未闭合的引号和括号，但解析出的值只能用于展示，结束后还要严格解析和校验。
:::

## 详细解析

### 工具调用的片段长什么样

以 OpenAI 兼容的 Chat Completions 接口为例，一次工具调用在流里大致是这样的（每行是一块数据里的 delta，省略了无关字段）：

```text
{"tool_calls":[{"index":0,"id":"call_a1","type":"function","function":{"name":"get_weather","arguments":""}}]}
{"tool_calls":[{"index":0,"function":{"arguments":"{\"ci"}}]}
{"tool_calls":[{"index":0,"function":{"arguments":"ty\": \"北京\"}"}}]}
最后一块的 finish_reason 为 "tool_calls"
```

- 第一个片段带 `id` 和函数名，`arguments` 是空字符串
- 后面的片段只有 `index` 和一段 `arguments`，从哪里切开没有规律，可能切在键名中间
- `index` 是区分不同调用的依据，后面的片段里不再带 `id`

不同厂商的字段不同，思路一样：

| | OpenAI 兼容格式 | Anthropic Messages API |
| --- | --- | --- |
| 区分不同调用 | `tool_calls` 里的 `index` | 内容块的 `index` |
| 调用开始 | 第一个片段带 `id` 和函数名 | `content_block_start` 事件，块类型为 `tool_use` |
| 参数片段 | `function.arguments` | `input_json_delta` 里的 `partial_json` |
| 结束信号 | `finish_reason` 为 `tool_calls` | 每个块各有一个 `content_block_stop`，整条消息的 `stop_reason` 为 `tool_use` |

### 拼接和解析

1. 按 index 建立累积对象，记录 id、函数名和参数字符串
2. 每来一个片段，找到对应 index 的对象，把参数片段追加上去
3. 收到结束信号后，逐个 `JSON.parse` 并按 Schema 校验。解析失败的，把错误作为工具结果回传，让模型修正（见[工具调用出错了怎么处理](/ai/tools/05-tool-errors)）
4. 函数名一到，界面上就可以显示"正在查询天气"，不用等参数拼完

多个调用的并发执行和结果回传，见[并行工具调用](/ai/tools/04-parallel-calls)。

### 边生成边展示 JSON

结构化输出（见[怎么让大模型稳定地输出 JSON](/ai/prompt/04-structured-output)）的内容本身就是一段 JSON 文本。想在生成过程中就展示已经出来的字段，有两种思路：

- **容错解析**：对当前拼到的文本做补全后再解析：补上未闭合的字符串引号和括号，去掉末尾不完整的键或值。可以用现成的部分 JSON 解析库，各个库的接口不同
- **换一种格式**：列表类的数据让模型输出 JSON Lines，一行一个完整的对象，读到换行就能解析一条，天然适合流式

部分解析得到的值是不完整的：字符串可能只有一半，数字 `12` 之后可能变成 `120`。这些值只能用来展示，不能据此执行任何操作。

## 代码示例

```js
// 以 OpenAI 兼容格式为例：按 index 累积工具调用。chunks 是解析好的数据块
async function collectStream(chunks, { onText, onToolStart }) {
  const calls = [] // 下标就是 index
  let text = ''
  for await (const chunk of chunks) {
    const delta = chunk.choices?.[0]?.delta
    if (!delta) continue // 比如最后只带 usage 的数据块
    if (delta.content) {
      text += delta.content
      onText(delta.content)
    }
    for (const part of delta.tool_calls ?? []) {
      const call = (calls[part.index] ??= { id: '', name: '', arguments: '' })
      if (part.id) call.id = part.id
      if (part.function?.name) {
        call.name = part.function.name
        onToolStart(call.name) // 界面上先显示"正在调用 xxx"
      }
      if (part.function?.arguments) call.arguments += part.function.arguments
    }
  }

  // 流结束后再解析：单独的片段都不是合法的 JSON
  const toolCalls = calls.filter(Boolean).map((call) => {
    try {
      return { ...call, args: JSON.parse(call.arguments || '{}') }
    } catch {
      return { ...call, error: '参数不是合法的 JSON' } // 回传给模型，让它重新生成
    }
  })
  return { text, toolCalls }
}
```

展示部分 JSON 的通用写法（`parsePartialJson` 代表容错解析，具体用哪个库自己选）：

```js
let raw = ''
for await (const piece of contentStream) {
  raw += piece
  const partial = parsePartialJson(raw) // 补全后解析，失败返回 undefined
  if (partial) renderPreview(partial) // 只用于展示，渲染要节流
}
const result = ResultSchema.parse(JSON.parse(raw)) // 结束后严格解析，再用 zod 校验
```

## 面试官可能追问

::: details 为什么不在每个片段到达时都 JSON.parse 一下？
片段的切分点是任意的，拼到一半的字符串绝大多数时候都不是合法的 JSON，`JSON.parse` 会直接抛错；每次都对全文重新解析，参数很长时也是平方级的开销。执行工具必须拿到完整的参数，所以等结束信号再解析；只有展示的需求才需要容错解析，而且要节流。
:::

::: details 模型一边输出文字一边调用工具，界面怎么展示？
同一次回复里可能先有一段文字（比如"我帮你查一下"），后面跟着工具调用。文字照常流式展示；收到函数名时插入一个"正在查询"的状态块；工具执行完，把结果回传给模型，开始下一轮请求，新的文字接着追加在后面。所以前端的一条消息要能按顺序容纳多个片段（文字、工具调用、工具结果），而不是只有一个文本字段。
:::

::: details 参数拼完、解析成功，就可以直接执行了吗？
不可以。解析成功只说明格式是合法的 JSON，参数仍然可能缺字段、类型不对、取值越界，甚至是模型编造的。要先按 Schema 校验，写操作还要检查权限，必要时让用户确认（见 [Function Calling 的完整流程](/ai/tools/01-function-calling)）。
:::

## 易错点

- 按"当前正在拼的那个调用"累积，而不是按 index，并行调用的片段交替到达时，参数会串在一起
- 以为每个片段都带 id，用 id 去找对应的调用
- 结束信号还没到就开始执行工具
- 把部分解析出的值当成最终结果使用
