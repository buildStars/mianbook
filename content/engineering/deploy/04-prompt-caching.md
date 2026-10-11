---
difficulty: 2
tags: [原理, 性能优化]
---

# Prompt Caching 是什么？怎么组织 Prompt 才能命中缓存？

::: tip 一句话回答
模型处理输入时，要为每个 token 算出各层的 Key 和 Value（KV Cache）。Prompt Caching 是服务端把**相同前缀**已经算好的结果保存一段时间，下次请求的开头和它完全一样时直接复用、跳过这部分计算，所以命中的部分**更便宜**，**首 token 延迟也更低**。它只能匹配**从开头开始完全相同**的前缀，中间任何一处不同，后面的部分就全部失效。所以要把不变的内容（工具定义、系统指令、长文档、示例）放在前面，把变化的内容（用户问题、当前时间）放在最后。
:::

## 详细解析

### 为什么只能匹配前缀

模型是因果注意力：每个位置的计算结果（包括各层的 K、V）都依赖它前面所有的 token。第 i 个 token 变了，从第 i 个开始往后的结果全都要重算，只有前面没变的部分可以复用。所以缓存的匹配规则是"从第一个 token 开始的最长相同前缀"，原理见 [KV Cache 是什么](/ai/llm/08-kv-cache)。

### 怎么组织 Prompt

```text
从前到后（工具定义在接口里是单独的参数，但同样算在缓存的前缀里）：
[工具定义]            内容和顺序都固定            ← 稳定的内容在前
[系统指令、示例]       固定
[长文档]              同一个会话内固定
[历史消息]            只在末尾追加，不改动前面的
[当前时间、本轮问题]   每次都变                   ← 放在最后
```

常见的破坏缓存的写法：
- 在系统提示的开头插入当前时间、请求 ID 或用户名，每次请求从第一个 token 起就不一样
- 工具列表的顺序不固定，或者每次按意图挑选不同的工具子集
- 序列化 JSON 时键的顺序不稳定
- 多轮对话用滑动窗口，每轮从头部删掉最早的消息：历史部分的开头每轮都在变，最多只有前面的工具定义和系统提示还能命中，历史消息每轮都要重新计算。可以改成历史攒到一定长度后整体做一次摘要，之后的多轮又能连续命中
- 把每次都不同的检索结果放在系统提示里，后面的内容（包括历史消息）跟着全部失效

### 各家的差异

| 方面 | 说明 |
| --- | --- |
| 开启方式 | 有的自动缓存，前缀超过一定长度就会尝试命中；有的要在请求里显式标记缓存的位置。两种方式都有最小长度，太短的前缀不会被缓存 |
| 有效期 | 一般是分钟级，一段时间没有被使用就失效；有的可以付费延长 |
| 费用 | 命中的部分按折扣价计费；有的写入缓存要额外收费，只用一次的内容不值得标记 |
| 隔离 | 按组织隔离，有的还细分到工作区，不会跨客户共享 |
| 观测 | 响应的 usage 里会返回命中缓存的 token 数，字段名各家不同 |

自部署的推理框架也有同样的机制，例如 vLLM 的前缀缓存（见 [vLLM 这类推理框架为什么能提升吞吐](/engineering/deploy/06-inference-engines)）。

## 代码示例

```js
// 不好：开头就是每次都变的内容，后面的部分都命中不了
const bad = [
  { role: 'system', content: `当前时间：${new Date().toISOString()}\n用户：${user.name}\n${RULES}` },
  ...history,
  { role: 'user', content: question },
]

// 好：不变的放前面，变化的放最后
const good = [
  { role: 'system', content: RULES }, // 固定的规则和示例
  ...history, // 只在末尾追加，不修改前面的消息
  { role: 'user', content: `当前时间：${now}\n${question}` }, // 每次都变的信息放在最后
]
```

需要显式标记的接口，以 Anthropic 的 Messages API 为例，在内容块上加 `cache_control`，从开头到这个块（包括它）的内容会被缓存：

```js
const body = {
  model: MODEL,
  max_tokens: 1024,
  system: [
    { type: 'text', text: RULES },
    { type: 'text', text: LONG_DOCUMENT, cache_control: { type: 'ephemeral' } }, // 缓存到这里为止
  ],
  messages: [{ role: 'user', content: question }],
}
```

## 面试官可能追问

::: details Prompt Caching 和语义缓存有什么区别？
Prompt Caching 只复用输入前缀的计算结果，模型仍然会针对这次的问题生成新的回答，不影响回答的质量。语义缓存是直接返回之前的答案，完全不调用模型，省得更多，但可能把相似的问题当成相同的问题，答非所问（见[语义缓存是什么](/engineering/deploy/10-semantic-cache)）。
:::

::: details 怎么知道缓存有没有命中？
看响应里的 usage。例如 OpenAI 的 Chat Completions 接口在 `usage.prompt_tokens_details.cached_tokens` 里返回命中的 token 数（Responses 接口是 `usage.input_tokens_details.cached_tokens`），它包含在总输入 token 数里；Anthropic 分别返回读取缓存的 `cache_read_input_tokens` 和写入缓存的 `cache_creation_input_tokens`，而它的 `input_tokens` 不含这两部分，算总输入要三项相加。把命中率作为监控指标，调整 Prompt 结构前后做对比。
:::

::: details 什么场景收益最大？
前缀长、重复调用多的场景：带长系统提示和大量工具定义的 Agent（每一步都重复发送同样的前缀）、针对同一份长文档的多次问答、多轮对话。前缀很短，或者每次请求的开头都不同时，基本没有收益。
:::

## 易错点

- 以为内容"大致相同"就能命中，实际要求从开头开始逐个 token 完全相同
- 把时间戳、用户名放在系统提示的开头
- 以为缓存会一直存在：有效期很短，低频的调用基本命中不了
- 以为命中缓存会改变输出：它只是省掉了重复的计算
