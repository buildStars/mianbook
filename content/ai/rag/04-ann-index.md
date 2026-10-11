---
difficulty: 3
tags: [原理, 性能优化]
---

# 向量检索为什么快？HNSW 和 IVF 是什么？

::: tip 一句话回答
暴力检索要拿查询向量和库里的每个向量都算一次相似度，计算量随数据量线性增长。向量数据库用**近似最近邻（ANN）**索引，只计算一小部分候选，用一点召回率换取大幅的速度提升。**HNSW** 是分层的近邻图，从顶层稀疏的图快速跳到目标附近，再到底层精细查找；**IVF** 先把向量聚类，查询时只搜索离查询最近的几个簇；**PQ** 等量化方法压缩向量，降低内存占用。
:::

## 详细解析

### 为什么需要近似检索

暴力检索（Flat）对 N 个 d 维向量，每次查询要做 N × d 次乘加。假设库里有 1000 万条 1024 维的向量，一次查询就是约 100 亿次乘加，还要把约 40 GB 的向量数据读一遍。数据量小时暴力检索完全可以用，结果也是精确的；数据量大、并发高时就扛不住了。

ANN 只和一小部分"有希望"的候选比较，代价是可能漏掉个别真正最近的向量。所以要用**召回率**衡量它：ANN 返回的前 k 个结果里，有多少个也出现在暴力检索的前 k 个里。

### HNSW：分层的近邻图

```text
第 2 层   A ─────────────────── F                   节点少，边跨度大：快速接近目标
第 1 层   A ───────── C ─────── F ───────── H
第 0 层   A ─ B ─ C ─ D ─ E ─ F ─ G ─ H ─ I ─ J     全部节点，边只连近邻：精细查找
```

- 每个向量是图里的一个节点，和若干个近邻连边。所有节点都在第 0 层，节点出现在高层的概率逐层递减，所以越往上节点越少，结构和跳表类似
- 查询从顶层的入口节点出发，贪心地走向离查询更近的邻居，走不动了就下到下一层继续；到第 0 层时用一个大小为 ef 的候选队列做更大范围的搜索，最后返回最近的 k 个

| 参数 | 阶段 | 作用 | 调大的影响 |
| --- | --- | --- | --- |
| M | 建索引 | 每个节点最多连多少个邻居 | 召回更高，内存和建索引时间增加 |
| efConstruction | 建索引 | 建图时的候选队列大小 | 图的质量更好，建索引更慢 |
| efSearch | 查询 | 查询时的候选队列大小，不能小于 k | 召回更高，查询更慢 |

pgvector 里这三个参数分别叫 `m`、`ef_construction` 和 `hnsw.ef_search`。HNSW 召回高、查询快、支持增量插入，是最常用的向量索引之一；代价是图结构占用额外的内存，而且要常驻内存才快。

### IVF：先聚类，再在少数几个簇里找

1. 建索引：用 k-means 把所有向量聚成 nlist 个簇，每个向量放进离它最近的簇心对应的列表（倒排列表）
2. 查询：先算查询向量和所有簇心的距离，选出最近的 nprobe 个簇，只在这些簇里逐个比较

- **nlist**：簇越多，每个簇越小，扫描的数据越少；但真正的近邻落在没被选中的簇里的可能性也越大
- **nprobe**：查的簇越多，召回越高、越慢；nprobe 等于 nlist 时就退化成了暴力检索
- pgvector 里这两个参数叫 `lists` 和 `ivfflat.probes`，文档给的起点：100 万行以内 lists 取行数 / 1000，超过时取行数的平方根；probes 从 lists 的平方根开始调
- 簇心是用已有数据训练出来的，所以要在表里有了足够的数据之后再建索引；数据分布变化很大时要重建

IVF 没有图结构，内存比 HNSW 省、建索引快，但召回对 nprobe 比较敏感。

### 量化，以及怎么选

- **标量量化（SQ）**：把每一维的 float32 压成 int8，向量占用的内存约为原来的 1/4
- **乘积量化（PQ）**：把 d 维向量切成 m 段，每段单独聚成 256 个中心，每段只存 1 个字节的中心编号。1024 维的 float32 向量原本占 4096 字节，切成 64 段后只占 64 字节。查询时先算出查询的每一段到 256 个中心的距离表，之后每个向量的距离只要查表相加
- 量化后的距离是近似的，召回会下降。常见做法是先用压缩后的向量粗筛出较多候选，再用原始向量重新计算距离、精排。IVF 和 PQ 也常组合使用（IVF-PQ），用于超大规模的数据

几种方案放在一起对比：

