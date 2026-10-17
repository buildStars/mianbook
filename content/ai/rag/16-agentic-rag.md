---
difficulty: 3
tags: [原理, 新技术]
---

# Agentic RAG 是什么？检索结果不好时怎么让模型自己改写查询、重新检索？

::: tip 一句话回答
普通 RAG 是**固定流水线**：问题进来检索一次，拿到什么就用什么生成。Agentic RAG 把检索交给模型来**决策**：要不要检索、检索什么、去哪个库检索、**结果够不够**。不够就改写查询、换数据源或者拆成下一跳问题再检索，形成"检索 → 评估 → 改写 → 再检索"的闭环。Self-RAG、CRAG 都是这个思路。代价是延迟和成本上升，所以一定要有**最大轮数、token 预算和明确的停止条件**。
:::

## 详细解析

### 固定流水线的局限

[标准 RAG 链路](/ai/rag/01-rag-pipeline)只检索一次，有几类问题处理不好：

- **一次检索不到**：用户的说法和文档用词差异大，第一次召回的全是无关内容，模型只能硬编
- **多跳问题**："A 项目负责人所在部门今年的预算是多少"，要先查到负责人，再查部门，再查预算，第二步的查询依赖第一步的结果
- **不需要检索的问题**：寒暄、简单计算也去检索一遍，浪费时间还可能被无关片段干扰
- **数据源不止一个**：有的该查文档库，有的该查数据库或网页

### 核心闭环

```text
问题
 ├─ 判断：需要检索吗？ ── 否 ──> 直接回答
 └─ 是
     └─> 生成查询 -> 检索 -> 评估结果
                              ├─ 足够 ──> 基于资料生成答案
                              ├─ 部分相关 ──> 保留有用片段，补查缺失信息（多跳）
                              └─ 不相关 ──> 改写查询 / 换数据源，再检索
                                            （达到最大轮数则如实说明查不到）
```

具体的改写方法（指代补全、多查询、HyDE、子问题拆分）见[查询改写](/ai/rag/07-query-rewrite)，这里关注的是**谁来判断、何时重试、何时停止**。

### 两种代表性思路

| 方案 | 做法 | 特点 |
| --- | --- | --- |
| Self-RAG | 训练模型输出特殊的反思标记：是否需要检索、片段是否相关、答案是否被资料支持 | 判断能力内化在模型里，需要专门训练 |
| CRAG（纠正式 RAG） | 用一个轻量评估器给检索结果打分：正确则精炼使用；错误则丢弃并改用其他检索（如网页搜索）；不确定则两者结合 | 不改生成模型，评估器可单独替换 |

工程上更常见的是用通用模型加提示词实现：把检索做成工具，让 Agent 自己决定调几次，或者在流水线里插一个"相关性评估"节点。

### 评估"够不够"

- **相关性打分**：对每个片段判断是否和问题相关，可以用[重排模型](/ai/rag/06-rerank)的分数加阈值，也可以让小模型判断
- **覆盖度检查**：让模型列出回答所需的信息点，逐条看资料里有没有
- **答案支持度**：生成后检查每个论断是否有片段支撑，不支持就补查或删掉

评估本身要便宜，否则每轮都多一次大模型调用。

### 控制延迟和成本

- 设最大检索轮数，常见是两三轮；到上限就基于已有资料回答，并说明哪些没查到
- 简单问题走快速路径：先做一次普通检索，分数高就直接生成，只有分数低时才进入闭环
- 改写时记住已经试过的查询，避免换汤不换药的重复检索
- 多跳中互不依赖的子问题并行检索

## 代码示例

```ts
type Chunk = { id: string; text: string; score: number }
type Judge = 'enough' | 'partial' | 'irrelevant'

// 依赖注入：检索、评估、改写、生成都可以替换成真实实现
interface Deps {
  search(query: string): Promise<Chunk[]>
  judge(question: string, chunks: Chunk[]): Promise<{ verdict: Judge; missing?: string }>
  rewrite(question: string, tried: string[], missing?: string): Promise<string>
  answer(question: string, chunks: Chunk[], incomplete: boolean): Promise<string>
}

async function agenticRag(question: string, deps: Deps, maxRounds = 3) {
  const tried: string[] = []
  const kept = new Map<string, Chunk>() // 累积有用片段，按 id 去重
  let query = question
  for (let round = 1; round <= maxRounds; round++) {
    tried.push(query)
    const chunks = await deps.search(query)
    const { verdict, missing } = await deps.judge(question, [...kept.values(), ...chunks])
    if (verdict !== 'irrelevant') chunks.forEach((c) => kept.set(c.id, c))
    if (verdict === 'enough') return deps.answer(question, [...kept.values()], false)
    query = await deps.rewrite(question, tried, missing) // 部分相关时补查缺失信息
  }
  // 到达上限：用已有资料回答，并标明不完整
  return deps.answer(question, [...kept.values()], true)
}

// 演示用的假实现
const docs: Chunk[] = [
  { id: 'a', text: '项目 A 的负责人是张三，属于平台部', score: 0 },
  { id: 'b', text: '平台部今年的预算是 500 万（示例数据）', score: 0 },
]
const deps: Deps = {
  async search(q) { return docs.filter((d) => q.split(' ').some((w) => d.text.includes(w))) },
  async judge(_q, cs) {
    const ids = new Set(cs.map((c) => c.id))
    if (ids.has('a') && ids.has('b')) return { verdict: 'enough' }
    return ids.has('a') ? { verdict: 'partial', missing: '平台部 预算' } : { verdict: 'irrelevant' }
  },
  async rewrite(_q, _tried, missing) { return missing ?? '项目 A' },
  async answer(_q, cs, incomplete) { return `${incomplete ? '[资料不完整] ' : ''}依据 ${cs.map((c) => c.id).join(',')}` },
}

agenticRag('项目 A 负责人 部门预算', deps).then(console.log) // 依据 a,b
```

## 面试官可能追问

::: details Agentic RAG 和普通 RAG 加查询改写有什么区别？
普通的查询改写是固定的预处理，无论结果如何都只改写一次、检索一次。Agentic RAG 会看检索结果再决定下一步，改写依据是"缺了什么"，而且可以多轮、可以换数据源。前者是流水线，后者是带反馈的循环。
:::

::: details 怎么防止模型一直觉得"不够"，无限重试？
硬性的最大轮数和 token 预算必须有。另外记录已试过的查询，新查询和旧的过于相似就不再执行；连续两轮没有新增有用片段也提前停止。停止后如实告诉用户哪些信息没找到，而不是让模型补全。
:::

::: details 怎么评估 Agentic RAG 有没有比普通 RAG 好？
在同一个评测集上对比答案正确率、忠实度，同时记录平均检索轮数、延迟和成本。按问题类型拆开看：多跳和难检索的问题通常收益明显，简单问题往往没差别甚至变慢，这决定了要不要加快速路径。评测方法见 [RAG 评估](/ai/rag/08-rag-eval)。
:::

## 易错点

- 所有问题都走多轮闭环，简单问题的延迟和成本白白翻倍
- 评估节点用和生成一样贵的模型，成本被评估吃掉
- 改写时丢掉了上一轮的有用片段，多跳问题前功尽弃
- 达到轮数上限后让模型自由发挥，结果比单次检索的幻觉还多
