---
difficulty: 3
tags: [原理, 性能优化]
---

# KV Cache 是什么？为什么能加速推理？

::: tip 一句话回答
自回归生成每输出一个 token，都要让新 token 和**之前所有 token 的 K、V** 做注意力计算。由于因果掩码，之前 token 的 K、V 不会再变，所以算一次就存起来，之后每一步只为新 token 计算 Q、K、V，这就是 KV Cache，它省掉了大量重复计算。代价是**显存**：缓存大小随序列长度和并发数线性增长。推理因此分成两个阶段：**prefill** 并行处理全部输入并建立缓存，**decode** 逐个生成 token 并追加缓存。
:::

## 详细解析

### 为什么可以缓存

Decoder-only 模型有因果掩码，每个位置只依赖它自己和它前面的 token。所以前 t 个 token 在每一层算出的 K、V，不会因为后面生成了新 token 而改变（原理见 [Transformer](/ai/llm/02-transformer)）。

```text
不用缓存：每生成一个新 token，都把前面所有 token 在每一层的计算重做一遍

使用缓存：
  prefill：输入 [今天, 天气] → 并行算出每一层的 K、V，存入缓存 → 输出 "很"
  decode ：只为 "很" 计算 Q、K、V → K、V 追加到缓存
           → Q 和缓存里所有的 K、V 做注意力 → 输出 "好"
           → 重复，直到生成结束
```

不需要缓存 Q：生成新 token 时只用到它自己的 Q，之前 token 的 Q 不会再被用到。

### prefill 和 decode

| | prefill | decode |
| --- | --- | --- |
| 处理什么 | 整个输入 | 每步一个新 token |
| 并行度 | 所有输入 token 并行计算 | 串行，一步一个 token |
| 瓶颈 | 计算密集，受限于 GPU 算力 | 访存密集，每步都要读一遍全部权重和 KV Cache，受限于显存带宽 |
| 影响的指标 | 首 token 延迟（TTFT） | 输出 token 之间的间隔、整体生成速度 |
| 对缓存的操作 | 建立 | 读取和追加 |

这解释了几个常见现象：输入越长，首 token 越慢；输出越长，总耗时越长。decode 阶段单个请求用不满 GPU 的算力，所以推理服务会把很多请求拼成批次一起 decode 来提高吞吐，见 [vLLM 这类推理框架为什么能提升吞吐](/engineering/deploy/06-inference-engines)。

### 显存占用

```text
KV Cache 字节数 ≈ 2（K 和 V）× 层数 × KV 头数 × 每个头的维度 × 序列长度 × 并发数 × 每个数值的字节数
```

假设一个模型有 32 层、32 个注意力头，每 4 个头共享一组 K、V（即 8 个 KV 头），头维度 128，用 FP16（2 字节）存储：每个 token 占 2 × 32 × 8 × 128 × 2 = 128 KB，一个 4000 token 的请求约 500 MB，32 个这样的请求同时处理约 16 GB。如果每个头都有自己的 K、V（32 个 KV 头），占用还要再乘以 4。长上下文、高并发时，KV Cache 可能比模型权重本身还大。完整的估算方法见 [部署一个 7B 模型需要多少显存](/engineering/deploy/09-gpu-memory)。

常见的优化：

- **GQA、MQA**：多个 Q 头共享一组 K、V，缓存成倍缩小
- **KV Cache 量化**：用 8 位等更低的精度存储缓存
- **分页管理**：PagedAttention 像操作系统管理内存分页一样按块分配缓存，减少显存碎片和预留浪费
- **滑动窗口注意力**：只保留最近一段 token 的缓存

### 和 Prompt Caching 的关系

| | KV Cache | Prompt Caching（前缀缓存） |
| --- | --- | --- |
| 作用范围 | 单个请求内部 | 跨请求复用 |
| 缓存什么 | 本次请求已处理 token 的 K、V | 多个请求共有前缀的 K、V |
| 省掉什么 | decode 阶段的重复计算 | 共有前缀的 prefill 计算 |
| 谁来管理 | 推理引擎自动完成，请求结束就释放 | 服务端实现，有的厂商要求显式标记，缓存有过期时间 |

Prompt Caching 可以理解为把某段前缀的 KV Cache 保留下来，给后续请求复用。因为每个 token 的 K、V 依赖它前面所有的 token，只有**从开头开始完全相同**的前缀才能复用，见 [Prompt Caching](/engineering/deploy/04-prompt-caching)。

## 代码示例

用 numpy 验证：逐个 token 用缓存计算的结果，和每次重算整个序列的结果相同（单层、单头，省略了 FFN 等部分）：

```python
import numpy as np

rng = np.random.default_rng(0)
d = 8
Wq, Wk, Wv = (rng.normal(size=(d, d)) for _ in range(3))

def softmax(s):
    e = np.exp(s - s.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)

def full_attention(X):
    """不用缓存：每次把整个序列重新算一遍（带因果掩码）"""
    Q, K, V = X @ Wq, X @ Wk, X @ Wv
    scores = Q @ K.T / np.sqrt(d)
    scores[np.triu_indices(len(X), k=1)] = -np.inf
    return softmax(scores) @ V

class KVCache:
    def __init__(self):
        self.K = np.empty((0, d))
        self.V = np.empty((0, d))

    def step(self, x):
        """使用缓存：只为新 token 计算 q、k、v，并把 k、v 追加到缓存"""
        q, k, v = x @ Wq, x @ Wk, x @ Wv
        self.K = np.vstack([self.K, k])
        self.V = np.vstack([self.V, v])
        return softmax(q @ self.K.T / np.sqrt(d)) @ self.V

X = rng.normal(size=(5, d))                          # 5 个 token，逐个"生成"
cache = KVCache()
incremental = np.array([cache.step(x) for x in X])
print(np.allclose(incremental, full_attention(X)))  # True：结果一致，但每步只算了一个新 token
```

## 面试官可能追问

::: details 输入很长时首 token 很慢，为什么之后的输出速度变化没那么大？
prefill 要一次处理全部输入，输入越长越慢。decode 每步只处理一个新 token，主要开销是读取模型权重；读取 KV Cache 的开销虽然随长度增长，但在上下文不太长时占比较小。上下文非常长时，这部分开销也会变得明显。
:::

::: details KV Cache 的显存不够了，推理服务会怎么处理？
限制同时处理的请求数和最大长度，新请求排队；显存紧张时暂停部分请求，把它们的缓存换出到 CPU 内存，或者丢弃后再重新计算。分页管理、GQA、缓存量化都能让同样的显存容纳更多请求。
:::

::: details Prompt Caching 为什么要求前缀完全相同？
每个 token 的 K、V 是在"看过它前面所有 token"之后算出来的。前面某个位置只要变了一个字，从这个位置开始往后的 K、V 都会变，缓存也就失效了。所以要把固定的内容放在最前面，变化的内容放在后面。
:::

::: details 用了 KV Cache，模型的输出会变吗？
不会。它只是避免重复计算，在数学上和每次重算等价，实际中可能因为浮点运算顺序不同出现极小的数值差异。如果对缓存做了量化，则相当于用一点精度换显存。
:::

## 易错点

- KV Cache 是单个请求内的推理优化，跨请求复用的是 Prompt Caching
- 模型的参数量是固定的，KV Cache 随序列长度和并发数增长，长上下文、高并发时它是显存的大头
- 缓存的是每一层的 K 和 V，不是已经生成的 token 文本