| 方案 | 召回 | 查询速度 | 内存 | 适合 |
| --- | --- | --- | --- | --- |
| 暴力检索 | 精确 | 随数据量线性变慢 | 原始向量 | 数据量小，或要求精确结果 |
| HNSW | 高 | 快 | 最大（向量 + 图） | 大多数在线检索场景 |
| IVF | 取决于 nprobe | 较快 | 原始向量 + 簇心 | 内存比较紧张 |
| IVF-PQ | 较低，要靠精排补偿 | 快 | 最小 | 超大规模 |

调参方法：抽一批真实的查询，以暴力检索的结果为标准答案，在几组参数下分别测召回率、P99 延迟和内存，从满足召回要求的配置里选最快的。

## 代码示例

用 numpy 实现一个简化的 IVF，观察 nprobe 对召回率和扫描量的影响：

```python
import numpy as np

rng = np.random.default_rng(0)
N, d, k, nlist = 20000, 64, 10, 128
topics = rng.normal(size=(300, d))  # 模拟真实数据：向量围绕若干"话题"分布
xb = (topics[rng.integers(0, 300, N)] + rng.normal(size=(N, d))).astype(np.float32)
xb /= np.linalg.norm(xb, axis=1, keepdims=True)  # 归一化后，内积就是余弦相似度
queries = xb[rng.choice(N, 100, replace=False)] + 0.05 * rng.normal(size=(100, d)).astype(np.float32)

# 建索引：简化的 k-means，把向量分到 nlist 个簇
centroids = xb[rng.choice(N, nlist, replace=False)].copy()
for _ in range(10):
    assign = np.argmax(xb @ centroids.T, axis=1)
    for c in range(nlist):
        members = xb[assign == c]
        if len(members):
            mean = members.mean(axis=0)
            centroids[c] = mean / np.linalg.norm(mean)
assign = np.argmax(xb @ centroids.T, axis=1)
lists = [np.where(assign == c)[0] for c in range(nlist)]

def ivf_search(q, nprobe):
    probe = np.argsort(-(centroids @ q))[:nprobe]  # 离查询最近的 nprobe 个簇
    cand = np.concatenate([lists[c] for c in probe])
    return cand[np.argsort(-(xb[cand] @ q))[:k]], len(cand)

truth = [set(np.argsort(-(xb @ q))[:k]) for q in queries]  # 暴力检索的结果作为标准答案
for nprobe in (1, 4, 16, 64):
    recall, scanned = [], []
    for q, t in zip(queries, truth):
        ids, n = ivf_search(q, nprobe)
        recall.append(len(t & set(ids)) / k)
        scanned.append(n / N)
    # nprobe 越大，召回率越高，扫描的数据也越多
    print(f"nprobe={nprobe:<3} recall@{k}={np.mean(recall):.3f} 扫描比例={np.mean(scanned):.1%}")
```

## 面试官可能追问

::: details ANN 的召回率和 RAG 评估里的 Recall@k 是一回事吗？
不是。ANN 的召回率以暴力检索的结果为标准答案，衡量的是索引近似带来的损失；RAG 的 Recall@k 以人工标注的相关文档为标准答案，衡量的是整个检索链路。Embedding 模型不合适时，ANN 召回率是 100% 也找不到正确的文档（见 [RAG 系统怎么评估](/ai/rag/08-rag-eval)）。
:::

::: details HNSW 为什么内存占用大？删除数据有什么麻烦？
每个节点除了向量本身，还要存邻居列表，M 越大列表越长；查询时在图上随机跳转，数据要常驻内存才快。删除节点会破坏图的连通性，很多实现先把节点标记为已删除、查询时跳过，等删除积累多了再整理或重建索引。频繁删除和更新的场景要关注这部分开销。
:::

::: details 数据量多大才需要 ANN 索引？
没有固定的分界线，取决于延迟要求、并发量和硬件。最直接的办法是用自己的数据实测：暴力检索的延迟能满足要求，就不需要索引，还能拿到精确结果。暴力检索的耗时和数据量成正比，可以按数据增长的速度估算什么时候需要切换。
:::

::: details 向量维度越高越好吗？
不一定。维度越高，存储、计算和索引内存都成比例增加。有的 Embedding 模型支持输出更短的向量（比如用 Matryoshka 方式训练的模型，可以只取前面若干维），用一点效果换存储和速度，划不划算同样要用评测集验证（截短后的处理和其他选型考虑见 [Embedding 是什么](/ai/llm/07-embedding)）。
:::

## 易错点

- 把 ANN 当成精确检索：结果可能漏掉真正最近的向量，召回率要实测
- 在空表或数据很少时就建 IVF 索引，簇心没有代表性，数据多了以后召回很差
- 分清两类参数：M、efConstruction、nlist 在建索引时确定，改了要重建；efSearch、nprobe 在查询时设置，可以按请求调整
