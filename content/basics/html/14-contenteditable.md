---
difficulty: 3
tags: [原理, 实践]
---

# 富文本编辑器为什么难做？contenteditable 有哪些坑？

::: tip 一句话回答
`contenteditable` 把编辑交给了浏览器，但浏览器生成什么 DOM **没有统一标准**：同样按回车、加粗、删除，各家产出的标签结构不同。`execCommand` 已被规范标记为废弃，选区（Selection/Range）难以精确控制，输入法的 **composition** 过程中还不能随意改 DOM。所以主流编辑器的思路是**自建数据模型**：拦截用户输入，转成对模型的操作，再由模型渲染出 DOM，contenteditable 只用来接收输入和显示光标。
:::

## 详细解析

### contenteditable 的几个坑

- **DOM 不一致**：回车后生成 `div`、`p` 还是 `br`，加粗用 `b` 还是 `strong`，删除时是否合并段落，各浏览器不同。同一段内容可能有多种 DOM 表示，保存下来的 HTML 难以比较和处理
- **execCommand 已废弃**：`document.execCommand('bold')` 还能用，但规范不再维护，行为不统一，能做的操作有限，也拿不到"改了什么"的结构化信息
- **选区难控制**：光标位置是"某个文本节点的第几个字符"。你一改 DOM，旧的 Range 就可能失效，光标跳到开头。块级元素边界、空行、行内元素边缘的光标位置都有大量特例
- **输入法组合输入**：中文输入时会依次触发 `compositionstart`、`compositionupdate`、`compositionend`，中间的拼音也会写进 DOM。这时如果编辑器改写 DOM，输入法状态会被打断，出现重复字或丢字
- **撤销栈**：浏览器自带的撤销只记录它自己的修改，编辑器用代码改过的 DOM 会让撤销行为混乱，通常要自己实现历史记录

### 主流编辑器怎么做

```text
用户输入（键盘、输入法、粘贴、拖放）
    │ beforeinput / keydown / paste 拦截
    ▼
转成操作（插入文字、拆分段落、加标记）
    ▼
修改文档模型（树或扁平结构，带 schema 约束）── 记录到历史栈、协同同步
    ▼
模型 → 渲染出 DOM，并把模型里的选区同步回浏览器选区
```

- 文档模型才是"真相"，DOM 只是它的视图，和 [虚拟 DOM](/basics/react/01-virtual-dom-diff) 的思路相似
- **schema** 规定哪些节点能嵌套在哪里，保证结构合法
- 浏览器的 `beforeinput` 事件带有 `inputType`（如 `insertText`、`deleteContentBackward`、`insertParagraph`），能在 DOM 改变之前知道用户意图，现代编辑器大量依赖它
- 组合输入期间一般让浏览器先改 DOM，`compositionend` 之后再读出结果同步回模型

ProseMirror、Slate、Lexical 等都是这类思路，区别在模型结构和渲染方式。也有编辑器完全不用 contenteditable，自己绘制光标和文字，并用隐藏的输入框接收输入，在线文档类产品常这样做，代价是要自己实现排版和选区。

### 粘贴要清洗

粘贴是富文本最大的安全入口。从网页、Word 复制来的 HTML 里可能有脚本、事件属性、`javascript:` 链接、大量内联样式。正确做法：

1. 在 `paste` 事件里 `preventDefault()`，自己读 `clipboardData.getData('text/html')`
2. 按编辑器 schema 解析，只保留允许的标签和属性，其余丢弃或降级成纯文本
3. 链接只允许 http、https、mailto 等协议

保存和展示时还要再清洗一次，因为数据可以绕过编辑器直接调接口提交。展示端的风险见 [DOM 型 XSS](/basics/web-security/11-dom-xss-trusted-types)。

## 代码示例

```js
const editor = document.querySelector('[contenteditable]')
let composing = false

editor.addEventListener('compositionstart', () => (composing = true))
editor.addEventListener('compositionend', () => {
  composing = false
  syncFromDOM() // 输入法结束后再把结果同步到模型
})

editor.addEventListener('beforeinput', (e) => {
  if (composing || e.isComposing) return // ✅ 组合输入期间不拦截
  if (e.inputType === 'insertParagraph') {
    e.preventDefault()
    model.splitBlock(currentSelection()) // 自己改模型，再重新渲染
    render()
  }
})

editor.addEventListener('paste', (e) => {
  e.preventDefault()
  const html = e.clipboardData.getData('text/html')
  const text = e.clipboardData.getData('text/plain')
  // sanitizeBySchema 只保留编辑器允许的节点，具体实现依赖所用的编辑器
  model.insertContent(currentSelection(), html ? sanitizeBySchema(html) : text)
  render()
})
```

## 面试官可能追问

::: details execCommand 废弃了，复制到剪贴板怎么办？
用异步剪贴板 API `navigator.clipboard.writeText()`，它返回 Promise，需要安全上下文（HTTPS），通常要在用户操作中调用。读剪贴板权限更严格，浏览器可能会弹出授权提示。
:::

::: details 协同编辑为什么更依赖数据模型？
多人同时编辑要合并操作，比如 OT 或 CRDT 算法，它们处理的是"在第几个位置插入什么"这种结构化操作，不可能去合并各浏览器生成的杂乱 DOM。有了模型，操作可以序列化、传输、变换，再各自渲染。
:::

::: details 只需要简单的多行输入加 @ 提及，也要上完整编辑器吗？
不一定。纯文本场景用 `textarea` 加浮层定位就行；需要高亮 @ 的名字时，可以用 `contenteditable="plaintext-only"` 或成熟的轻量库。完整编辑器框架的学习和维护成本不低，按需求选。
:::

## 易错点

- 直接把编辑器的 `innerHTML` 存库，换个浏览器打开结构就不同，也可能带入恶意内容
- 组合输入期间改 DOM 或重新渲染，中文输入出现重复字、丢字
- 只在前端清洗粘贴内容，服务端和展示端不再清洗
- 用代码改 DOM 后不恢复选区，光标跳到开头
