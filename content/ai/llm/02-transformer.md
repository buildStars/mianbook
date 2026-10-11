---
difficulty: 2
tags: [高频, 原理]
---

# Transformer 的核心结构是什么？自注意力是怎么计算的？

::: tip 一句话回答
Transformer 由很多层相同的模块堆叠而成，每层主要有两部分：**自注意力**负责在 token 之间交换信息，**前馈网络**（FFN）负责对每个 token 单独做变换。自注意力里，每个 token 生成 Q（我要找什么）、K（我能被怎样匹配）、V（我提供的内容），用 Q 和所有 K 的点积算相关度，除以 √d 后做 softmax 得到权重，再对 V 加权求和。现在主流的大模型基本都是 **Decoder-only** 结构，用**因果掩码**保证每个 token 只能看到它前面的内容。
:::

## 详细解析

### 整体结构

```text
输入文本 → 分词 → token 向量（Embedding）+ 位置信息
        → 第 1 层：自注意力 → 前馈网络（每个子层都带残差连接和归一化）
        → 第 2 层 …… 第 N 层
        → 输出层：映射成词表大小的分数（logits）→ 下一个 token 的概率
```

最早的 Transformer 用于机器翻译，是编码器-解码器结构，后来演化出三类：

| 结构 | 注意力范围 | 典型用途 |
| --- | --- | --- |
| Encoder-only | 双向，每个 token 能看到全文 | 文本分类、Embedding，例如 BERT |
| Encoder-Decoder | 编码器双向；解码器单向，并关注编码器的输出 | 翻译、摘要，例如 T5 |
| Decoder-only | 单向，只能看到前文 | 文本生成，当前主流的大模型 |

Decoder-only 的训练目标就是"根据前文预测下一个 token"，生成过程见 [大模型是怎么生成文本的](/ai/llm/01-generation-sampling)。

### 自注意力怎么算

可以把它理解成一次"按相关度加权的查表"：

- **Q（Query）**：当前 token 想找什么信息
- **K（Key）**：每个 token 用来被匹配的"标签"
- **V（Value）**：每个 token 实际提供的内容

Q、K、V 由同一个输入向量分别乘以三个**训练得到的**矩阵得来。计算公式：

```text
Attention(Q, K, V) = softmax(Q·Kᵀ / √d) · V
```

1. 每个 token 的 Q 和所有 token 的 K 做点积，得到 n × n 的相关度矩阵（n 是 token 数）
2. 除以 √d（d 是 K 向量的维度）
3. Decoder-only 模型加上因果掩码：把每个 token 之后位置的分数设为负无穷，softmax 后权重为 0
4. 按行做 softmax，得到注意力权重，每行之和为 1
5. 用权重对 V 加权求和，得到每个 token 融合了上下文信息的新表示

**为什么除以 √d**：点积是 d 个乘积之和，维度越大，结果的波动范围越大（q、k 的各分量相互独立、均值为 0、方差为 1 时，点积的方差是 d）。分数太大，softmax 的输出会接近 one-hot，梯度几乎为 0，训练很难进行。除以 √d 把分数拉回合适的范围。

### 多头注意力和位置编码

**多头注意力**：把 Q、K、V 拆成 h 组（h 个头），每个头独立计算注意力，最后把结果拼接起来，再做一次线性变换。不同的头可以关注不同类型的关联，比如有的关注相邻的词，有的关注指代关系。每个头的维度是总维度的 1/h，总计算量和单头差不多。为了减少推理时的显存，很多模型让多个 Q 头共享同一组 K、V（MQA、GQA），见 [KV Cache](/ai/llm/08-kv-cache)。

**位置编码**：注意力的计算本身不包含位置信息，不加掩码时，把输入的 token 打乱，每个 token 算出的结果不变（只是跟着换了位置），所以要额外注入位置信息：

- 原始 Transformer 用正弦、余弦函数生成位置向量，直接加到 token 向量上
- 当前很多大模型用 **RoPE（旋转位置编码）**：按位置旋转 Q 和 K，使点积里的位置信息只取决于两个 token 的相对距离

位置编码的方式会影响模型能否处理比训练时更长的文本，不少扩展上下文长度的方法就是在调整 RoPE 的参数。

