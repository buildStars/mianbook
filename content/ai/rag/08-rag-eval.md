---
difficulty: 2
tags: [高频, 实践]
---

# RAG 系统怎么评估？

::: tip 一句话回答
检索和生成要**分开评估**，才能知道问题出在哪一环。检索看正确的资料有没有被找到、排得是否靠前，常用**命中率（Hit Rate）**、**Recall@k** 和 **MRR**；生成看回答是否都有资料依据（**忠实度**）、是否切题（**答案相关性**）、和标准答案是否一致（**正确性**），通常用大模型按评分标准打分，RAGAS 等框架提供了现成的实现。评测集的每条样本要包含问题、标准答案和应该命中的文档。
:::

## 详细解析

### 评测集长什么样

```json
{
  "id": "plan-012",
  "question": "专业版最多能加多少个子账号？",
  "reference_answer": "专业版最多 20 个子账号，超出需要升级到企业版。",
  "relevant_docs": ["pricing/plans.md"],
  "evidence": ["专业版最多支持 20 个子账号"],
  "tags": ["套餐", "数字"]
}
```

- **relevant_docs 和 evidence**：标注应命中的文档 ID 和能回答问题的原文片段，而不是块 ID。块 ID 会随切分方式变化，换了切分策略标注就作废了；判断召回的块里是否包含证据原文，标注就能一直复用
- **无答案的问题**：放一部分知识库里确实没有答案的问题（relevant_docs 为空），检查系统会不会老实说"没有找到"
- **标签**：按主题和问题类型（事实、比较、多跳、多轮）打标签，分组统计

### 检索指标

对每个问题分别计算，再对所有问题取平均：

- **Hit Rate@k**：前 k 条里至少有一条相关结果，就算命中
- **Recall@k**：前 k 条覆盖了多少比例的相关文档。只有一个相关文档时，它和 Hit Rate@k 相同
- **MRR**：第一个相关结果排名的倒数（第 1 名得 1 分，第 2 名得 0.5 分，没找到得 0 分），衡量正确结果排得是否靠前

k 取实际放进上下文的条数（比如重排后的前 5 条）。同时看召回阶段的 Recall@50 这类指标，它是重排效果的上限。

### 生成指标

| 指标 | 衡量什么 | 需要什么 | 常见算法 |
| --- | --- | --- | --- |
| 忠实度 | 回答的内容是否都有资料依据 | 回答、检索到的上下文 | 把回答拆成若干条陈述，逐条判断能否从上下文推出；得分 = 有依据的陈述数 / 陈述总数 |
| 答案相关性 | 是否针对问题回答，有没有答非所问、绕圈子 | 问题、回答 | 让模型直接打分；RAGAS 的做法是根据回答反推几个问题，计算它们和原问题的 Embedding 相似度 |
| 正确性 | 关键事实和标准答案是否一致，有没有遗漏 | 回答、标准答案 | 模型按要点比对打分 |
| 上下文精确度 | 检索结果中相关的块是否排在前面 | 检索结果、标准答案 | 模型逐块判断是否相关，再按排名加权 |
| 上下文召回 | 标准答案里的事实能否在检索结果中找到依据 | 检索结果、标准答案 | 把标准答案拆成陈述，看有多少能在上下文中找到依据 |

后两个其实是检索指标，只是用模型来判断相关性，不需要逐条标注相关文档。用模型打分要注意它的偏差，并定期和人工标注对比（见 [LLM-as-a-Judge](/engineering/eval/02-llm-as-judge)）。

### 用指标定位问题

```text
Recall@k 低              → 检索问题：切分、Embedding、混合检索、查询改写
Recall@k 高、忠实度低     → 生成问题：Prompt 没要求基于资料回答，或上下文太长太乱
忠实度高、正确性低        → 资料本身过时或有误，或者检索到的是相近但不对的文档
无答案的问题没有拒答      → Prompt 没有允许回答"不知道"
```

完整的排查步骤见 [RAG 效果不好怎么排查](/ai/rag/10-troubleshooting)。

## 代码示例

按文档 ID 计算检索指标，无答案的问题不参与计算，单独统计拒答率：

```ts
interface EvalCase {
  question: string
  relevantDocs: string[] // 应命中的文档 ID，无答案的问题为空数组
}

type Retrieve = (question: string, k: number) => Promise<{ docId: string }[]>

async function evalRetrieval(cases: EvalCase[], retrieve: Retrieve, k = 5) {
  const answerable = cases.filter((c) => c.relevantDocs.length > 0)
  let hit = 0
  let recall = 0
  let mrr = 0
  for (const c of answerable) {
    const results = await retrieve(c.question, k) // 按相关性从高到低排序
    const relevant = new Set(c.relevantDocs)
    const firstRank = results.findIndex((r) => relevant.has(r.docId)) + 1 // 0 表示没命中
    const found = new Set(results.map((r) => r.docId).filter((id) => relevant.has(id)))
    if (firstRank > 0) {
      hit += 1
      mrr += 1 / firstRank
    }
    recall += found.size / relevant.size
  }
  const n = answerable.length
  return { [`hit@${k}`]: hit / n, [`recall@${k}`]: recall / n, [`mrr@${k}`]: mrr / n }
}
```

## 面试官可能追问

::: details 没有标注数据，怎么快速建一个 RAG 评测集？
从知识库中抽样片段，让模型根据片段生成问题和答案，这个片段就是应命中的证据；再人工审核，删掉不合理的、修正答案。合成的问题往往照搬原文的用词，检索起来比真实问题容易，分数会偏高，所以要人工改写一部分成口语化的问法，并尽快补充线上的真实问题（见 [评测集怎么构建](/engineering/eval/03-eval-dataset)）。
:::

::: details 忠实度高，是不是就说明回答对了？
不是。忠实度只说明回答有依据。资料本身过时或有错，或者检索到的是相似但不对的文档（比如旧版本的政策），回答依然"忠实"，但是错的，所以还要看正确性。反过来，模型用自己的知识答对了、但资料里没有，忠实度会低，在要求答案可追溯的场景里这同样是问题。
:::

::: details 评测应该什么时候跑？
改动切分、Embedding 模型、检索参数、Prompt 或生成模型时，都完整跑一遍，并和上一版逐条对比，最好接入 CI（见 [回归测试](/engineering/eval/05-regression-testing)）。上线后再对线上流量定期抽样，用模型评估忠实度和相关性，发现评测集没覆盖到的问题。
:::

## 易错点

- 只看最终回答的分数，不分开看检索和生成，发现问题也不知道该改哪一环
- 用块 ID 标注相关性，换了切分方式标注就作废
- k 和实际放进上下文的条数不一致，Recall@50 再高也说明不了最终效果
- 评测集里没有无答案的问题，测不出系统会不会"不知道就说不知道"
