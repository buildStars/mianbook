---
difficulty: 2
tags: [实践, 性能优化]
---

# 打字机效果怎么实现才不卡？

::: tip 一句话回答
网络数据到达是不均匀的：有时一下子来一大段，有时停顿好几秒，直接把收到的内容追加到页面上，看起来一顿一顿的。做法是把收到的文字放进**缓冲队列**，用 **requestAnimationFrame** 每帧取出若干个字输出，**积压越多输出越快**，既平滑又不会越落越远；每帧只更新一次 DOM。生成结束或用户停止时，**立即输出**缓冲里剩下的内容。
:::

## 详细解析

### 为什么会一顿一顿

- 模型的生成速度在变：排队、长时间思考时会停顿
- 链路上会合并数据：服务端、代理、TCP 都可能把几个片段攒在一起发出，前端一次读到一大块
- 直接追加时，用户看到的是"停一下、蹦出一大段、再停一下"

### 缓冲队列 + 按帧输出

```text
网络 → 片段 → 队列（还没显示的字）→ 每帧取出 n 个 → 页面
n = 距上一帧的毫秒数 × 当前速度；当前速度 = 基础速度 + 积压字数 × 系数
```

- **按时间算，不按帧数算**：60Hz 和 120Hz 的屏幕上，每秒输出的字数一样
- **速度随积压变化**：积压少时匀速输出；积压多时加速追上，显示的内容不会比实际收到的落后太多
- **切到后台**：页面在后台时 rAF 暂停，切回来时距上一帧的时间很长，第一帧就会把积压的内容全部输出，用户不用再看一遍动画
- **结束时立即清空**：收到结束事件、出错或用户点停止时，把队列里剩下的直接输出。不要让用户等动画播完才能复制、才能继续提问

### 减少渲染开销

- 每帧只调用一次更新函数，把这一帧的字拼好再一起追加，不要每个字触发一次渲染或一次响应式更新
- 纯文本可以直接追加到一个文本节点上（`textNode.data += s`），开销很小
- 需要渲染 Markdown 时，打字机只决定"显示到哪里"，渲染交给[流式 Markdown 渲染](/engineering/streaming/05-markdown-streaming)里的节流和分块；用户向上滚动时停止自动跟随，做法也在那道题里

### 按字符切分，而不是按 UTF-16 码元

JS 字符串的 `length`、`slice` 按 UTF-16 码元计算，emoji 等字符占两个码元，从中间切开会短暂显示成乱码。`Array.from(text)` 按码点拆分，不会拆开单个字符。由多个码点组成的 emoji（如带肤色的表情）仍可能被拆开，需要更精确时用 `Intl.Segmenter` 按字素切分。

## 代码示例

```js
export class Typewriter {
  constructor(onOutput) {
    this.onOutput = onOutput // 每帧最多调用一次，参数是这一帧新增的文字
    this.queue = []
    this.frame = 0
    this.last = 0
    this.budget = 0 // 可以输出的字数，保留小数部分
  }

  push(text) {
    this.queue.push(...Array.from(text)) // 按码点拆分，不会把 emoji 切成两半
    if (!this.frame) {
      this.last = performance.now()
      this.frame = requestAnimationFrame(this.tick)
    }
  }

  tick = (now) => {
    const elapsed = Math.max(0, now - this.last)
    this.last = now
    // 基础速度约每秒 40 字，再加上和积压量成正比的部分：积压越多越快
    const speed = 0.04 + this.queue.length / 300 // 单位：字/毫秒
    // 不足一个字的部分留到下一帧，帧率不同时每秒输出的字数也一样
    this.budget += elapsed * speed
    const count = Math.floor(this.budget)
    if (count > 0) {
      this.budget -= count
      this.onOutput(this.queue.splice(0, count).join(''))
    }
    this.frame = this.queue.length ? requestAnimationFrame(this.tick) : 0
  }

  // 生成结束、出错或用户停止时调用：剩下的立即输出
  flush() {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    if (this.queue.length) this.onOutput(this.queue.splice(0).join(''))
  }
}
```

使用（`readSSE` 见[前端怎么用 fetch 解析流式响应](/engineering/streaming/02-fetch-stream)）：

```js
// #answer 设置了 white-space: pre-wrap，保留换行
const textNode = document.querySelector('#answer').appendChild(document.createTextNode(''))
const typewriter = new Typewriter((s) => {
  textNode.data += s
})

try {
  for await (const { data } of readSSE(res.body)) {
    if (data === '[DONE]') break
    typewriter.push(JSON.parse(data).text)
  }
} finally {
  typewriter.flush() // 正常结束、出错、用户停止，都要把剩下的输出
}
```

## 面试官可能追问

::: details 为什么不用 setInterval 每 30 毫秒输出一个字？
固定间隔和屏幕刷新不同步，可能一帧里输出两次，也可能一帧里一次都没有，看起来会抖；页面在后台时，浏览器还会限制定时器的频率。更大的问题是速度固定：模型输出比动画快时，积压越来越多，用户看到的内容比实际进度落后好几秒，生成早就结束了，还要等动画慢慢播完。
:::

::: details 打字机效果会不会让回答变慢？
会有一点：显示的进度总是略微落后于实际收到的内容。所以速度要随积压自动加快，结束时立即输出剩余内容，保证用户看到完整回答的时间基本不晚于数据到达的时间。模型输出本来就很快、很均匀时，也可以不做动画，直接按帧批量追加。
:::

::: details 和 Markdown 渲染怎么配合？
打字机输出的文字交给 Markdown 渲染器，渲染照样按帧节流、只重新渲染最后一个块。逐字显示时，加粗的星号、行内代码的反引号这类标记会先露出来，可以在渲染前把尾部未闭合的标记先去掉，等它闭合后再显示。
:::

## 易错点

- 每收到一个字就更新一次 DOM，或者每个字触发一次框架的响应式更新
- 速度写死，积压越来越多，显示的内容比实际进度落后越来越远
- 用 `slice` 按长度切分，emoji 被切成两半，短暂显示成乱码
- 停止或出错时直接丢弃队列，用户看不到已经收到的内容
