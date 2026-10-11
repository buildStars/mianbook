---
difficulty: 2
tags: [高频, 原理]
---

# Function Calling（工具调用）的完整流程是怎样的？

::: tip 一句话回答
模型本身**不执行**任何函数。流程是：开发者把工具的名称、描述和参数的 JSON Schema 传给模型；模型判断需要调用时，返回"调用哪个工具、参数是什么"；**应用代码**执行工具，把结果作为新消息回传给模型；模型根据结果继续推理，直到给出最终回答。
:::

## 详细解析

### 一次完整的调用

```text
用户：北京今天要带伞吗？
  ↓
应用 → 模型：对话消息 + 工具列表（get_weather 的定义）
  ↓
模型 → 应用：调用 get_weather，参数 {"city": "北京"}
  ↓
应用执行 get_weather，得到 {"weather": "小雨", "temp": 18}
  ↓
应用 → 模型：把工具结果追加到对话里
  ↓
模型 → 应用：北京今天有小雨，建议带伞。
```

### 代码示例

各家 SDK 的字段名不同，下面是通用写法：

```js
const tools = [
  {
    name: 'get_weather',
    description: '查询指定城市今天的天气。用户问天气、穿衣、出行建议时使用。',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名，如：北京' },
      },
      required: ['city'],
    },
  },
]

async function chat(userInput) {
  const messages = [{ role: 'user', content: userInput }]

  // 限制最大轮数，防止模型反复调用工具陷入死循环
  for (let step = 0; step < 10; step++) {
    const res = await llm.chat({ messages, tools })
    messages.push(res.message)

    // 没有工具调用，说明这就是最终回答
    if (!res.toolCalls?.length) return res.message.content

    for (const call of res.toolCalls) {
      const result = await runTool(call.name, call.arguments) // 执行前要校验参数
      messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(result) })
    }
  }
  throw new Error('工具调用轮数超过上限')
}
```

### 工具描述决定调用质量

- `description` 写清楚工具做什么、什么时候用、什么时候不要用
- 参数用 `enum`、格式说明等约束取值范围
- 工具太多时模型容易选错，可以按场景动态挑选要提供的工具

## 面试官可能追问

::: details 模型返回的参数一定合法吗？
不一定。可能缺字段、类型不对，甚至编造参数值。执行前要按 Schema 校验。部分平台提供严格模式，可以保证输出的参数符合 Schema。
:::

::: details 多个工具调用可以并行吗？
可以。很多模型支持一次返回多个工具调用，互相没有依赖的调用可以并发执行，等结果全部回传后模型再继续。
:::

::: details 工具执行失败了怎么办？
把错误信息作为工具结果返回给模型，让它决定重试、换一个工具，还是告诉用户。同时给工具设置超时，给整个循环设置最大轮数。
:::

::: details 转账、删除数据这类敏感操作怎么处理？
不要让模型直接执行。执行前加人工确认，工具按最小权限设计，并记录完整的调用日志。
:::

## 易错点

- 不要说"模型调用了 API"。准确的说法是：模型**提出**调用请求，应用**执行**调用
- 工具返回的结果会占用上下文，返回内容要尽量精简
