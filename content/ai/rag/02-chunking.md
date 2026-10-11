---
difficulty: 2
tags: [高频, 实践]
---

# 文档怎么切分？chunk 大小和重叠怎么选？

::: tip 一句话回答
常用做法是**先按文档结构切**（标题、段落），超长的部分再**递归**按段落、句子细分，相邻块保留少量**重叠**，防止关键信息被切断。块太小会丢掉上下文，太大会混进无关内容、稀释相似度，没有通用的最优值，要用评测集对比几组参数来定。每块都要带上来源、标题路径等**元数据**，还可以用小块检索、把它所属的大块交给模型（**父子块**）。
:::

## 详细解析

### 几种切分方式

| 方式 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| 固定长度 | 每 N 个 token 切一刀 | 实现简单，块大小均匀 | 会把句子、表格、代码从中间切断 |
| 按文档结构 | 按 Markdown 标题、HTML 标签、段落切 | 一块对应一个完整的小节 | 小节长短差异大，长的还要再切 |
| 递归切分 | 先用大的分隔符（空行）切，超长的再换小的（换行、句号）继续切 | 尽量在自然边界断开，同时控制长度 | 分隔符要按语言调整，中文要加上"。！？" |
| 语义切分 | 计算相邻句子的 Embedding 相似度，在相似度明显下降的地方切开 | 按话题的变化切 | 每个句子都要算 Embedding，成本高；阈值不好调，块大小不均匀 |

实践中最常用"结构 + 递归"：先按标题切成小节，超过上限的小节再递归细分。PDF 这类没有显式结构的文档，要先做版面解析，识别出标题、段落和表格，再按结构切。

### 块大小和重叠的取舍

- **太小**：一块只有一两句话，丢了主语和前提。比如"超过 30 天不支持退货"，看不出说的是哪类商品。检索可能命中，但模型拿到的信息不完整
- **太大**：一块里混了好几个话题。Embedding 是对整块内容的压缩表示，和问题相关的那句话被其他内容稀释，相似度反而下降；放进上下文后还会挤占其他候选的位置
- **硬上限**：块不能超过 Embedding 模型的最大输入长度，超出的部分可能被直接截断，有的接口则会报错。长度要用对应模型的分词器按 token 计算，不要按字符数估

条款、FAQ 这类一问一答的内容适合小块；教程、技术方案这类需要完整论述的内容适合大块。

**重叠**：相邻块共享一小段内容（如上一块的最后一两句），避免关键信息恰好落在边界上、两边都不完整。经验上常从块大小的一到两成开始试。代价是块数和存储变多，相邻块同时被召回时内容重复，拼接上下文前要合并或去重。按标题、段落切分且边界清晰时，重叠可以很小，甚至不要。

### 元数据和父子块

每块至少保存文档 ID、来源（URL、文件名、页码）、标题路径（如"用户手册 > 退款 > 退款时效"）、更新时间和权限。有了它们才能给出引用来源、按权限和时间过滤，文档更新或删除时也能按文档 ID 找到它的所有块。

标题路径还可以拼在块正文前面一起计算 Embedding，补上块里缺失的主语。更进一步，可以把整篇文档和这一块一起交给模型，让它写一两句简短的上下文（这块出自哪份文档、讲的是什么），拼到块前面再计算 Embedding 和建关键词索引（Anthropic 提出的 Contextual Retrieval 就是这个思路）。代价是每块都要调用一次模型，而且每次都要带上整篇文档，可以用 [Prompt Caching](/engineering/deploy/04-prompt-caching) 降低成本。

**父子块**：用小块（如一两百 token）建索引，命中后把它所属的大块（整个小节）交给模型。小块匹配更精确，大块上下文更完整。代价是要维护父子关系，大块占的上下文更多，多个小块命中同一个父块时要去重。

### 怎么确定参数

1. 准备评测集：问题、应命中的文档、能回答问题的原文片段。标注原文片段而不是块 ID，换了切分方式标注才能复用（见 [RAG 系统怎么评估](/ai/rag/08-rag-eval)）
2. 选几组候选，比如块大小 256 / 512 / 1024 token，重叠 0 / 10% / 20%，每组重新切分、建索引，对比 Recall@k 和最终回答的质量
3. 人工抽查切出来的块：表格、代码、列表有没有被切断，块里是否缺主语

## 代码示例

按 Markdown 标题切分并记录标题路径，过长的小节再按段落合并成块：

```ts
type Chunk = { text: string; embedText: string; meta: { source: string; headingPath: string[] } }

export function chunkMarkdown(md: string, source: string, maxLen = 800): Chunk[] {
  const chunks: Chunk[] = []
  const stack: { level: number; title: string }[] = [] // 当前所在的标题路径
  let lines: string[] = []
  let inCode = false

  const flush = () => {
    const body = lines.join('\n').trim()
    lines = []
    if (!body) return
    const headingPath = stack.map((h) => h.title)
    for (const text of packParagraphs(body, maxLen)) {
      // embedText 用于计算 Embedding：拼上标题路径，补全块里缺失的主语
      chunks.push({ text, embedText: `${headingPath.join(' > ')}\n${text}`, meta: { source, headingPath } })
    }
  }

  for (const line of md.split('\n')) {
    if (line.startsWith('```')) inCode = !inCode
    const m = inCode ? null : line.match(/^(#{1,6})\s+(.+)/) // 代码块里的 # 注释不是标题
    if (!m) {
      lines.push(line)
      continue
    }
    flush()
    while (stack.length && stack[stack.length - 1].level >= m[1].length) stack.pop() // 回到上一级标题
    stack.push({ level: m[1].length, title: m[2].trim() })
  }
  flush()
  return chunks
}

// 相邻段落合并到不超过 maxLen。演示从简：按字符计算长度（生产中应按 token），
// 单个段落超长时还要按句子继续切（递归切分），代码块里的空行也会被当成段落边界
function packParagraphs(body: string, maxLen: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const p of body.split(/\n{2,}/)) {
    if (cur && cur.length + p.length + 2 > maxLen) {
      out.push(cur)
      cur = ''
    }
    cur = cur ? `${cur}\n\n${p}` : p
  }
  if (cur) out.push(cur)
  return out
}
```

## 面试官可能追问

::: details 表格和代码块怎么切？
不要从中间切开。表格太长需要拆分时按行拆，每一块都带上表头，否则拆出来的数字没有含义；也可以把每行转成"字段: 值"的文本再索引。代码块尽量整块保留，太长时按函数或类切。
:::

::: details 语义切分一定比按结构切分好吗？
不一定。语义切分依赖相似度阈值，阈值不好调，切出来的块大小不均匀，还要给每个句子算 Embedding。手册、Wiki 这类结构清晰的文档，按标题切已经能得到语义完整的块。可以把它作为候选之一，放进评测集里和其他方案对比。
:::

::: details 块大小和检索条数 k 怎么配合？
放进上下文的内容大约是块大小乘以 k，两者要一起定：块小时可以多取几条，块大时少取几条，总量控制在上下文预算以内。用父子块时，要按父块的大小来算预算，而不是按建索引用的小块算。
:::

## 易错点

- 只调切分参数，不看解析结果：PDF 解析出来顺序错乱、页眉页脚混进正文时，怎么切都没用
- 按字符数控制长度：同样的字符数，中文和英文的 token 数差别很大，要用 Embedding 模型的分词器计算
- 块里只有"该功能""它"这类指代，又没有标题路径补充主语，很难被检索到
- 重叠不是越大越好，过大的重叠会让召回结果大量重复
