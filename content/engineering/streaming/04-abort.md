---
difficulty: 2
tags: [高频, 实践]
---

# 点击停止生成时，前后端怎么配合中断？

::: tip 一句话回答
前端用 **AbortController** 取消 fetch，浏览器会断开这条连接。服务端要**监听连接关闭**，再把 **AbortSignal** 传给请求大模型的上游调用，把上游连接也断掉，否则模型会在后台继续生成，照样消耗 token。中断后，已经生成的内容保不保存、算不算一次调用，要提前定好规则。前端还要处理**竞态**：旧请求迟到的回调不能改动新请求的状态。
:::

## 详细解析

### 整条链路

```text
用户点"停止"
  → 前端 controller.abort()：fetch 或 reader.read() 抛出 AbortError，浏览器断开连接
  → 服务端感知到连接关闭（Node.js 中是 res 的 close 事件）
  → 服务端 abort 上游请求，和模型服务之间的连接被关闭
  → 模型服务停止生成
```

只做了第一步是最常见的问题：页面上看起来停了，服务端却还在接收模型的输出，直到生成完毕。

### 服务端怎么感知断开

- Node.js 原生 http 和 Express：监听 `res.on('close')`。正常结束时它也会触发，用 `res.writableFinished` 区分，为 false 说明响应还没写完连接就断了
- 不要用 `req.on('close')`：在较新的 Node.js 版本中，请求体读完它就会触发，不代表客户端断开了
- 拿到断开信号后调用 `controller.abort()`，把 signal 传给上游的 fetch；官方 SDK 一般也支持在请求选项里传入 signal

### 中断后的策略

| 问题 | 常见做法 |
| --- | --- |
| 已生成的内容要不要保存 | 保存，并标记为"已停止"。刷新后还能看到停在哪里，也可以基于它继续对话 |
| 算不算用户的一次调用 | 模型已经开始输出，一般计入；还没开始输出就取消的，可以不计入用户的次数，但上游可能已经按输入计费 |
| token 用量怎么记 | 流式接口通常在最后才返回完整的用量，中途中断就拿不到，要按已生成的文字用分词器估算 |
| 上游还会继续计费吗 | 连接断开后上游一般会停止生成，已生成的部分照常计费，具体以供应商的说明为准 |

### 前端的竞态

用户点了停止，紧接着又发了一条新消息。旧请求的 `catch`、`finally` 可能在新请求开始之后才执行，把新请求的 loading 状态清掉，或者把旧内容追加到新回答里。解决办法：每次请求用自己的 controller，回调里先判断"我还是不是当前的请求"，不是就什么都不做。

## 代码示例

前端（`readSSE` 见[前端怎么用 fetch 解析流式响应](/engineering/streaming/02-fetch-stream)）：

```js
let current = null // 当前这次生成的 AbortController

async function send(messages, state) {
  current?.abort() // 发新消息前，先中断还没结束的上一次
  const controller = new AbortController()
  current = controller
  state.streaming = true
  state.text = ''
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`请求失败（${res.status}）`)
    for await (const { event, data } of readSSE(res.body)) {
      if (controller !== current) return // 已经被新请求取代
      if (event === 'error') throw new Error(JSON.parse(data).message)
      if (event === 'message') state.text += JSON.parse(data).text // 结束事件 done 不追加内容
    }
  } catch (err) {
    // 用户主动停止不算出错
    if (err.name !== 'AbortError' && controller === current) state.error = '生成失败，请重试'
  } finally {
    if (controller === current) {
      state.streaming = false
      current = null
    }
  }
}

const stop = () => current?.abort()
```

服务端（Express，`streamLLM` 是请求上游流式接口的异步生成器，实现见[服务端转发](/engineering/streaming/08-server-relay)）：

```js
app.post('/api/chat', async (req, res) => {
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) controller.abort() // 客户端提前断开
  })

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  let text = ''
  let status = 'completed'
  try {
    // signal 一路传到上游请求，abort 时上游连接随之断开
    for await (const delta of streamLLM(req.body.messages, controller.signal)) {
      text += delta
      res.write(`data: ${JSON.stringify({ text: delta })}\n\n`)
    }
    res.write('event: done\ndata: {}\n\n')
  } catch {
    status = controller.signal.aborted ? 'stopped' : 'failed'
    if (status === 'failed') res.write(`event: error\ndata: ${JSON.stringify({ message: '生成失败' })}\n\n`)
  } finally {
    res.end()
    // 中途停止的内容也保存，并标明状态
    if (text) await saveMessage({ text, status }).catch(console.error)
  }
})
```

## 面试官可能追问

::: details 多实例部署时，"停止"会不会打到另一台机器上？
如果停止靠的是断开连接，就不会有这个问题：连接断在哪台机器上，哪台机器就能感知到。但如果生成任务和连接是解耦的（比如为了断线续传，连接断开后任务继续执行），就需要单独的取消接口：把"取消任务 X"的消息通过 Redis 发布订阅等方式广播出去，正在执行这个任务的实例收到后再中止，见[断线续传](/engineering/streaming/10-resume)。
:::

::: details 用户关掉页面，和点停止有区别吗？
对服务端来说都是连接断开。区别在产品策略上：点停止是明确的意图，内容标记为"已停止"；关页面、断网可能只是意外，有的产品会让生成在后台继续，用户回来时能看到完整的回答，这就需要续传那一套设计。
:::

::: details 只在前端停止渲染，不断开连接，可以吗？
不可以。那样只是用户看不到了，服务端和模型仍在工作：token 继续计费，服务端的连接和内存一直被占用，并发高的时候会拖垮服务。中断必须一直传递到最上游。
:::

## 易错点

- 只在前端 abort，服务端没把 signal 传给上游，模型照样生成到结束
- 用 `req.on('close')` 判断客户端断开，结果请求一开始就触发了
- 把 AbortError 当成失败，用户主动停止时也弹出"出错了"
- 中断后没有保存已生成的内容，用户刷新页面后回答消失了
