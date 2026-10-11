---
difficulty: 3
tags: [场景题, 实践]
---

# 流式连接断了，怎么续传？

::: tip 一句话回答
SSE 的每个事件可以带一个 `id`，重连时把最后收到的 ID 告诉服务端，服务端从这个位置之后补发。浏览器的 EventSource 会自动带上 `Last-Event-ID` 请求头，自己用 fetch 实现时要手动带。前提是**生成任务和连接解耦**：连接断了，后台继续生成，内容按顺序写进缓存（如 Redis），重连只是"从某个位置开始读"。再用**请求 ID 保证幂等**，重试时接回已有的任务，而不是重新生成。代价是存储、复杂度，以及"断开连接不再等于停止"带来的取消和清理问题。
:::

## 详细解析

### 为什么默认的做法续不上

默认的流式接口里，生成和连接绑在一起：请求进来就调用模型，连接断开就中止生成（见[停止生成时前后端怎么配合](/engineering/streaming/04-abort)）。网络一抖，用户只能重新提问，之前的 token 白花了。移动端尤其常见：Wi-Fi 切到移动网络、进电梯、锁屏切到后台，都可能断开连接。

### 把生成和连接解耦

```text
POST /api/chat（带 requestId）
  已有这个 requestId 的任务：直接返回，不重复生成
  没有：创建任务，后台开始生成，每个片段追加到 Redis Stream，自动得到递增的条目 ID

GET /api/chat/:requestId/events（可以带 Last-Event-ID）
  先补发这个 ID 之后已有的片段，再阻塞等待新片段，直到读到结束标记

任务结束：写入结束标记，全文保存到数据库，缓存设置过期时间
```

- **事件 ID**：Redis Stream 的条目 ID 本身是递增的，直接用作 SSE 的 `id`
- **幂等**：`requestId` 由前端在发送消息时生成（如 UUID），重试、重复点击都带同一个，服务端据此判断任务是否已经存在
- **多实例**：重连可能落到另一台服务器上，内容必须放在共享存储里，不能放在某个进程的内存中
- **刷新页面**：前端把进行中的 `requestId` 存进 sessionStorage，或者加载会话时由服务端告知"有一条消息还在生成"，再重新订阅

### 代价

- **存储**：每个片段都要写一次缓存，必须设置过期时间
- **取消变复杂**：断开连接不再意味着停止，用户点停止时要调用单独的取消接口，再通过发布订阅通知正在生成的实例
- **孤儿任务**：用户真的离开了，任务还在生成、还在计费。可以规定一段时间内没有任何连接在读，就中止任务
- **任务的可靠性**：生成跑在 Web 进程里，进程重启（比如发布新版本）任务就丢了。要求更高时，放进任务队列，由独立的 worker 执行

很多产品不做完整的续传：断开后保留已显示的内容，提供"重新生成"按钮；或者让后台把这次生成跑完，用户刷新后从数据库读到完整的回答。先评估断线的频率和损失，再决定做到哪一步。

## 代码示例

服务端（Express + ioredis，省略了鉴权：订阅前要校验这个任务属于当前用户）：

```js
app.post('/api/chat', async (req, res) => {
  const { requestId, messages } = req.body
  // NX：只有第一次请求能创建任务，重试的请求不会重复生成
  const created = await redis.set(`chat:task:${requestId}`, 'running', 'EX', 3600, 'NX')
  if (created) generate(requestId, messages) // 不等待，后台执行
  res.json({ requestId })
})

async function generate(requestId, messages) {
  const key = `chat:${requestId}`
  try {
    for await (const delta of streamLLM(messages)) {
      await redis.xadd(key, '*', 'type', 'delta', 'text', delta)
    }
    await redis.xadd(key, '*', 'type', 'done')
  } catch {
    await redis.xadd(key, '*', 'type', 'error')
  } finally {
    await redis.expire(key, 3600) // 一小时后自动清理
  }
}

app.get('/api/chat/:id/events', async (req, res) => {
  const key = `chat:${req.params.id}`
  let lastId = req.get('Last-Event-ID') || '0' // 0 表示从头读
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  const reader = redis.duplicate() // XREAD BLOCK 会阻塞所在的连接，每个读者用单独的连接
  let closed = false
  res.on('close', () => {
    closed = true
    reader.disconnect()
  })
  try {
    while (!closed) {
      const result = await reader.xread('BLOCK', 15000, 'STREAMS', key, lastId)
      if (!result) {
        res.write(': ping\n\n') // 15 秒没有新内容，发一次心跳
        continue
      }
      for (const [id, fields] of result[0][1]) {
        const [, type, , text] = fields // ['type', 'delta', 'text', '...']
        res.write(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify({ text })}\n\n`)
        lastId = id
        if (type !== 'delta') return // 读到结束标记
      }
    }
  } catch {
    // 客户端断开时 reader 被关闭，阻塞中的读取会抛错
  } finally {
    reader.disconnect()
    res.end()
  }
})
```

前端用 fetch 重连时，要记录最后的事件 ID 并手动带上（前提是解析函数也解析了 `id` 字段）：

```js
const res = await fetch(`/api/chat/${requestId}/events`, {
  headers: lastEventId ? { 'Last-Event-ID': lastEventId } : {},
})
```

## 面试官可能追问

::: details 用 EventSource 的话，需要做什么？
EventSource 天然支持这套机制：服务端给每个事件写 `id`，断线后浏览器自动重连，并带上 `Last-Event-ID` 请求头。订阅接口是 GET，正好配合"先 POST 创建任务、再 GET 订阅"的设计。收到结束事件后要调用 `close()`，否则它会继续重连（见 [EventSource 有哪些限制](/engineering/streaming/03-eventsource-limits)）。
:::

::: details 不用 Redis Stream，用 List 或数据库可以吗？
可以。本质是一份"按顺序追加、能从某个位置往后读"的日志。用 List 时，用下标当事件 ID，`LRANGE` 补发，新内容通过发布订阅通知；用数据库时，按自增序号查询。Redis Stream 的好处是自带递增 ID 和阻塞读取，补发和实时推送用同一个命令就能完成。
:::

::: details 续传和"继续生成"是一回事吗？
不是。续传时生成并没有中断，只是连接断了，补发的是服务端已经生成好的内容，不产生新的费用。"继续生成"是生成本身停了（达到长度上限、用户停止、出错），要再调用一次模型，把已有的内容作为上下文让它接着写，会产生新的费用，衔接也不一定自然。
:::

## 易错点

- 只在前端做重连，服务端没有缓存内容，重连后只能重新生成，还可能重复扣费
- 没有幂等：前端超时重试，服务端又创建了一个任务，同一个问题生成了两遍
- 订阅接口不校验任务归属，知道 requestId 的人都能读到别人的回答
- 缓存不设过期时间，已经结束的任务内容一直占着内存
