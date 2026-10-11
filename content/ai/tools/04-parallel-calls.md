---
difficulty: 2
tags: [实践, 性能优化]
---

# 并行工具调用和多轮工具调用怎么处理？

::: tip 一句话回答
**并行调用**是模型在一次回复里返回多个互不依赖的工具调用，应用可以并发执行，用 `Promise.allSettled` 保证一个失败不影响其他结果，每个结果都要**按调用 id 回传**。**多轮调用**是后一个调用依赖前一个的结果，只能执行完一轮、把结果交给模型，再由模型发起下一轮。并发执行时要限制并发数、给每个调用设超时，有副作用的写操作不要随意并发。
:::

## 详细解析

### 两种情况的区别

```text
并行：用户问"北京、上海、广州明天天气怎么样"
  模型一次返回 3 个调用：get_weather(北京)、get_weather(上海)、get_weather(广州)
  应用并发执行 → 3 个结果一起回传 → 模型汇总回答

多轮：用户问"我最近一笔订单到哪了"
  第 1 轮：search_orders() → 拿到订单号 O123
  第 2 轮：track_shipment(O123) → 拿到物流信息
  第 3 轮：模型根据物流信息回答
```

哪些调用放在同一轮，由**模型**根据依赖关系决定；收到多个调用后要不要真的并发执行，由**应用**决定。

### 并行调用的处理要点

1. **用 `Promise.allSettled`，不用 `Promise.all`**：`Promise.all` 只要有一个失败就整体失败，已经成功的结果也拿不到
2. **每个调用都要回传结果**：多数接口要求模型发起的每个调用都有对应 id 的结果，缺一个，下一次请求就会报错。失败的调用也要回传，写清错误原因
3. **按 id 对应，不靠顺序**：有的接口要求把多个结果放进同一条消息，有的是每个结果一条消息，按所用 SDK 的格式组装
4. **限制并发数**：模型可能一次返回十几个调用，下游接口有限流，要用并发池控制同时执行的数量
5. **每个调用设超时**：一个慢调用会拖住整轮，超时后按失败回传

### 有副作用的调用不要随意并发

两个只读查询并发执行没有问题。但如果模型同时发起"改文件 A 的第 10 行"和"改文件 A 的第 20 行"，或者两笔扣款，并发执行可能互相覆盖、超出余额。常见做法：

- 给工具标记只读或有副作用，只读的并发执行，有副作用的按顺序执行
- 必要时用接口参数关闭并行调用，让模型一次只发起一个

### 多轮调用的代价

每多一轮就多一次完整的模型调用，延迟和 token 都会累加，上下文也越来越长。减少轮数的办法：

- 把总是连着用的操作合并成一个工具，比如 `get_latest_order_shipment()` 一步拿到最近订单的物流
- 在系统提示里鼓励模型把互不依赖的调用放在同一轮
- 把肯定用得到的信息（如当前用户的基本资料）提前放进上下文，省掉一次查询

## 代码示例

通用写法，不绑定具体 SDK：

```ts
// llm.chat 是伪接口，返回 { message, toolCalls }，各家 SDK 的字段名不同
// toolCalls 每项是 { id, name, arguments }，arguments 是模型生成的 JSON 字符串
// registry 是工具注册表：Map<工具名, { readOnly, execute(args, { signal }) }>

// 并发池：最多同时执行 limit 个，返回格式和 Promise.allSettled 一致
async function settleWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) }
      } catch (reason) {
        results[i] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function executeToolCalls(calls: ToolCall[]) {
  // 全是只读工具才并发，有写操作就逐个执行
  const limit = calls.every((c) => registry.get(c.name)?.readOnly) ? 5 : 1
  const settled = await settleWithLimit(calls, limit, async (call) => {
    const tool = registry.get(call.name)
    if (!tool) throw new Error(`不存在工具 ${call.name}`)
    const args = JSON.parse(call.arguments) // 解析失败也只算这一个调用失败
    // 10 秒后 signal 触发中断，工具内部要把它传给 fetch、数据库查询等
    return tool.execute(args, { signal: AbortSignal.timeout(10_000) })
  })
  // 每个调用都回传一条结果，失败的也不能漏
  return calls.map((call, i) => {
    const r = settled[i]
    const content =
      r.status === 'fulfilled'
        ? (JSON.stringify(r.value) ?? '执行成功')
        : `调用失败：${r.reason instanceof Error ? r.reason.message : String(r.reason)}`
    return { role: 'tool', toolCallId: call.id, content }
  })
}
```

主循环和 [Function Calling 的完整流程](/ai/tools/01-function-calling) 一样，只是把逐个执行改成 `messages.push(...(await executeToolCalls(res.toolCalls)))`。如果工具实现不响应 `signal`，可以再用 `Promise.race` 加一个定时器兜底，保证这一轮不会卡住。

## 面试官可能追问

::: details 模型怎么知道哪些调用可以并行？
由模型根据语义判断：后一个调用需要前一个的结果，就得等下一轮。但模型也会判断错，比如在同一轮里拿一个猜出来的订单号去查物流。所以执行前要校验参数，工具描述里也可以写明"订单号需要先通过 search_orders 获取"。
:::

::: details 并行调用中有一个失败了，要不要整轮重试？
不要。成功的结果照常回传，失败的回传错误信息，由模型决定要不要只重试失败的那个。整轮重试会把成功的调用再执行一遍，其中如果有写操作，就会重复执行。网络抖动、限流这类暂时性错误，可以在工具内部自动重试，见 [工具调用出错了怎么处理](/ai/tools/05-tool-errors)。
:::

::: details 多轮工具调用太慢，怎么优化？
每一轮都要等模型生成完工具调用，再等工具执行完。优化方向：合并常用的连续操作，减少轮数；能并行的尽量放在同一轮；精简工具结果，减少下一轮的输入；用流式输出把"正在查询物流"这样的中间状态展示给用户，降低等待感。
:::

::: details 流式输出时，并行的工具调用是怎么返回的？
参数是分成很多片段陆续到达的，多个调用的片段还可能交错，要按调用的序号分别拼接，全部结束后再解析 JSON 并执行。具体写法见 [流式输出中的工具调用怎么增量解析](/engineering/streaming/09-streaming-structured)。
:::

## 易错点

- 用 `Promise.all` 并发执行，一个工具报错导致整轮结果全部丢失
- 只回传成功的结果，漏掉失败调用的 id，下一次请求直接报错
- 有副作用的写操作也不加区分地并发执行
