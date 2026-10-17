---
difficulty: 2
tags: [原理, 实践]
---

# MCP 里耗时很长的工具怎么报告进度？怎么取消？

::: tip 一句话回答
**进度**：Client 在请求的 `_meta` 里放一个 `progressToken`，Server 处理期间发 `notifications/progress`，带上 `progress`（必须递增）、可选的 `total` 和 `message`。**取消**：2026-07-28 版规范按传输方式区分，Streamable HTTP 下**关闭这个请求的响应流就是取消**，stdio 下发 `notifications/cancelled` 并带上请求 id；取消和完成可能同时发生，双方都要容忍这种竞态。请求要设超时，收到进度可以重置空闲超时，但总时长要有上限。真正要跑几分钟以上的任务，改成**先返回任务句柄、再轮询状态**的异步模式。
:::

## 详细解析

### 进度通知

Client 想要进度，就在请求里带一个 token；不带就表示不需要：

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "build_report",
    "arguments": { "month": "2026-09" },
    "_meta": { "progressToken": "job-7" }
  }
}
```

Server 可以按自己的节奏发：

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/progress",
  "params": { "progressToken": "job-7", "progress": 40, "total": 100, "message": "已处理 40/100 个文件" }
}
```

规则不多但容易忽略：

- token 是字符串或整数，由 Client 生成，在所有进行中的请求里唯一
- `progress` 每次都要比上次大，即使不知道 `total`；两个值都可以是小数
- Server 可以完全不发进度，也可以省略 `total`；请求完成后不能再发这个 token 的进度
- 双方都应该限流，进度发得太密只会浪费带宽和渲染
- 2026-07-28 版里，进度这类和某个请求相关的通知走**这个请求自己的响应流**，不走 `subscriptions/listen` 的订阅流

### 取消：两种传输不一样

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/cancelled",
  "params": { "requestId": 7, "reason": "用户点了停止" }
}
```

| 传输方式 | 2026-07-28 版 | 2025-11-25 及更早 |
| --- | --- | --- |
| Streamable HTTP | 关闭该请求的 SSE 响应流即取消，不需要再发 `notifications/cancelled` | 断开连接不算取消，要显式发 `notifications/cancelled` |
| stdio | 发 `notifications/cancelled`，引用请求 id | 同左 |

新版这样改，是因为协议变成无状态的（见 [MCP 架构](/ai/tools/06-mcp-architecture)），一个请求的生命周期就是它那条响应流；同时去掉了用 `Last-Event-ID` 续传的能力，流断了请求就丢了，Client 要用新的请求 id 重新发起。所以断线重试前要想清楚工具有没有副作用（见 [幂等工具](/ai/tools/15-idempotent-tools)）。

Server 收到取消后应该停止处理、释放资源、不再发送响应；请求不存在或已经完成时可以忽略。Client 取消后收到的迟到响应应该丢弃。前端怎么把"停止"按钮接到这条链路上，可以参考 [中断流式生成](/engineering/streaming/04-abort)。

### 竞态：取消和完成撞在一起

取消通知在网络上走的时候，Server 可能已经处理完、响应已经发出。所以：

- Server 不能假设"收到取消时一定还没做"，有副作用的操作要么做完再检查取消，要么在关键步骤前检查一次，不要做到一半留下脏数据
- Client 不能假设"发了取消就一定没执行"，界面上要能表达"已请求取消，结果以最终状态为准"
- 已经执行的写操作，取消不会回滚，要靠业务层补偿

### 超时

每个发出的请求都应该有超时，SDK 应该允许按请求单独配置。超时后按传输方式取消请求。可以在收到进度时重置计时，因为有进度说明还在干活；但必须另设一个总时长上限，防止一个不停发进度却永不结束的 Server 把连接一直占着：

```js
// 收到进度就重置空闲超时，但总时长有上限
function createRequestTimer({ idleMs, maxMs, onTimeout }) {
  const start = Date.now()
  let timer
  const arm = () => {
    clearTimeout(timer)
    const left = maxMs - (Date.now() - start)
    timer = setTimeout(onTimeout, Math.min(idleMs, Math.max(0, left)))
  }
  arm()
  return {
    onProgress: arm, // 收到 notifications/progress 时调用
    done: () => clearTimeout(timer),
  }
}

// 模拟：每 80ms 来一次进度，空闲超时 100ms，总上限 300ms
const begin = Date.now()
const timer = createRequestTimer({
  idleMs: 100,
  maxMs: 300,
  onTimeout: () => {
    clearInterval(tick)
    // HTTP：关闭这个请求的响应流；stdio：发 notifications/cancelled
    console.log('超时取消，耗时约', Math.round((Date.now() - begin) / 100) * 100, 'ms')
  },
})
const tick = setInterval(() => timer.onProgress(), 80)
```

### 更长的任务：改成异步

几分钟到几小时的任务，一直挂着一个请求很脆弱：网关超时、连接中断、用户关掉页面都会让它丢掉。更稳的做法是工具立即返回一个任务 ID，再提供查询状态和取消的工具，或者用规范的 tasks 扩展。2026-07-28 版把原来在核心协议里实验性的 tasks 移到了官方扩展 `io.modelcontextprotocol/tasks`，用 `tasks/get` 轮询取代了原来阻塞等待的 `tasks/result`。不确定目标 Client 是否支持扩展时，用普通工具实现"提交、查询、取消"三件套兼容性最好。

## 面试官可能追问

::: details 进度百分比在前端怎么展示比较好？
有 `total` 就显示进度条，没有就显示 `message` 加一个不确定进度的动画。前端要对通知做节流，并且忽略比当前值小的进度，防止乱序时进度条倒退。展示的细节见 [工具调用的界面展示](/ai/tools/17-tool-call-ui)。
:::

::: details 用户点了取消，但 Server 其实已经写了数据库，怎么办？
协议层的取消只是"尽量停下"，不保证没有副作用。界面上要以最终结果为准，比如再查一次状态；写操作本身要设计成可以安全重试或补偿，比如带幂等键，或提供撤销操作。
:::

::: details 一个工具调用触发了 input_required 重试，进度 token 怎么处理？
重试是一个新的独立请求，有新的 JSON-RPC id，进度 token 也要在所有进行中的请求里唯一，所以每次请求都带它自己的 token。前端可以用自己的调用 ID 把多次重试的进度串到同一个界面元素上。
:::

## 易错点

- 在 2026-07-28 版的 HTTP 传输下，以为断开连接不算取消；新版里关闭响应流就是取消
- 进度值不递增，或请求结束后还在发进度
- 只设空闲超时、不设总超时，收到进度就无限续命
- 以为取消了就一定没执行，忽略了取消和完成的竞态
