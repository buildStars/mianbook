---
difficulty: 2
tags: [实践, 场景题]
---

# 知识库更新后，索引怎么增量更新？

::: tip 一句话回答
核心是让每个块都能**追溯到源文档**，并用**内容哈希**判断有没有变。文档新增就切分入库；修改时重新切分，按块哈希对比，只给变了的块重新算 Embedding，删掉不再存在的旧块；文档删除时按文档 ID 删掉它的所有块。换 Embedding 模型或切分策略时没法增量，要**全量重建一份新索引**，验证后再切换。
:::

## 详细解析

### 为什么不能每次全量重建

全量重建最简单，但文档多了以后，Embedding 的调用成本和耗时都很高，更新频繁时根本跑不过来。而且重建期间要么停服，要么两份索引并存。增量更新只处理变化的部分，通常能把每次的工作量降到很小。

### 数据模型

除了向量库，再维护一张文档表和一张块表，记录映射关系：

```text
documents: doc_id, source_uri, version, content_hash, updated_at, status
chunks:    chunk_id, doc_id, chunk_hash, position, vector_id
```

- `content_hash`：整篇文档的哈希，没变就整篇跳过
- `chunk_hash`：块文本（加上影响 Embedding 的元数据）的哈希，用来判断块是否需要重新向量化
- 向量库里每条向量也带上 `doc_id`，便于按文档批量删除和过滤

### 更新流程

1. **发现变化**：数据源支持变更事件（Webhook、数据库 CDC）就用事件驱动；不支持就定时扫描，对比修改时间和文档哈希
2. **新增**：解析、切分、向量化、写入
3. **修改**：重新切分，算出新块的哈希集合，和旧块对比。哈希相同的块直接复用旧向量，新出现的块向量化后写入，消失的块删除
4. **删除**：按 `doc_id` 删除所有块和向量。只删数据库记录、忘了删向量，已删的内容还会被检索出来
5. **记录状态**：每一步写日志和版本号，失败可以重试，重试要幂等

中间插入一段文字，按固定长度切分会让后面所有块的边界都移位，哈希全变。按标题、段落这类结构切分，改动影响的块更少（见 [文档切分](/ai/rag/02-chunking)）。

### 必须全量重建的情况

- **换 Embedding 模型**：不同模型的向量不在同一个空间，新旧向量不能混在一起检索
- **改切分策略**：块的边界全变了
- **改了参与 Embedding 的内容**：比如块前面拼接的标题格式

这时建一份新索引（新的 collection 或别名），后台全量写入，用评测集验证后，把查询切换过去，旧索引保留一段时间用于回滚。和数据库的蓝绿发布思路一样。

## 代码示例

```js
import { createHash } from 'node:crypto'

const hash = (text) => createHash('sha256').update(text).digest('hex')

// 对比新旧两组块，算出要新增和要删除的块；哈希相同的块复用旧向量
function diffChunks(oldChunks, newTexts) {
  const oldByHash = new Map(oldChunks.map((c) => [c.hash, c]))
  const newHashes = new Set()
  const toAdd = []
  for (const text of newTexts) {
    const h = hash(text)
    newHashes.add(h)
    if (!oldByHash.has(h)) toAdd.push({ hash: h, text })
  }
  const toDelete = oldChunks.filter((c) => !newHashes.has(c.hash))
  return { toAdd, toDelete, reused: newHashes.size - toAdd.length }
}

const old = ['退款流程', '发票说明', '联系方式'].map((t) => ({ hash: hash(t), vectorId: t }))
console.log(diffChunks(old, ['退款流程', '发票说明（新版）', '联系方式']))
// toAdd: 发票说明（新版），toDelete: 旧的发票说明，reused: 2
```

## 面试官可能追问

::: details 更新期间用户查询会不会查到一半新一半旧的数据？
会有短暂的不一致。对单篇文档，可以先写入新块、再删除旧块，最坏是短时间内新旧内容同时出现，而不是查不到；要求严格的，在块上加版本号，查询只取当前生效的版本。多数知识库场景能接受秒级到分钟级的延迟。
:::

::: details HNSW 索引频繁删除会有问题吗？
很多向量库的删除是先打标记，查询时跳过，后台再合并清理。删除多了，索引里的无效节点会影响召回和性能，需要定期压缩或重建。具体机制各家不同，看所用数据库的文档。
:::

::: details 关键词索引也要同步更新吗？
要。混合检索时向量库和 BM25 索引是两份数据，更新要一起做，否则两路检索的结果不一致（见 [混合检索](/ai/rag/05-hybrid-search)）。最好由同一个更新任务按 `chunk_id` 写入两边。
:::

## 易错点

- 删除文档只删了原文，没删向量库里的块，已下线的内容还会被检索到
- 用固定长度切分，改一个字后面全部块都要重算，增量的收益很小
- 换了 Embedding 模型却只对新文档用新模型，新旧向量混在一个索引里
- 更新任务不幂等，失败重试后出现重复的块
