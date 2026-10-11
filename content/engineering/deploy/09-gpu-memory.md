---
difficulty: 3
tags: [高频, 原理]
---

# 部署一个 7B 模型需要多少显存？怎么估算？

::: tip 一句话回答
推理时的显存主要有三部分：**权重**、**KV Cache**、**激活值和框架开销**。权重 = 参数量 × 每个参数的字节数，7B 模型用 FP16 约 **14 GB**，INT4 约 **3.5 GB** 再加少量额外开销。KV Cache = 2 × 层数 × KV 头数 × 头维度 × 每个元素的字节数 × 序列长度 × 并发数，长上下文、高并发时它可能比权重还大；使用 GQA 的模型 KV 头少，KV Cache 会小很多。这些都是估算，实际占用以部署后的测量为准。
:::

## 详细解析

### 权重

| 精度 | 每个参数的字节数 | 7B 模型的权重 |
| --- | --- | --- |
| FP32 | 4 | 约 28 GB |
| FP16 / BF16 | 2 | 约 14 GB |
| INT8 | 1 | 约 7 GB |
| INT4 | 0.5 | 约 3.5 GB，另有缩放系数等额外开销 |

这里的 GB 指 10 的 9 次方字节。显卡和监控工具常用 GiB（2 的 30 次方字节），14 GB 约等于 13 GiB。

### KV Cache

生成时要为每个 token 缓存每一层的 Key 和 Value（原理见 [KV Cache 是什么](/ai/llm/08-kv-cache)）：

```text
每个 token 的 KV Cache = 2（K 和 V）× 层数 × KV 头数 × 头维度 × 每个元素的字节数
总 KV Cache = 每个 token 的 KV Cache × 序列长度 × 并发数
```

这些参数在模型的 `config.json` 里：`num_hidden_layers` 是层数；`num_key_value_heads` 是 KV 头数，没有这个字段时等于 `num_attention_heads`；头维度一般是 `hidden_size / num_attention_heads`，有的模型直接给出 `head_dim`。

**示例一**：32 层、32 个 KV 头、头维度 128、FP16，和 Llama 2 7B 的结构相同，没有使用 GQA：

```text
每个 token：2 × 32 × 32 × 128 × 2 字节 = 524,288 字节（约 0.52 MB）
一个 4096 token 的请求：约 2.1 GB
8 个这样的请求同时进行：约 17 GB，比 14 GB 的权重还大
```

**示例二**：同样是 32 层、头维度 128，但使用了 GQA，只有 8 个 KV 头（Llama 3 8B 就是这样的配置）：

```text
每个 token：2 × 32 × 8 × 128 × 2 字节 = 131,072 字节（约 0.13 MB）
一个 4096 token 的请求：约 0.54 GB
8 个并发：约 4.3 GB，只有示例一的四分之一
```

GQA（分组查询注意力）让多个查询头共享同一组 K、V，KV Cache 随 KV 头数成比例缩小，长上下文、高并发的部署因此受益明显。

### 激活值和框架开销

- **激活值**：前向计算的中间结果，和批大小、一次处理的 token 数有关，prefill 长输入时较大
- **框架开销**：CUDA 上下文、通信缓冲、显存碎片等
- 推理框架通常会预先占用一定比例的显存（如 vLLM 的 `--gpu-memory-utilization`），扣掉权重和运行开销，剩下的都给 KV Cache，能同时跑多少请求就由它决定

### 合起来估算

```text
示例一，FP16，8 个 4096 token 的并发请求：
  权重 14 GB + KV Cache 约 17 GB + 激活值和框架开销 → 超过 31 GB
  单张 24 GB 显存的卡放不下：可以量化权重、换成使用 GQA 的模型、降低并发数或上下文长度，或者用显存更大的卡
```

估算只是为了确定量级和选型方向，要留出余量，上线前用真实的并发和长度压测，看实际的显存占用。

## 代码示例

```python
def estimate(params_b, weight_bytes, layers, kv_heads, head_dim,
             seq_len, batch, kv_bytes=2):
    """粗略估算推理显存，单位 GB（10^9 字节），不含激活值和框架开销"""
    weights = params_b * 1e9 * weight_bytes
    kv_per_token = 2 * layers * kv_heads * head_dim * kv_bytes
    kv_total = kv_per_token * seq_len * batch
    return round(weights / 1e9, 1), round(kv_total / 1e9, 1)

# 7B，FP16 权重，32 个 KV 头，8 个 4096 token 的请求
print(estimate(7, 2, 32, 32, 128, 4096, 8))   # (14.0, 17.2)
# 假设同样的 7B 模型改用 GQA（8 个 KV 头），权重量化到 INT4
print(estimate(7, 0.5, 32, 8, 128, 4096, 8))  # (3.5, 4.3)
```

## 面试官可能追问

::: details 为什么并发一上来，显存就不够了？
权重是固定的，KV Cache 却随"序列长度 × 并发数"线性增长。示例一里，每个 4096 token 的请求要 2 GB 多的 KV Cache，并发从 1 涨到 8，KV Cache 就从 2 GB 多涨到 17 GB。所以部署时要根据留给 KV Cache 的显存，限制最大上下文长度和最大并发数。
:::

::: details 微调需要多少显存？
比推理多得多。全量微调用 Adam 优化器、混合精度训练时，每个参数除了 FP16 的权重和梯度，还要保存 FP32 的主权重和两个优化器状态，合计约 16 字节，7B 模型光这一部分就要 112 GB 左右，还没算激活值。LoRA 冻结原模型、只训练很少的新增参数；QLoRA 再把冻结的权重量化到 4 位，显存需求能降到单张卡可以承受的程度。
:::

::: details 显存不够有哪些办法？
- 量化权重（见[模型量化是什么](/engineering/deploy/05-quantization)），或者把 KV Cache 量化到 8 位
- 选用 GQA 等 KV Cache 更小的模型
- 限制最大上下文长度和最大并发数
- 用张量并行把模型拆到多张卡上
- 把部分权重放到 CPU 内存里，能跑，但会慢很多
:::

## 易错点

- 只算权重，忘了 KV Cache，上线后并发一高就显存不足
- 混用 GB 和 GiB，估算差了 7% 左右
- 用注意力头数代替 KV 头数计算，GQA 模型的 KV Cache 被高估好几倍
- 把估算结果当成精确值，不留余量，也不实际测量
