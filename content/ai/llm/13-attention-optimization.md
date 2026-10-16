---
difficulty: 3
tags: [性能优化, 原理, 对比]
---

# MQA、GQA 和 FlashAttention 分别解决了注意力的什么问题？

::: tip 一句话回答
两者针对的瓶颈不同。**MQA、GQA** 让多个 Q 头共享 K、V 头，减少 **KV Cache 的大小**和推理时每步要读的数据量，解决的是**生成阶段的显存和带宽**问题，会改变模型结构，需要在训练时就采用。**FlashAttention** 不改模型、结果是**精确的**，它把注意力**分块**放在片上高速缓存里算，用**在线 softmax** 避免把 n × n 的分数矩阵写回显存，解决的是**显存读写过多**的问题。
:::

## 详细解析

### 注意力的两个瓶颈

- **长序列的计算过程**：标准实现会把 n × n 的分数矩阵完整写到显存，再读出来做 softmax、乘 V。显存占用随长度平方增长，读写也慢。GPU 的算力增长比显存带宽快，很多时候算子在等数据，而不是在算
- **逐 token 生成**：每生成一个 token，都要把之前所有 token 的 K、V 从显存读一遍，见 [KV Cache](/ai/llm/08-kv-cache)。这一步计算量很小，速度基本取决于要读多少数据

MQA、GQA 针对第二个，FlashAttention 主要针对第一个。

### MHA、MQA、GQA

| 方式 | K、V 头数 | KV Cache | 效果 |
| --- | --- | --- | --- |
| MHA（多头注意力） | 和 Q 头数相同，每个头独立 | 最大 | 基准 |
| MQA（多查询注意力） | 只有 1 组，所有 Q 头共享 | 缩小为 MHA 的 1/头数 | 可能有明显损失，训练也可能不稳定 |
| GQA（分组查询注意力） | Q 头分成 g 组，每组共享一组 K、V | 缩小为 MHA 的 g/头数 | 接近 MHA，是常见的折中 |

KV Cache 的大小可以这样估算：2（K 和 V）× 层数 × KV 头数 × 每头维度 × 序列长度 × 每个数的字节数。KV 头数直接出现在乘积里，从 32 降到 8，缓存就缩小到 1/4，同样的显存能容纳更长的上下文或更多并发请求。

已经按 MHA 训练好的模型，可以把同组的 K、V 头取平均改成 GQA，再用少量数据继续训练恢复效果，不必从头训练。

### FlashAttention 的思路

标准实现的步骤：算出 S = QKᵀ 写入显存 → 读出来做 softmax 得到 P 写入显存 → 读出 P 乘 V。FlashAttention 把这几步融合成一个算子：

1. 把 Q、K、V 切成小块，每次只把一块载入片上的 SRAM（容量小、速度快）
2. 在 SRAM 里算这一块的分数、softmax 和加权求和
3. 用**在线 softmax** 合并各块：维护当前的最大值和分母，新块的最大值变大时，按比例修正之前的累加结果
4. 反向传播时不存 P，而是用保存的统计量重新计算，用少量额外计算换显存

结果和标准注意力在数学上等价，不是近似。计算量仍然随长度平方增长，省下的是显存读写，额外显存从平方级降到线性级。

在线 softmax 的核心逻辑：

```ts
// 分块读入分数，只维护最大值 m、分母 l 和未归一化的累加结果 acc
function onlineSoftmaxSum(scores: number[], values: number[], blockSize = 2): number {
  let m = -Infinity
  let l = 0
  let acc = 0
  for (let start = 0; start < scores.length; start += blockSize) {
    const s = scores.slice(start, start + blockSize)
    const v = values.slice(start, start + blockSize)
    const mNew = Math.max(m, ...s)
    const scale = Math.exp(m - mNew) // 最大值变了，旧结果按比例修正
    l *= scale
    acc *= scale
    s.forEach((si, i) => {
      const w = Math.exp(si - mNew)
      l += w
      acc += w * v[i]
    })
    m = mNew
  }
  return acc / l // 和先算完整 softmax 再加权求和的结果一致
}
```

### 其他相关优化

- **PagedAttention**：按页管理 KV Cache，减少显存碎片，见 [KV Cache](/ai/llm/08-kv-cache)
- **滑动窗口注意力**：每个 token 只关注最近一段，计算和缓存都不再随全长增长，但远处的信息只能靠多层间接传递
- **稀疏、线性注意力**：改变注意力的计算方式来降低复杂度，属于近似方法，通常要在结构设计时就定下来

## 面试官可能追问

::: details FlashAttention 能让注意力的复杂度变成线性吗？
不能。计算量还是 O(n²)，它降低的是显存占用和读写次数，额外显存从 O(n²) 降到 O(n)。真正改变复杂度的是稀疏注意力、线性注意力这类近似方法。
:::

::: details GQA 主要对训练有帮助还是推理有帮助？
主要是推理。训练时整段序列并行计算，瓶颈多在算力；推理逐 token 生成时，每步都要读完整的 KV Cache，缓存小了，读得少、能放下的请求也多。训练时计算量也会略有减少，但不是主要收益。
:::

::: details 为什么分块计算能变快？算的东西并没有少。
GPU 显存的带宽远低于片上 SRAM。标准实现反复把中间矩阵写回显存再读出来，大部分时间花在搬数据上。分块后中间结果留在 SRAM 里，显存只需要读一次输入、写一次输出。
:::

## 易错点

- 把 FlashAttention 当成近似算法，它的结果是精确的
- 以为 MQA、GQA 能直接套到任何已训练好的模型上，它们改变了权重结构，要转换后继续训练
- 把"减少 KV Cache"和"减少注意力计算量"混为一谈，两者对应不同阶段的瓶颈
