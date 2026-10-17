---
difficulty: 2
tags: [安全, 实践]
---

# postMessage 跨窗口通信有哪些安全风险？怎么校验消息来源？

::: tip 一句话回答
风险在收发两端。**发送方**把 `targetOrigin` 写成 `"*"`，目标窗口一旦被导航到别的网站，数据就发给了陌生人；**接收方**不校验 `event.origin`，任何能拿到窗口引用的页面都能给它发指令。正确做法：发送时写明确的 origin；接收时先校验 `origin` 和 `source`，再把 `data` 当**不可信输入**做格式校验，绝不直接 `innerHTML` 或 `eval`。
:::

## 详细解析

### 发送方：targetOrigin 不要用 *

`otherWindow.postMessage(data, targetOrigin)` 的第二个参数是一道闸：只有目标窗口当前的 origin 和它匹配，消息才会投递。

写成 `"*"` 的问题在于，你拿到的只是一个**窗口引用**，不是一个固定的网站。iframe 可能被重新导航，`window.open` 打开的页面可能跳走，父页面也可能根本不是你以为的那个（你的页面被别人嵌入了）。只要发的是 token、用户信息这类数据，就必须写明确的 origin。

### 接收方：三步校验

```text
收到 message 事件
  ├─ 1. event.origin 在白名单里吗？        否 → 丢弃
  ├─ 2. event.source 是预期的那个窗口吗？   否 → 丢弃
  └─ 3. event.data 结构符合约定吗？         否 → 丢弃
          └─ 只处理白名单里的 type，按值使用，不拼 HTML、不执行
```

- **origin**：精确比较，不要用 `indexOf`、`endsWith` 做模糊匹配，原因和 [开放重定向](/basics/web-security/09-open-redirect) 一样
- **source**：同一个 origin 可能开了多个窗口，比较 `event.source === iframe.contentWindow` 能确认是哪一个
- **data**：即使来源可信，对方页面也可能有 XSS 被控制。所以消息只携带数据，接收方用 `type` 分发到固定的处理函数

最危险的写法是把消息内容直接写进 DOM、拼成 URL 跳转，或者交给 `eval`、`new Function`。这时 postMessage 就成了 [DOM 型 XSS](/basics/web-security/11-dom-xss-trusted-types) 的输入源。

### 配合 sandbox 和 MessageChannel

- 嵌入不可信内容时用 `sandbox` 属性限制 iframe，详见 [iframe 安全](/basics/html/06-iframe)。不带 `allow-same-origin` 的沙箱页面 origin 是 `"null"`，这时不能靠 origin 区分，要靠 `event.source`
- **MessageChannel**：握手阶段用 postMessage 校验一次，把一个 `MessagePort` 转移给对方，之后的通信走这条专用通道。端口只有双方持有，其他窗口无法往里塞消息，后续消息就不用反复校验来源

## 代码示例

```js
// 父页面：嵌入 https://widget.example.com 的 iframe
const WIDGET_ORIGIN = 'https://widget.example.com'
const iframe = document.querySelector('#widget')

// 发送：写明确的 targetOrigin
iframe.contentWindow.postMessage({ type: 'init', theme: 'dark' }, WIDGET_ORIGIN)

const handlers = {
  resize: (payload) => {
    const h = Number(payload.height)
    if (Number.isFinite(h) && h > 0 && h < 5000) iframe.style.height = `${h}px`
  },
  close: () => iframe.remove(),
}

window.addEventListener('message', (event) => {
  if (event.origin !== WIDGET_ORIGIN) return // ✅ 校验来源
  if (event.source !== iframe.contentWindow) return // ✅ 校验是哪个窗口
  const msg = event.data
  if (!msg || typeof msg !== 'object' || !Object.hasOwn(handlers, msg.type)) return
  handlers[msg.type](msg) // ✅ 只处理约定的类型，按值使用
  // ❌ 不要 el.innerHTML = msg.html，也不要 eval(msg.code)
})
```

## 面试官可能追问

::: details 校验了 origin 还需要校验数据格式吗？
需要。origin 校验只说明消息来自那个网站，不代表内容安全：对方页面可能有 XSS，也可能有 bug 发出意外的数据。把它当成接口入参：检查类型、取值范围，用白名单分发。
:::

::: details 自己的页面被别人用 iframe 嵌入，会有什么 postMessage 风险？
页面如果监听 message 又不校验来源，嵌入方就能随意驱动它，比如触发操作、读取它回发的数据。页面如果用 `window.parent.postMessage(data, "*")` 回发敏感数据，嵌入方也能直接收到。所以要么校验来源，要么用 `frame-ancestors` 限制谁能嵌入，参见 [点击劫持](/basics/web-security/02-clickjacking)。
:::

::: details BroadcastChannel 需要校验来源吗？
BroadcastChannel 只在**同源**的页面之间通信，跨源页面加入不了同一个频道。风险主要来自同源页面本身：任何同源页面（包括被 XSS 的那个）都能发消息，所以数据仍然要做格式校验。几种跨标签通信方式的对比见 [跨标签页通信](/basics/browser/17-cross-tab)。
:::

## 易错点

- 只在接收方校验，发送方仍然用 `"*"` 发送敏感数据
- 用 `event.origin.includes('example.com')` 这类模糊匹配，攻击者注册一个包含这串字符的域名就能通过
- 沙箱 iframe 的 origin 是字符串 `"null"`，白名单里写 `"null"` 等于放行所有沙箱页面
- 以为 origin 可信就把 `event.data` 直接渲染成 HTML
