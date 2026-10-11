---
difficulty: 2
tags: [实践, 场景题]
---

# 多轮对话的上下文怎么管理？

::: tip 一句话回答
大模型接口是**无状态**的，多轮对话靠应用每轮把历史消息一起发过去，所以对话越长，token 成本和延迟越高，最终会超出上下文窗口。常用策略：**保留最近几轮原文**（滑动窗口），**更早的内容压缩成摘要**，**把关键事实抽取成记忆、按需检索**。截断要按 token 计数，并且不能把工具调用和它的结果拆开；摘要会丢细节，重要信息要单独保存。
:::

## 详细解析

### 为什么要管理

- 服务端不记得上一次请求，每轮的输入都是"系统提示 + 全部历史 + 新消息"。有的平台提供在服务端保存会话的功能，但历史消息仍然作为输入计费
- 第 n 轮要重发前面的所有轮次，累计 token 数随轮数近似平方增长
- 历史太长时，早期无关的话题会干扰当前的回答，最终还会超出上下文窗口，见 [上下文窗口](/ai/llm/04-context-window)

### 几种策略

| 策略 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| 全量保留 | 每轮带上全部历史 | 信息完整 | 成本越来越高，最终超出窗口 |
| 滑动窗口 | 只保留最近 N 轮或最近 N 个 token | 简单，成本可控 | 早期信息直接丢失，比如用户一开始说明的需求 |
| 摘要 | 挤出窗口的部分由模型总结成摘要，放在历史前面 | 保留早期要点 | 丢细节；生成摘要有额外成本；摘要本身可能出错 |
| 记忆检索 | 抽取关键事实（偏好、约定、结论）存入数据库或向量库，每轮按相关性检索 | 能跨会话长期保存 | 实现复杂，抽取和检索都可能出错 |

实际中常组合使用：系统提示 + 检索到的记忆 + 早期对话的摘要 + 最近几轮原文。跨会话的长期记忆见 [Agent 的记忆系统](/ai/agent/04-memory)。

### 截断和摘要的细节

1. **按 token 计数**，而不是按消息条数：用户贴一大段代码，一条消息就可能占满预算
2. **按"轮"整体保留或丢弃**：工具调用和对应的工具结果必须同时保留或同时删除，否则很多接口会因为找不到对应的调用而报错；截断后的开头也不能是孤立的工具结果
3. **System Prompt 始终保留**
4. **摘要要写清保留什么**：用户的目标和约束、已确认的事实（名称、数字、决定）、未解决的问题，并要求不添加对话中没有的信息
5. **增量更新摘要**：只把新挤出窗口的消息并入已有的摘要，不要每次从头总结；可以在回复用户之后异步生成，不阻塞当前请求
6. **区分展示和上下文**：数据库里保存完整的历史用于展示，发给模型的是压缩后的版本

## 代码示例

滑动窗口 + 摘要（`llm.chat`、`countTokens` 是通用伪接口）：

```ts
interface Msg {
  role: 'user' | 'assistant' | 'tool' // 有的 SDK 把工具结果放在 user 消息里，分组时按实际结构判断
  content: string
}

interface Conversation {
  history: Msg[] // 完整历史（已包含本轮的用户消息），存数据库，用于展示
  summary: string // 早期对话的摘要
  summarizedCount: number // history 中已经并入摘要的消息条数
}

const RECENT_BUDGET = 8000 // 最近几轮原文的 token 预算（假设值）

// 按"轮"分组：一条用户消息，加上之后的助手回复、工具调用和工具结果
function groupByTurn(messages: Msg[]): Msg[][] {
  const turns: Msg[][] = []
  for (const m of messages) {
    if (m.role === 'user' || turns.length === 0) turns.push([m])
    else turns[turns.length - 1].push(m)
  }
  return turns
}

async function buildContext(conv: Conversation, system: string) {
  const turns = groupByTurn(conv.history.slice(conv.summarizedCount))
  const cost = (turn: Msg[]) => turn.reduce((sum, m) => sum + countTokens(m.content), 0)

  // 从最新一轮往前保留，超出预算就停下（最新一轮无论多长都保留）
  let keepFrom = turns.length - 1
  let used = cost(turns[keepFrom])
  while (keepFrom > 0 && used + cost(turns[keepFrom - 1]) <= RECENT_BUDGET) {
    keepFrom--
    used += cost(turns[keepFrom])
  }

  // 被挤出窗口的轮次并入摘要（为了简单这里同步执行，生产中可以在回复用户之后异步更新）
  const evicted = turns.slice(0, keepFrom).flat()
  if (evicted.length > 0) {
    conv.summary = await summarize(conv.summary, evicted)
    conv.summarizedCount += evicted.length
  }

  const summaryBlock = conv.summary ? `\n\n<earlier_conversation_summary>\n${conv.summary}\n</earlier_conversation_summary>` : ''
  return [{ role: 'system', content: system + summaryBlock }, ...turns.slice(keepFrom).flat()]
}

async function summarize(previous: string, messages: Msg[]) {
  const transcript = messages.map((m) => `${m.role}: ${m.content}`).join('\n')
  const res = await llm.chat({
    messages: [
      {
        role: 'user',
        content: `更新对话摘要。保留用户的目标和约束、已确认的事实（名称、数字、决定）和未解决的问题，不要添加对话中没有的信息。\n\n<previous_summary>\n${previous}\n</previous_summary>\n\n<new_messages>\n${transcript}\n</new_messages>`,
      },
    ],
  })
  return res.content
}
```

## 面试官可能追问

::: details 用户说"回到最开始讨论的那个方案"，可那部分已经被截掉了，怎么办？
摘要里应该保留关键的决定，这是第一道保障。完整的历史还在数据库里，可以把历史消息也建成索引，按用户的描述检索出原文，再放回上下文。重要的结论也可以在当时就抽取成结构化的记忆。
:::

::: details 摘要应该放在 System Prompt 里，还是作为一条单独的消息？
两种都常见，关键是标明这是"之前对话的摘要"，而不是新的指令。考虑到提示缓存，摘要要放在固定的系统指令之后，这样摘要更新时，前面不变的部分仍然能命中缓存。
:::

::: details 滑动窗口和提示缓存有什么冲突？
提示缓存要求前缀完全相同。如果每轮都丢掉最早的一轮，前缀每次都在变，缓存几乎命中不了。可以改成"攒够一定量再一次性压缩"：大多数轮次只在末尾追加消息，前缀保持不变，只有压缩的那一轮缓存失效，见 [Prompt Caching](/engineering/deploy/04-prompt-caching)。
:::

::: details 用户上传的大文件，在后续轮次里怎么处理？
原文只在用到它的那一轮完整放入。之后的轮次替换成文件摘要和引用，需要细节时再按问题从文件中检索相关片段（相当于会话级的 RAG），不要每轮都带着全文。
:::

## 易错点

- 按消息条数截断，一条超长的消息就能撑爆窗口
- 把工具调用和工具结果拆开，接口直接报错
- 摘要里混入了模型编造的内容，之后被当成事实
- 把给用户看的完整历史和发给模型的上下文混为一谈
