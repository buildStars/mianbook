---
difficulty: 3
tags: [原理, 实践]
---

# 流式语音合成怎么做到边生成边播放？

::: tip 一句话回答
把大模型的流式文本**按句切分**，每凑够一句就送去语音合成（TTS），合成出的音频分片按顺序放进**播放队列**，前一段播完紧接着播下一段。这样首个声音只需要等"第一句文本 + 第一段音频"，而不是等全文生成完。难点在三处：**切句**（太短语调不自然，太长首音慢）、**无缝衔接**（用 Web Audio 按时间排程，不要靠 onended 回调串起来）、**打断**（用户说话或点停止时，同时停掉文本流、TTS 请求和已排队的音频）。
:::

## 详细解析

### 整体链路

```text
LLM 流式文本 ──> 切句器 ──> TTS（按句请求，或流式 TTS 连接）
                                │ 音频分片（带序号）
                                v
                         播放队列（按序号排序）──> Web Audio 播放
```

三段都是流，互相不等待：模型还在生成第三句时，第二句在合成，第一句已经在播。首音延迟大致等于"模型生成第一句的时间 + TTS 合成第一句的首包时间"。

### 切句：在自然度和延迟之间取舍

- 按句末标点切（。！？；和英文的 . ! ?），这是最自然的边界
- 第一句可以切得更激进：遇到逗号且已有若干字就先送出去，换取更快的首音
- 设最大长度：模型一直不出标点时，到长度上限也要强制切，否则首音无限推迟
- 送 TTS 前清洗文本：Markdown 符号、代码块、链接地址不该被念出来；数字、单位、缩写可能要转成适合朗读的形式
- 小数点、版本号里的 "." 不是句末，切句规则要避开"数字.数字"

### 播放：用时间排程保证无缝

浏览器端常用两种方式：

| 方式 | 做法 | 适合 |
| --- | --- | --- |
| Web Audio | 每段解码成 AudioBuffer，用 AudioBufferSourceNode 在计算好的时间点 `start(when)` | 每段是完整音频文件，或者是原始 PCM |
| MediaSource | 把分片 append 到 SourceBuffer，交给 `audio` 元素连续播放 | 编码格式是浏览器 MSE 支持的流式格式 |

Web Audio 的关键是维护一个 `nextStartTime`：每段的开始时间取 `max(当前时间, nextStartTime)`，开始后 `nextStartTime += 这段的时长`。靠 `onended` 回调再开始下一段，会因为回调延迟出现可感知的间隙。

另外，浏览器要求用户交互后才能出声，AudioContext 需要在点击事件里创建或 `resume()`。

### 顺序和打断

- 每句带序号，TTS 是并发请求时返回顺序可能乱，播放队列按序号等待，缺的那段没到就先不排后面的
- 打断时要同时做三件事：abort 文本流（见 [中断生成](/engineering/streaming/04-abort)）、取消未完成的 TTS 请求、对已排程的 source 调用 `stop()` 并清空队列
- 记录已经播完了哪几句，界面上可以把没播的文本标灰；后续对话的上下文里，也可以只保留用户真正听到的部分

### 服务端还是客户端串联

把"LLM → 切句 → TTS"放在服务端，前端只收音频流和对应的文本，链路短、密钥不暴露，前端也简单；放在客户端则更灵活，但要发两类请求。完整的实时语音对话还涉及识别和打断检测，见 [实时语音对话的 AI 助手](/engineering/system-design/10-voice-assistant)。

## 代码示例

```js
// 把流式文本增量切成适合送 TTS 的句子
function createSentenceSplitter({ firstMinLen = 8, maxLen = 80 } = {}) {
  let buf = ''
  let first = true
  const END = /[。！？；!?;\n]|\.(?!\d)/ // 英文句号后面跟数字的不算句末

  function take(i) {
    const s = buf.slice(0, i).trim()
    buf = buf.slice(i)
    first = false
    return s
  }

  return {
    push(delta) {
      buf += delta
      const out = []
      for (;;) {
        const m = buf.match(END)
        if (m && m.index + 1 < buf.length) {
          out.push(take(m.index + 1)) // 句末标点后还有内容，确认不是小数点
        } else if (first && buf.length >= firstMinLen && /[，,]/.test(buf.slice(firstMinLen - 1))) {
          out.push(take(buf.indexOf('，', firstMinLen - 1) + 1 || buf.indexOf(',', firstMinLen - 1) + 1))
        } else if (buf.length >= maxLen) {
          out.push(take(maxLen)) // 一直没有标点，强制切
        } else break
      }
      return out.filter(Boolean)
    },
    flush() {
      const s = buf.trim()
      buf = ''
      return s ? [s] : []
    },
  }
}
```

句末标点要等后面再来一个字符才确认，是为了区分"3.5"里的小数点。文本流结束时调用 `flush()` 把剩下的送出去。

## 面试官可能追问

::: details TTS 是按句发 HTTP 请求，还是开一条流式连接？
按句请求实现简单，每句可以并发，但每句都有一次连接和首包开销，句与句之间的语调也不连贯。流式 TTS 通常走 WebSocket，文本持续推进去、音频持续推出来，模型能看到上下文，衔接更自然。具体能力各家不同，以服务商文档为准。
:::

::: details 怎么让字幕和声音同步？
最简单的是按句同步：某一句的音频开始播放时，高亮这句文本。更细的逐字同步需要 TTS 返回时间戳（有的服务支持），再按播放进度高亮。
:::

::: details 首音延迟还能怎么压？
第一句切得更短；模型侧压首 Token 延迟（见 [首 Token 延迟优化](/engineering/deploy/07-latency)）；TTS 选首包快的流式接口；提前建好 TTS 连接和 AudioContext，不在第一句到达时才初始化。
:::

## 易错点

- 等全文生成完再合成，失去了流式的意义
- 用 onended 回调串联播放，段与段之间有明显停顿
- 打断时只停了文本流，已排队的音频还在继续播
- Markdown 符号和代码原样送进 TTS，被逐字念出来
