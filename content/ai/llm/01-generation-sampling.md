---
difficulty: 2
tags: [高频, 原理]
---

# 大模型是怎么生成文本的？temperature 和 top-p 分别控制什么？

::: tip 一句话回答
大模型是**自回归**生成的：每一步根据前面所有的 token，算出下一个 token 的概率分布，从中**采样**一个接到末尾，再预测下一个，直到生成结束符或达到长度上限。temperature 调整概率分布的"尖锐程度"，越高越随机；top-p 只在累计概率达到 p 的候选集合里采样，截掉低概率的长尾。
:::

## 详细解析

### 生成过程

1. 分词器把文本切成 token。不同模型的分词器不同，同一段中文切出来的 token 数可能差别很大
2. 模型（Transformer）处理整个序列，输出词表中每个 token 的分数，叫 **logits**
3. logits 经过 temperature 缩放后做 softmax，得到概率分布
4. 按采样策略选出下一个 token，接到序列末尾，回到第 2 步

### 采样参数

| 参数 | 作用 | 常见用法 |
| --- | --- | --- |
| temperature | logits 除以 T 再做 softmax。T < 1 分布更集中、输出更确定；T > 1 分布更平、输出更随机；T 趋近 0 时接近每次选概率最高的 token（贪心解码） | 代码、信息抽取、分类用低值（0～0.3）；创意写作用较高值（0.7～1） |
| top-k | 只保留概率最高的 k 个候选 | 防止采到概率极低的离谱 token |
| top-p（核采样） | 按概率从高到低累加，只保留累计概率刚达到 p 的最小集合 | 常用 0.9～0.95；候选数量随分布自动变化 |
| max_tokens | 最多生成多少个 token | 控制成本和长度；被截断时要检查结束原因 |

## 代码示例

```python
import numpy as np

def sample(logits, temperature=1.0, top_p=0.9):
    # temperature 不能为 0，实际实现中 0 会被当作贪心解码单独处理
    logits = np.asarray(logits, dtype=float) / temperature
    probs = np.exp(logits - logits.max())  # 减去最大值，防止指数溢出
    probs /= probs.sum()

    # top-p：按概率降序排列，保留累计概率达到 top_p 的最小集合
    order = np.argsort(probs)[::-1]
    cumulative = np.cumsum(probs[order])
    keep = order[: np.searchsorted(cumulative, top_p) + 1]

    kept = probs[keep] / probs[keep].sum()
    return np.random.choice(keep, p=kept)
```

## 面试官可能追问

::: details temperature 设为 0，每次输出一定一样吗？
不一定。即使用贪心解码，GPU 上浮点运算的顺序、服务端的批处理方式等因素也可能让结果出现细微差别。需要严格可复现时，要从推理服务层面专门处理。
:::

::: details temperature 和 top-p 要一起调吗？
一般建议只调其中一个，两个同时改很难判断效果是谁带来的。另外，一些推理模型不允许修改这些采样参数。
:::

::: details 为什么模型会"一本正经地胡说八道"（幻觉）？
模型学到的是"接下来最可能出现什么文字"，而不是事实本身。遇到训练数据里少见或没有的知识时，它仍然会生成看起来通顺的内容。缓解方法：用 RAG 提供依据，要求给出引用，允许回答"不知道"，降低 temperature，对关键信息做校验。
:::

## 易错点

- top-p 是"累计概率"阈值，不是"保留概率大于 p 的 token"
- 采样参数只改变"怎么选"，不改变模型本身的知识
