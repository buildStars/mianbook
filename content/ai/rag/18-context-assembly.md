---
difficulty: 2
tags: [实践]
---

# 检索到的片段怎么组织进 Prompt？顺序、去重和压缩怎么做？

::: tip 一句话回答
检索和重排之后还有一步**上下文组装**：按 **token 预算**挑片段，**去重**并**合并同一文档的相邻块**，每段附上**来源元数据**，用分隔标签包好；顺序上把最相关的片段放在**开头和结尾**，因为模型对长上下文中间部分的利用往往较差。片段太长时做**压缩**：只抽取和问题相关的句子，或者先摘要。目标是用更少的 token 给模型更干净、更完整的证据。
:::

## 详细解析

### 为什么不能直接拼接

把前 k 个片段按分数顺序拼起来，常见问题有：

- 多个片段内容几乎一样，浪费 token
- 同一文档被切成相邻的几块，分散开后上下文断裂，代词和表格表头找不到
- 片段没有出处，模型无法引用，也无法判断新旧
- 重要片段排在中间，模型容易忽略
- 片段太多挤占了对话历史和输出的空间

排序本身由[重排](/ai/rag/06-rerank)决定，这里讲排好序之后怎么摆进 Prompt。

### 去重和合并相邻块

1. **精确去重**：文本哈希相同的只留一份
2. **近似去重**：和已选片段相似度超过阈值的跳过，同时保证结果的多样性
3. **合并相邻块**：同一文档、序号相邻或重叠的块合并成一段，按文档内原始顺序排列，恢复完整语境。切块时保存 `doc_id` 和块序号就是为了这一步，见[文档切分](/ai/rag/02-chunking)

### 排序和位置

- 长上下文里，模型对开头和结尾的信息利用得更好，中间容易被忽略，这个现象常被称为 "lost in the middle"
- 实践做法：把最相关的放第一位，次相关的放最后，其余放中间；片段不多时直接按相关度降序即可
- 用户问题放在资料之后、靠近结尾，模型读完资料再看问题，指向更明确

### 附带来源，用标签隔开

每个片段带上编号、标题、来源、日期，用 XML 风格的标签包起来，既方便模型引用，也把资料和指令隔开，防止资料里的文字被当成指令，见[用分隔符组织 Prompt](/ai/prompt/12-xml-delimiters)。引用格式怎么设计见[引用和溯源](/ai/rag/15-citation)。

### 压缩和 token 预算

| 方法 | 做法 | 代价 |
| --- | --- | --- |
| 截断 | 超出预算的片段直接丢弃 | 最便宜，可能丢掉关键信息 |
| 句子抽取 | 按句切分，只保留和问题相关的句子 | 需要一次相关性打分，保留原文措辞 |
| 摘要 | 用小模型把片段压缩成要点 | 多一次调用，可能丢细节或引入错误 |

预算分配：先扣掉系统提示词、对话历史和预留的输出长度，剩下的才给资料。数字、条款类资料尽量保留原文，摘要适合背景性的长文档。

## 代码示例

```js
// 输入：已按相关度降序排好的片段；输出：可直接放进 Prompt 的资料段
function assembleContext(chunks, { budget, countTokens }) {
  // 1. 精确去重
  const seen = new Set()
  const unique = chunks.filter((c) => !seen.has(c.text) && seen.add(c.text))

  // 2. 按预算挑选（保持相关度顺序）
  const picked = []
  let used = 0
  for (const c of unique) {
    const t = countTokens(c.text)
    if (used + t > budget) continue // 放不下就跳过，试下一个更短的
    picked.push(c)
    used += t
  }

  // 3. 合并同一文档的相邻块，组内按原始序号排
  const groups = new Map()
  for (const c of picked) {
    if (!groups.has(c.docId)) groups.set(c.docId, [])
    groups.get(c.docId).push(c)
  }
  const merged = []
  for (const [docId, list] of groups) {
    list.sort((a, b) => a.seq - b.seq)
    let cur = { ...list[0] }
    for (const c of list.slice(1)) {
      if (c.seq === cur.endSeq + 1) { cur.text += '\n' + c.text; cur.endSeq = c.seq }
      else { merged.push(cur); cur = { ...c } }
    }
    merged.push(cur)
  }

  // 4. 最相关的放首位，次相关的放末尾
  const [first, second, ...rest] = merged
  const ordered = [first, ...rest, second].filter(Boolean)

  return ordered
    .map((c, i) => `<doc id="${i + 1}" source="${c.source}">\n${c.text}\n</doc>`)
    .join('\n')
}

const chunks = [
  { docId: 'A', seq: 2, source: '退款政策', text: '退款 7 天内原路退回。' },
  { docId: 'B', seq: 1, source: 'FAQ', text: '会员可加急处理。' },
  { docId: 'A', seq: 3, source: '退款政策', text: '虚拟商品不支持退款。' },
  { docId: 'C', seq: 5, source: '公告', text: '退款 7 天内原路退回。' }, // 与 A-2 重复
]
for (const c of chunks) c.endSeq = c.seq
console.log(assembleContext(chunks, { budget: 100, countTokens: (s) => s.length }))
// A 的 2、3 两块合并成一段排第一，B 排最后，C 被去重
```

## 面试官可能追问

::: details 片段给得越多越好吗？
不是。无关片段会分散注意力，甚至被当成依据，答案反而变差；token 多了延迟和成本也上升。通常在评测集上对比不同的 k 和预算，选效果和成本的平衡点；有重排时，先多召回、再精选少量进入 Prompt。
:::

::: details 压缩会不会让引用对不上原文？
摘要会。如果产品要求精确引用，压缩时用句子抽取保留原文，并记录每句来自哪个片段；或者只压缩背景资料，需要引用的关键片段保留原文。
:::

::: details 多轮对话里，上一轮检索的资料还要带上吗？
看问题是否延续上一轮话题。延续时可以保留上一轮被引用过的片段，没用到的丢掉；话题切换时重新检索。保留过多会让上下文越来越长，参考[多轮对话的记忆管理](/ai/prompt/06-conversation-memory)。
:::

## 易错点

- 只做文本精确去重，不管近似重复，前几名仍被同一内容占满
- 合并相邻块时不按原始序号排序，句子顺序错乱
- 片段不带来源，事后无法核对答案依据
- 忘记给输出预留 token，资料塞满后回答被截断
