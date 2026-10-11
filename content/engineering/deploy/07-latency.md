---
difficulty: 2
tags: [高频, 性能优化]
---

# 首 Token 延迟高怎么优化？

::: tip 一句话回答
衡量生成速度有两个指标：**TTFT**（首 token 延迟，从发出请求到收到第一个 token）和**每个输出 token 的间隔**（TPOT）。TTFT 主要受**输入长度**（模型要先把全部输入处理一遍，即 prefill）、**排队**和**网络**影响；在应用里，还要加上检索、问题改写等准备工作的耗时。优化方向：缩短 Prompt、利用提示缓存、换更小更快的模型、就近部署、准备工作并行执行，再用流式输出和进度提示改善体验。输出阶段则主要靠减少输出长度和更快的模型或推理服务。
:::

## 详细解析

### 两个指标

```text
TTFT = 应用的准备工作（鉴权、查历史、检索、重排、改写）+ 网络 + 排队 + prefill
总耗时 ≈ TTFT + TPOT × (输出 token 数 - 1)
```

- TTFT 决定用户"多久看到反应"，TPOT 决定"字出来得多快"。流式输出时，TTFT 对体验的影响更大
- 推理模型在回答之前要先思考，用户看到正文的第一个字可能要等很久

### TTFT 的来源和优化

| 来源 | 原因 | 优化 |
| --- | --- | --- |
| 输入长度 | prefill 要处理全部输入 token，输入越长越慢 | 精简系统提示和历史消息；检索结果重排后只留最相关的几条 |
| 重复的前缀 | 每次都重新计算同样的系统提示、工具定义 | 提示缓存，命中的部分跳过计算（见 [Prompt Caching](/engineering/deploy/04-prompt-caching)） |
| 模型 | 模型越大，prefill 越慢 | 简单任务路由到更小、更快的模型 |
| 排队 | 供应商负载高、触发限流、自部署的算力不足 | 提高限额、扩容；自部署时调整调度策略，优先保证延迟 |
| 网络 | 跨地区访问；每次都新建 TLS 连接 | 部署在模型服务所在的地区附近；复用到上游的连接（见 [keep-alive](/basics/network/16-keepalive)） |
| 准备工作 | 查历史、检索、重排、问题改写串行执行 | 互不依赖的步骤并行；问题改写这类前置的模型调用用小模型，或者去掉 |
| 推理模型的思考 | 正文之前有很长的思考过程 | 简单问题不用推理模型；接口支持时，调低思考的力度或预算 |

### 体验上的优化

- 一定要流式输出，第一个字出来就开始显示
- 准备阶段就开始推送进度，比如"正在检索资料""找到 5 篇相关文档"，比白屏等待感觉快得多
- 推理模型可以展示思考过程的摘要或进度

### 输出阶段

TPOT 受模型大小、服务负载和硬件的影响。应用侧能做的主要是减少输出的 token 数（要求简洁、限制长度、用结构化输出代替长篇说明），或者换更小、更快的模型；自部署时还可以用量化、推测解码等手段，见 [vLLM 这类推理框架为什么能提升吞吐](/engineering/deploy/06-inference-engines)。

## 代码示例

分阶段记录耗时，准备工作并行执行（`startSSE`、`send` 是写 SSE 的辅助函数）：

```js
app.post('/api/chat', async (req, res) => {
  const t0 = performance.now()
  const user = await auth(req)
  startSSE(res)
  send(res, 'status', { text: '正在检索资料' }) // 准备阶段先给用户反馈

  // 互不依赖的准备工作并行执行
  const [history, docs] = await Promise.all([
    loadHistory(req.body.conversationId, user),
    retrieve(req.body.question, user),
  ])
  const t1 = performance.now()

  let firstTokenAt = 0
  for await (const delta of streamLLM(buildMessages(history, docs, req.body.question))) {
    firstTokenAt ||= performance.now()
    send(res, 'delta', { text: delta })
  }
  send(res, 'done', {})
  res.end()

  // 按阶段记录，监控时看 P50、P95
  logger.info({
    prepareMs: t1 - t0, // 应用自己的准备工作
    modelTtftMs: firstTokenAt - t1, // 模型的首 token 延迟（含网络和排队）
    ttftMs: firstTokenAt - t0, // 用户感受到的首 token 延迟
    totalMs: performance.now() - t0,
  })
})
```

## 面试官可能追问

::: details 为什么输入越长，TTFT 越高？
输出第一个 token 之前，模型要把全部输入处理一遍（prefill）。prefill 虽然可以并行计算，但计算量随输入长度增长，其中注意力的部分随长度平方增长，长文档、长历史时这部分耗时很明显。提示缓存能跳过相同前缀的计算，所以对长前缀的效果最好。
:::

::: details TTFB 很小，TTFT 却很大，是怎么回事？
TTFB 是收到响应的第一个字节，TTFT 是收到第一个 token。很多服务会先发出响应头、心跳或进度事件，所以 TTFB 很快，但模型可能还在排队或处理输入。排查 TTFT 要在应用里打点，记录收到第一个 token 的时间，而不是看浏览器里的 TTFB（见[接口请求很慢怎么排查](/basics/network/19-slow-request)）。
:::

::: details 怎么监控延迟？
按模型、功能、地区统计 TTFT、TPOT 和总耗时的 P50、P95，并单独记录准备阶段的耗时。TTFT 突然升高时，先看是输入变长了（Prompt 改动、历史没有截断），还是上游在排队或限流。设置告警阈值，详见 [LLM 应用的可观测性](/engineering/eval/06-observability)。
:::

## 易错点

- 只看平均值，P95 的长尾才是用户抱怨的来源
- 把 TTFB 当成 TTFT
- 为了提升效果加了问题改写、重排等步骤，全部串行执行，TTFT 被越拖越长
- 只盯着模型调用，忽略了应用自己的准备工作，它们可能占了 TTFT 的一大半
