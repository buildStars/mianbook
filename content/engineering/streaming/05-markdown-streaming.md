---
difficulty: 3
tags: [实践, 性能优化]
---

# 流式输出的 Markdown 怎么实时渲染？

::: tip 一句话回答
最直接的做法是每收到一段就把全文重新解析成 HTML，但回答越长越慢，总开销随长度平方增长。所以要**按帧合并更新**，并且**只重新渲染最后一个没写完的块**，前面已经完成的段落渲染一次就不再动。没闭合的代码块、表格会让排版来回跳，可以临时补全；代码高亮等代码块闭合后再做。模型输出是不可信的内容，渲染时要**禁用原始 HTML 并做清洗**，防止 XSS。自动滚动只在用户本来就在底部时跟随。
:::

## 详细解析

### 问题在哪

1. **重复解析**：一个回答几千字、上千个片段，每个片段都把全文解析一遍、替换一次 `innerHTML`，回答后半段明显变卡
2. **排版跳动**：未闭合的语法，中途和最终的解析结果不同
   - 代码块只有开头的围栏时，后面所有内容都被当成代码，闭合后又突然变回正文
   - 表格的表头后面还没出现分隔行时，显示成一行带竖线的普通文字
   - 加粗只写了开头的两个星号时，星号会先露出来
3. **重建 DOM**：每次替换整个 `innerHTML`，用户选中的文字会丢失，已经渲染好的图片、代码块也要重新创建

### 做法

- **节流**：收到数据只更新文本，渲染放进 `requestAnimationFrame`，一帧最多一次（见 [requestAnimationFrame](/basics/browser/14-raf-ric)）；也可以按固定间隔节流（见[防抖和节流](/basics/javascript/13-debounce-throttle)）
- **分块渲染**：块级元素（段落、列表、代码块、表格）以空行分隔。把文本分成"已完成的部分"和"正在写的尾部"：代码块之外最后一个空行之前的内容基本不会再变，渲染一次后追加到 DOM；只有尾部每帧重新渲染
- **临时补全**：尾部有未闭合的代码块时，渲染前在末尾补上结束围栏；也可以先去掉尾部未闭合的星号、反引号
- **延后昂贵的处理**：代码高亮、数学公式、图表等，等所在的块完成后再处理；生成结束后整体再渲染一次兜底
- **安全**：Markdown 渲染器关闭原始 HTML（markdown-it 默认就是关闭的），输出再用 DOMPurify 清洗；外链图片可以被用来外传数据，要禁用或走白名单，详见[渲染 AI 生成内容的安全风险](/engineering/security/05-output-rendering)

### 自动滚动

内容不断变长，页面要跟着滚到底部；但用户往上翻看时，不能把他强行拉回去。规则是：**渲染之前**判断用户是否在底部附近，是的话，渲染之后再滚到底部。用户手动滚回底部，就自然恢复跟随。可以再加一个"回到底部"按钮。

## 代码示例

```js
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const md = new MarkdownIt({ html: false, linkify: true }) // 不解析原始 HTML
const toHtml = (src) => DOMPurify.sanitize(md.render(src))
const FENCE = '```'

export class StreamingMarkdown {
  constructor(container, scroller) {
    this.doneEl = container.appendChild(document.createElement('div')) // 已完成的部分
    this.tailEl = container.appendChild(document.createElement('div')) // 正在写的尾部
    this.scroller = scroller
    this.text = ''
    this.doneLength = 0
    this.frame = 0
  }

  append(delta) {
    this.text += delta
    this.frame ||= requestAnimationFrame(() => this.render()) // 一帧最多渲染一次
  }

  render() {
    this.frame = 0
    const el = this.scroller
    const follow = el.scrollHeight - el.scrollTop - el.clientHeight < 40 // 渲染前判断
    const end = stableEnd(this.text, this.doneLength)
    if (end > this.doneLength) {
      // 新完成的段落只渲染一次，追加到后面，之前的 DOM 不动；这里也可以对新代码块做高亮
      this.doneEl.insertAdjacentHTML('beforeend', toHtml(this.text.slice(this.doneLength, end)))
      this.doneLength = end
    }
    this.tailEl.innerHTML = toHtml(closeFence(this.text.slice(this.doneLength)))
    if (follow) el.scrollTop = el.scrollHeight
  }

  // 生成结束：整体渲染一次，修正分块渲染的少数偏差
  finish() {
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.doneEl.innerHTML = toHtml(this.text)
    this.tailEl.innerHTML = ''
  }
}

// 从 from 开始，找代码块之外的最后一个空行，返回空行之后的位置
function stableEnd(text, from) {
  let inFence = false
  let end = from
  let pos = from
  for (const line of text.slice(from).split('\n')) {
    pos += line.length + 1
    if (line.trimStart().startsWith(FENCE)) inFence = !inFence
    else if (!inFence && line.trim() === '' && pos <= text.length) end = pos
  }
  return end
}

// 尾部有未闭合的代码块时，临时补上结束围栏（简化处理，只认反引号围栏）
function closeFence(src) {
  const count = src.split('\n').filter((line) => line.trimStart().startsWith(FENCE)).length
  if (count % 2 === 0) return src
  return src.endsWith('\n') ? src + FENCE : `${src}\n${FENCE}` // 避免代码块末尾多出一个空行
}
```

## 面试官可能追问

::: details 按空行切块，会不会切错？
会有少数偏差：列表项之间有空行时（松散列表），列表会被拆成两个；引用式链接的定义如果写在后面的段落里，前面的段落渲染时找不到它。生成过程中可以接受这些偏差，结束后整体再渲染一次修正。更准确的做法是用解析器的词法分析结果（如 markdown-it 的 token）判断块的边界，实现也更复杂。
:::

::: details 用 Vue 或 React 时怎么做？
思路一样：把已完成的块存成数组，每块的 HTML 只计算一次，列表用稳定的 key，框架就不会重建它们；只有最后一个块随文本变化。注意 `v-html`、`dangerouslySetInnerHTML` 插入的内容，框架不会帮你转义，清洗必须自己做。
:::

::: details 能不能把解析放到 Web Worker 里？
可以。Markdown 解析和代码高亮放进 Worker，主线程只负责插入 HTML，长回答时效果明显。代价是多了消息传递和序列化，而且 DOMPurify 依赖 DOM，Worker 里没有，清洗要放在主线程做。多数场景先做好节流和分块渲染就够了（Worker 的用法见 [Web Worker](/basics/browser/15-web-worker)）。
:::

## 易错点

- 只节流不分块：渲染次数少了，但每次仍然解析全文，长回答的后半段照样卡
- 渲染之后才判断是否在底部：内容已经变高，永远判断为"不在底部"，自动滚动失效
- 以为关掉了原始 HTML 就安全了：Markdown 语法本身就能生成链接和图片，有的渲染器不过滤 `javascript:` 链接，外链图片还能外传数据
- 每帧都对整段代码做高亮，开销比解析 Markdown 还大
