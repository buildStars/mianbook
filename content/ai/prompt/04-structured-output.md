---
difficulty: 2
tags: [高频, 实践]
---

# 怎么让大模型稳定地输出 JSON？

::: tip 一句话回答
常用四种方法，前三种由弱到强：**Prompt 里写清格式并给示例**，没有保证；**JSON 模式**，保证输出是合法的 JSON，但不保证字段；**基于 JSON Schema 的结构化输出**，服务端用约束解码保证输出符合 Schema。还可以**借助工具调用**，把需要的结构定义成工具的参数，开启严格模式时同样有保证。无论用哪种方法，拿到结果后都要用 zod 等库**校验**，失败时把错误反馈给模型重试，并设置重试上限。
:::

## 详细解析

### 四种方法

| 方法 | 保证程度 | 说明 |
| --- | --- | --- |
| Prompt 约束 + 示例 | 没有保证 | 可能多出解释文字、被代码块包裹、缺字段、末尾多出逗号 |
| JSON 模式 | 语法合法 | 不保证字段和类型；有的接口要求 Prompt 里出现 "JSON" 字样 |
| 结构化输出（JSON Schema） | 符合 Schema | 服务端约束解码；支持的 Schema 关键字有限制，以各家文档为准 |
| 工具调用 | 参数通常符合 Schema，开启严格模式时有保证 | 定义一个工具，参数就是想要的结构，并要求模型必须调用它 |

能用结构化输出就优先用；模型或平台不支持时，用 Prompt 加示例，再靠校验和重试兜底。自己部署模型时，开源推理框架一般也支持按 JSON Schema 或语法规则约束生成。

### 约束解码的原理

模型每一步会输出词表上所有 token 的概率。约束解码把 Schema 编译成语法规则，生成时跟踪"当前写到了 JSON 的哪个位置"，把会导致输出不合法的 token 概率置为 0，只在剩下的 token 里采样：

```text
已生成：{"sentiment": "
Schema 规定 sentiment 只能是 positive、neutral、negative 之一
→ 下一个 token 只能是这三个值的开头，其他 token 全部被屏蔽
```

它的局限：

- 只保证格式，不保证内容正确，字段的值仍然可能是编的
- 严格的格式可能影响需要推理的任务，见下面的追问
- 输出被最大 token 数截断时，JSON 仍然不完整；模型拒绝回答时，有的接口会在单独的字段里返回拒绝信息

### 校验和重试

1. 解析 JSON；没有用 Schema 约束时，先去掉可能出现的代码块包裹
2. 用 zod 校验字段、类型和业务规则（取值范围、字段之间的关系）
3. 失败时把模型的输出和具体的错误信息一起发回去，让它修正
4. 重试有上限，仍然失败就走兜底：返回默认值、报错或转人工

Schema 可以只用 zod 定义一次：新版本的 zod 可以用 `z.toJSONSchema()` 直接转成 JSON Schema 传给接口，返回的结果再用同一个 zod Schema 校验。

### 流式场景

JSON 没有生成完时，`JSON.parse` 会报错。想边生成边展示，要用能容错的部分 JSON 解析器；工具调用的参数也是分片到达、需要拼接的，见 [流式输出中的工具调用和 JSON 怎么增量解析](/engineering/streaming/09-streaming-structured)。

## 代码示例

```ts
import { z } from 'zod'

const Review = z.object({
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  topics: z.array(z.string()).max(5),
  summary: z.string(),
})
type Review = z.infer<typeof Review>

async function analyzeReview(text: string, maxRetries = 2): Promise<Review> {
  const messages = [
    {
      role: 'system',
      content:
        '分析商品评论，只输出 JSON，不要输出其他内容。字段：sentiment（positive、neutral、negative 之一）、topics（评论涉及的主题，最多 5 个）、summary（一句话概括）。',
    },
    { role: 'user', content: `<review>\n${text}\n</review>` },
  ]

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // responseFormat 是通用写法，各家参数名不同；支持 JSON Schema 时优先传 Schema
    const res = await llm.chat({ messages, responseFormat: { type: 'json_object' } })
    const raw = res.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')

    let error: string
    try {
      const result = Review.safeParse(JSON.parse(raw))
      if (result.success) return result.data
      error = result.error.issues.map((i) => `${i.path.join('.')}：${i.message}`).join('；')
    } catch {
      error = '输出不是合法的 JSON'
    }
    // 把具体的错误告诉模型，比只说"格式不对"更容易修正
    messages.push({ role: 'assistant', content: res.content })
    messages.push({ role: 'user', content: `输出不符合要求：${error}。请修正后重新输出完整的 JSON。` })
  }
  throw new Error('结构化输出多次校验失败')
}
```

## 面试官可能追问

::: details 用了基于 Schema 的结构化输出，还需要校验吗？
需要。它只保证结构，不保证内容：值可能是编的，字段之间可能矛盾，还可能因为输出被截断或模型拒绝回答而拿不到完整的结果。业务规则（金额范围、日期先后）仍然要在代码里校验。
:::

::: details 结构化输出和用工具调用拿结构化数据，有什么区别？
结构化输出约束的是模型的最终回复，适合"每次都要这一种结构"的场景。工具调用本意是让模型请求执行动作，用来提取数据时，好处是可以定义多个工具，让模型根据输入选择用哪种结构返回。两者底层都可以用约束解码保证参数符合 Schema。
:::

::: details 字段很多、嵌套很深时输出不稳定，怎么办？
简化 Schema：减少可选字段和嵌套层级，能用枚举就用枚举，给每个字段写清楚 description。也可以拆成多次调用，每次只提取一部分字段，最后在代码里合并，见 [复杂任务怎么拆成多步 Prompt](/ai/prompt/09-prompt-chaining)。
:::

::: details 为什么强制输出 JSON 后，回答质量反而下降了？
模型要一边满足严格的格式，一边完成推理，有研究发现格式约束会影响一些推理类任务的效果；也有人复现后认为，Prompt 设计合理时影响不大，所以要在自己的任务上对比。可以在 Schema 里把分析字段放在结论字段前面，让模型先写分析再下结论；或者分两步：先自由作答，再让模型把答案转成 JSON。
:::

## 易错点

- 只在 Prompt 里写"请输出 JSON"，就直接 `JSON.parse`，不做异常处理
- 以为 JSON 模式能保证字段齐全
- 以为格式正确就说明内容正确
- 输出被最大 token 数截断导致 JSON 不完整，却没有检查结束原因
