---
difficulty: 2
tags: [场景题, 实践]
---

# 一个页面同时有多路流式回答，前端怎么管理？

::: tip 一句话回答
把每一路流当成一个独立的**任务**，用 id 作 key 存在一个 Map 里，每个任务有自己的状态、缓冲区和 **AbortController**。增量文本先写进缓冲区，再用 `requestAnimationFrame` **合帧渲染**，避免几路流一起刷新把页面卡住。还要注意**连接数**：HTTP/1.1 下浏览器对同一域名的并发连接有上限，多路流最好走 HTTP/2，或者在前端限制并发。切换会话、关闭面板、组件卸载时，要按 id 中断并清理对应的流。
:::

## 详细解析

### 哪些场景会有多路流

- 同一个问题让几个模型同时回答，左右对比
- 一次生成多个候选（多个标题、多版文案），用户挑一个
- 多个会话标签页，后台的会话还在生成
- Agent 的几个子任务并行执行，各自输出进度

单路流的写法（见 [fetch 接收流式响应](/engineering/streaming/02-fetch-stream)）复制几份就能跑，但很快会遇到三个问题：状态互相串、页面卡、停不干净。

### 用任务表管理状态

每一路流对应一条记录：

| 字段 | 作用 |
| --- | --- |
| id | 唯一标识，前端生成，也作为请求参数传给后端，方便日志对齐 |
| status | pending / streaming / done / error / aborted |
| text | 已收到的全部文本 |
| controller | 这一路自己的 AbortController |

所有增量都按 id 写进对应记录，不用共享的"当前回答"变量。回调里一定要先检查这条记录还在不在、是不是同一次请求：用户点了"重新生成"后，旧请求的数据晚到一步，不能写进新记录。常见做法是每次开始生成时给记录换一个新的 requestId，回调里对比。

### 渲染：合帧而不是每个 chunk 都刷新

三路流各自每秒几十个 chunk，每个 chunk 都触发一次响应式更新和 Markdown 重渲染，主线程很快就忙不过来。做法是：

1. chunk 到达时只追加到缓冲区，把这一路标记为"脏"
2. 用一个全局的 `requestAnimationFrame` 循环，每帧把所有脏的流一次性提交到视图
3. 不在视口内的流（被折叠、在后台标签）只更新数据，不渲染，切回来再渲染一次

Markdown 增量渲染的细节见 [流式 Markdown 渲染](/engineering/streaming/05-markdown-streaming)。

### 连接数和并发

- HTTP/1.1 下，浏览器对同一个域名的并发连接通常只有 6 个左右，几路长连接加上普通请求很容易排队，表现为"第 N 路一直不开始"
- HTTP/2 在一个连接上多路复用，这个问题基本消失，所以流式接口的网关最好开 HTTP/2
- 后端和模型 API 也有并发和限流（见 [限流、重试和降级](/engineering/deploy/08-rate-limit-fallback)），前端最好也设一个并发上限，超出的任务排队，状态显示为 pending

### 生命周期和清理

- 单路停止：调用这一路的 `controller.abort()`，后端感知断开后停止调用模型（见 [中断生成](/engineering/streaming/04-abort)）
- 切换会话或卸载组件：遍历任务表，把还在 streaming 的全部 abort
- 后台会话要不要继续生成是产品决策：继续生成就不能和组件生命周期绑定，任务表要放到全局 store 里

## 代码示例

```js
// 多路流的任务管理器：每路独立状态和中断，渲染合帧
class StreamManager {
  constructor(render, schedule = (fn) => requestAnimationFrame(fn)) {
    this.tasks = new Map()
    this.dirty = new Set()
    this.render = render // (id, task) => void，真正更新视图
    this.schedule = schedule
    this.frameRequested = false
  }

  async start(id, run) {
    this.stop(id) // 同一个 id 重新生成时，先停掉旧的
    const controller = new AbortController()
    const requestId = Symbol(id)
    const task = { status: 'streaming', text: '', controller, requestId }
    this.tasks.set(id, task)
    try {
      await run(controller.signal, (delta) => {
        // 旧请求晚到的数据直接丢弃
        if (this.tasks.get(id)?.requestId !== requestId) return
        task.text += delta
        this.markDirty(id)
      })
      if (task.status === 'streaming') task.status = 'done'
    } catch (err) {
      task.status = err.name === 'AbortError' ? 'aborted' : 'error'
    }
    this.markDirty(id)
  }

  stop(id) {
    const task = this.tasks.get(id)
    if (task?.status === 'streaming') {
      task.status = 'aborted'
      task.controller.abort()
    }
  }

  stopAll() {
    for (const id of this.tasks.keys()) this.stop(id)
  }

  markDirty(id) {
    this.dirty.add(id)
    if (this.frameRequested) return
    this.frameRequested = true
    this.schedule(() => {
      this.frameRequested = false
      for (const d of this.dirty) this.render(d, this.tasks.get(d))
      this.dirty.clear()
    })
  }
}
```

`run` 里放实际的 fetch 和流解析逻辑，把 `signal` 传给 fetch，每解析出一段文本就调用一次回调。

## 面试官可能追问

::: details 几路流能不能共用一个连接？
可以。后端把多路输出复用到一条 SSE 或 WebSocket 上，每条消息带上流的 id，前端按 id 分发。好处是不受连接数限制，代价是协议变复杂：要自己处理单路中断（发一条取消消息而不是断开连接）和单路出错。开了 HTTP/2 的话，多个独立请求通常就够用。
:::

::: details 对比模式下，一路很快一路很慢怎么办？
各自独立渲染，不要等齐了再显示。界面上标出每路的状态和耗时。用户选定其中一个答案后，可以主动中断其他还在生成的路，省 token。
:::

::: details 用 Vue 或 React 的响应式状态直接存 text 有什么问题？
每次追加都会触发更新，几路一起就是高频重渲染。大段文本可以放在非响应式的缓冲区里，按帧同步到响应式状态；AbortController 这类对象也不需要做成响应式。
:::

## 易错点

- 用一个全局的"当前回答"变量接收多路数据，导致内容串到别的回答里
- 重新生成时没处理旧请求的回调，旧数据写进了新回答
- 只在前端 abort，后端没感知断开，模型还在后台生成、照样计费
- HTTP/1.1 下没限制并发，第 N 路流一直排队，误以为是后端慢
