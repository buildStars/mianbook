---
difficulty: 2
tags: [场景题, 实践]
---

# 文档太长放不进上下文，怎么处理？

::: tip 一句话回答
先看任务类型。需要**通读全文**的任务（总结、提取所有条款）用分块处理：**Map-Reduce** 每块独立处理再汇总，可以并行；**Refine** 按顺序逐块更新结果，更连贯但只能串行；特别长的文档用**层级摘要**逐层合并。只问**局部问题**时，用检索取出相关片段（RAG）就够了。每块都要保留出处，方便引用和核对；文档能放进长上下文模型时，直接放进去往往实现最简单、效果也好，但成本和延迟更高。
:::

## 详细解析

### 先分清任务类型

- **全局任务**：总结全文、生成提纲、找出所有风险条款、对比各章节的观点，必须覆盖全文
- **局部任务**：某个条款怎么规定、某个数字是多少，只需要相关片段，用 RAG 即可，见 [RAG 的完整链路](/ai/rag/01-rag-pipeline)
- **两者都有**：文档上传后同时做两件事，生成目录和摘要，并建立检索索引支持问答，见 [超长文档的总结和问答服务](/engineering/system-design/07-document-processing)

### 三种分块处理方法

```text
Map-Reduce：
  切块：   [块1] [块2] [块3] … [块n]
  Map：    每块并行处理 → 结果1 结果2 结果3 … 结果n
  Reduce： 合并所有结果 → 最终结果（结果太多放不下时，先分组合并，再合并一层）

Refine：
  结果 = 处理(块1)
  结果 = 根据块2 更新(结果)
  ……
  结果 = 根据块n 更新(结果)

层级摘要：
  段落 → 小节摘要 → 章节摘要 → 全文摘要（按文档结构逐层向上合并）
```

加上检索和直接使用长上下文，几种做法的对比：

| 方法 | 优点 | 缺点 | 适合 |
| --- | --- | --- | --- |
| Map-Reduce | 可以并行，速度快；单块失败只需重试这一块 | 块之间的联系会丢失；汇总时信息被二次压缩 | 摘要、逐块抽取信息 |
| Refine | 能利用前文，结果连贯 | 只能串行，慢；前面的内容在多次更新后可能被冲淡 | 前后关联紧密的文档 |
| 层级摘要 | 符合文档结构，中间结果可以复用（如章节导读） | 依赖结构解析；层数多时误差会累积 | 书籍、手册、长篇报告 |
| 检索（RAG） | 成本低、延迟低 | 不适合需要全文的任务；检索不到就答不出 | 针对局部内容的问答 |
| 直接用长上下文 | 实现最简单，能看到全文的联系 | 成本高、首 token 慢；中间部分可能被忽略 | 文档在窗口内，需要跨段落推理 |

### 实践要点

- **按结构切块**：按章节、段落切，块之间保留少量重叠，每块带上标题路径，见 [文档怎么切分](/ai/rag/02-chunking)
- **Map 阶段的指令要具体**：写清要提取什么（如"列出这部分提到的所有付款条款，没有就输出空列表"），输出用统一的结构，Reduce 时才好合并和去重
- **保留出处**：每个 Map 结果带上块编号、页码或章节，最终结论标注来源，方便用户核对
- **控制并发、失败重试**：几百个块同时请求很容易触发限流，见 [限流、重试和降级](/engineering/deploy/08-rate-limit-fallback)
- **同一份文档要问很多问题**：如果能放进窗口，把文档放在固定的前缀里，利用 [Prompt Caching](/engineering/deploy/04-prompt-caching) 降低重复读取的成本

## 代码示例

Map-Reduce 总结（`llm.chat` 是通用伪接口，`splitIntoChunks` 按文档结构切块）：

```ts
async function summarizeLongDoc(doc: string): Promise<string> {
  const chunks = splitIntoChunks(doc, { maxTokens: 3000, overlap: 200 })

  // Map：每块单独提取要点，带上块编号，方便最后标注出处
  const partials = await mapWithLimit(chunks, 5, async (chunk, i) => {
    const res = await llm.chat({
      messages: [{
        role: 'user',
        content: `下面是一份长文档的第 ${i + 1}/${chunks.length} 部分。列出这部分的关键要点，每条一行，只写原文中有的信息。\n\n<chunk>\n${chunk}\n</chunk>`,
      }],
    })
    return `[第 ${i + 1} 部分]\n${res.content}`
  })

  // Reduce：合并要点。要点总量仍然放不下时，应先分组合并，再合并一层
  const res = await llm.chat({
    messages: [{
      role: 'user',
      content: `下面是一份文档各部分的要点。合并成一份完整的摘要：去掉重复，保留关键数据，按主题组织，每条结论后标注来自第几部分。\n\n${partials.join('\n\n')}`,
    }],
  })
  return res.content
}

// 限制并发数，避免触发限流
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>) {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
```

## 面试官可能追问

::: details 汇总时各部分的结果加起来还是太长，怎么办？
做多层 Reduce：把结果分组，每组先合并成一份中间结果，再合并这些中间结果，直到能放进一次调用。每一层都要保留出处标记，否则最后无法追溯。
:::

::: details 块与块之间有关联（前面定义、后面引用），分块处理会出问题吗？
会。比如合同在开头定义了"甲方"，后面的条款只写"甲方"。缓解方法：每块的 Prompt 里附上文档级的背景（标题、目录、术语定义）；块之间保留重叠；关联特别紧密的文档改用 Refine 或长上下文。
:::

::: details 怎么检查总结有没有遗漏重要内容？
Map 阶段明确要抽取的信息类型，结构化输出后在代码里汇总，不要全靠模型"自由总结"。还可以根据原文自动出一批问题，看摘要能不能回答，再结合人工抽查。
:::

::: details 处理一份几百页的文档要花多少钱、多长时间，怎么估算？
token：输入约等于全文（加上重叠部分和每次调用的指令），再加上 Reduce 阶段的输入；输出约等于块数乘以每块结果的长度。时间：块数除以并发数，乘以单次调用的耗时，再加上 Reduce 的耗时。单价按当前的官方价格代入，见 [一次调用的成本怎么估算](/engineering/deploy/02-cost-estimate)。
:::

## 易错点

- 用 RAG 做"总结全文"，只检索到少数片段，总结以偏概全
- Map 阶段的输出格式不统一，Reduce 时难以合并
- 丢了出处，最终的结论没法核对
- 不限制并发，大量请求同时发出，触发限流