### 计算量随长度平方增长

注意力要计算每个 token 和其他所有 token 的相关度，n 个 token 就有 n × n 个分数，这部分的计算量随长度**平方**增长：长度翻倍，约变成 4 倍。Q、K、V 的投影和前馈网络都是对每个 token 单独计算，只随长度线性增长。所以上下文越长，注意力的占比越大，这是长上下文成本高、首 token 慢的原因之一，见 [上下文窗口](/ai/llm/04-context-window)。

常见的优化方向：FlashAttention 分块计算，不把完整的 n × n 矩阵写入显存，结果是精确的，速度更快、显存更省，但计算量仍随长度平方增长；滑动窗口注意力、稀疏注意力只计算部分位置，用一定的效果换更低的计算量。

## 代码示例

单头、带因果掩码的自注意力（numpy）：

```python
import numpy as np

def causal_self_attention(x, Wq, Wk, Wv):
    # x：n 个 token 的向量，形状 (n, d_model)
    Q, K, V = x @ Wq, x @ Wk, x @ Wv            # 形状都是 (n, d_k)
    d_k = K.shape[-1]
    scores = Q @ K.T / np.sqrt(d_k)              # (n, n)：第 i 行是 token i 对每个 token 的相关度

    # 因果掩码：token i 只能看到 0..i，右上角设为负无穷，softmax 后权重为 0
    n = x.shape[0]
    scores[np.triu(np.ones((n, n), dtype=bool), k=1)] = -np.inf

    # 按行 softmax（减去最大值防止溢出），每行权重之和为 1
    weights = np.exp(scores - scores.max(axis=-1, keepdims=True))
    weights /= weights.sum(axis=-1, keepdims=True)
    return weights @ V, weights                  # 输出 (n, d_k)：对 V 的加权求和

rng = np.random.default_rng(0)
n, d_model, d_k = 4, 16, 8
x = rng.normal(size=(n, d_model))
Wq, Wk, Wv = (rng.normal(scale=0.3, size=(d_model, d_k)) for _ in range(3))

out, weights = causal_self_attention(x, Wq, Wk, Wv)
print(out.shape)            # (4, 8)
print(weights.round(2))     # 下三角矩阵：第 1 个 token 只能关注自己
```

## 面试官可能追问

::: details Q、K、V 为什么要用三个不同的矩阵，而不是直接拿 token 向量做点积？
直接用 token 向量做点积，相关度是对称的（A 对 B 和 B 对 A 一样），而且每个 token 往往和自己最相似。分成三个可训练的投影后，"拿什么去匹配""被怎样匹配"和"提供什么内容"可以分开学习，能表达"代词关注它指代的名词"这类不对称的关系。
:::

::: details 前馈网络（FFN）起什么作用？
注意力负责在 token 之间搬运信息，FFN 对每个 token 单独做非线性变换：先把维度放大几倍，经过激活函数再降回来。每层的大部分参数在 FFN 里，有研究认为大量知识就存储在这里。MoE（混合专家）模型把 FFN 换成多个"专家"，每个 token 只激活其中少数几个，总参数量很大，但每个 token 的计算量可控。
:::

::: details 为什么现在的大模型几乎都是 Decoder-only？
没有唯一的定论，常见的解释有：训练目标统一，就是预测下一个 token，可以直接用海量无标注文本训练；所有任务都能转成"续写"，一个模型通吃；结构简单，便于扩大规模；因果注意力让前文的计算结果（KV Cache）可以一直复用，多轮对话追加内容时不用重算前面的部分。
:::

::: details Transformer 相比 RNN 有什么优势？
RNN 必须逐个 token 顺序处理，训练无法并行；距离远的两个 token 要经过很多步传递，信息容易衰减。Transformer 的注意力让任意两个位置直接交互，训练时整段序列并行计算。代价是计算量随长度平方增长。
:::

## 易错点

- 训练时整段序列是**并行**计算的，因果掩码保证每个位置看不到后文；只有推理生成时才是逐个 token 串行输出
- 多头注意力不是把计算量乘以头数，每个头的维度会相应变小
- 平方复杂度是相对于**序列长度**而言的，模型的参数量基本不随上下文长度变化
