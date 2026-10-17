---
difficulty: 2
tags: [实践]
---

# 流式输出的功能怎么测试？前端怎么 mock 流式接口？

::: tip 一句话回答
核心是**自己造流**：用 `ReadableStream` 按指定的分块和延迟吐出字节，包成 `new Response(stream)` 替换 `fetch`，就能稳定复现各种情况。重点测**边界**：分块切在多字节汉字中间、切在 SSE 事件中间、一块里有多条事件、中途报错、用户中断、没有结束标记就断开。服务端接口用真实 HTTP 请求读流来测，上游模型用假的流替身。线上的真实响应可以**录制**下来，回放成测试用例。
:::

## 详细解析

### 先把逻辑拆成可测的层

流式功能一般分三层，越往下越容易测：

1. **解析层**：字节到事件，包括 UTF-8 解码、按空行切分、解析字段（见 [fetch 解析流](/engineering/streaming/02-fetch-stream)）。纯函数，输入一组分块，断言输出的事件
2. **状态层**：事件到界面状态，如累加文本、切换阶段、处理错误。也是纯逻辑，按顺序喂事件即可
3. **界面层**：状态到 DOM，用组件测试或端到端测试，覆盖少量关键路径

前两层占大部分用例，跑得快、结果稳定。通用的前端测试分层见 [前端测试](/basics/build/15-frontend-testing)。

### mock 流式接口

- **单元测试**：写一个 `makeStream(chunks, delay)`，把字符串或字节数组按顺序 `enqueue`，中间可以插入延迟或 `error`，包成 `Response` 后让被测代码去读。Node.js 18 起全局就有 `ReadableStream`、`Response`、`TextEncoder`，不需要浏览器
- **替换 `fetch`**：测试里把 `globalThis.fetch` 换成返回假 `Response` 的函数，或者用请求拦截库在网络层拦截，返回流式响应体
- **延迟用假时钟**：测超时、打字机节奏时，用测试框架的假定时器控制时间，不要真的等
- **端到端测试**：起一个本地 mock 服务，按脚本写 SSE 事件，可以模拟慢速、断线、心跳

### 必测的边界用例

| 用例 | 构造方式 | 期望 |
| --- | --- | --- |
| 汉字被切开 | 把一个汉字的 3 个字节拆到两块 | 不出现乱码 |
| 事件被切开 | 一条 `data:` 行拆到两块 | 拼好后只产生一个事件 |
| 一块多事件 | 一块里放三条事件 | 产生三个事件，顺序正确 |
| `\r\n` 换行 | 用 `\r\n\r\n` 分隔事件 | 和 `\n\n` 结果一致 |
| 中途报错 | 发几块后 `controller.error()` | 已收到的内容保留，界面显示中断 |
| 没有结束标记 | 流正常关闭但没有 `[DONE]` | 按异常结束处理，而不是假装完成 |
| 用户中断 | 读取中途调用 `abort()` | 停止读取，状态变成已停止 |

### 服务端接口怎么测

- 把调用模型的客户端抽成接口，测试时注入一个返回假流的实现，就能测转发、计费、错误处理（转发逻辑见 [服务端转发](/engineering/streaming/08-server-relay)）
- 用真实 HTTP 请求打本地服务，逐块读取响应，断言响应头（`Content-Type`、禁用缓存）和事件序列
- 测客户端断开：读到一半取消请求，断言上游假流收到了取消信号
- 部署后跑一个冒烟检查，验证经过代理后仍然是逐块到达（见 [代理缓冲](/engineering/streaming/07-proxy-buffering)）

### 录制回放

线上遇到解析问题时，把原始响应字节和每块的时间间隔记录下来，存成测试夹具。回放时按原来的分块和间隔重放，能稳定复现问题，也能当回归用例。录制前要脱敏，去掉用户内容和凭证。

## 代码示例

```js
// stream.test.mjs，用 node --test 运行
import { test } from 'node:test'
import assert from 'node:assert/strict'

// 按给定分块造一个流，可选在最后报错
function makeStream(chunks, { delay = 0, failWith } = {}) {
  const enc = new TextEncoder()
  return new ReadableStream({
    async start(controller) {
      for (const c of chunks) {
        if (delay) await new Promise((r) => setTimeout(r, delay))
        controller.enqueue(typeof c === 'string' ? enc.encode(c) : c)
      }
      failWith ? controller.error(failWith) : controller.close()
    },
  })
}

// 被测对象：把响应体解析成 data 字段的数组
async function collectData(body) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let buf = ''
  const out = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += value.replace(/\r\n/g, '\n')
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const event = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const data = event.split('\n').filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart()).join('\n')
      if (data) out.push(data)
    }
  }
  return out
}

test('汉字和事件被切在分块中间', async () => {
  const bytes = new TextEncoder().encode('data: 你好\n\ndata: 世界\n\n')
  const chunks = [bytes.slice(0, 7), bytes.slice(7, 15), bytes.slice(15)] // 第 7 字节切在"你"中间
  const res = new Response(makeStream(chunks, { delay: 1 }))
  assert.deepEqual(await collectData(res.body), ['你好', '世界'])
})

test('中途报错要抛出', async () => {
  const body = makeStream(['data: a\n\n'], { failWith: new Error('network') })
  await assert.rejects(collectData(body), /network/)
})
```

## 面试官可能追问

::: details 怎么测打字机效果这类和时间有关的逻辑？
把时间来源注入进去，或者用测试框架的假定时器（如 Vitest、Jest 的 fake timers），手动推进时间后断言显示了多少字。不要在测试里真的 sleep，又慢又不稳定。
:::

::: details 要不要在测试里调用真实的大模型？
单元和集成测试不调用，输出不确定、慢、要花钱，用假流替代。真实模型留给少量的端到端冒烟测试和效果评测，那是另一套体系，见 [回归测试](/engineering/eval/05-regression-testing)。
:::

::: details 怎么确认流式在生产环境真的是逐块到达的？
测"块到达的时间分布"而不是只测最终内容：记录每块的到达时间，如果所有块几乎同时到达，说明链路上有缓冲。可以做成部署后的自动检查。
:::

## 易错点

- 只用一整块完整数据测试，永远测不出切分相关的 bug
- mock 时直接返回解析好的事件对象，跳过了最容易出错的解析层
- 只测正常结束，不测报错、中断和缺少结束标记
- 录制的线上数据没脱敏就提交进代码仓库
