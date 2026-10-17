---
difficulty: 3
tags: [安全, 原理]
---

# DOM 型 XSS 是怎么产生的？Trusted Types 能防住什么？

::: tip 一句话回答
DOM 型 XSS 完全发生在前端：页面 JS 从**可被攻击者控制的来源（source）**读数据，比如 URL 的 hash、查询参数、postMessage，再写进**能执行代码的位置（sink）**，比如 `innerHTML`、`document.write`、`eval`、`javascript:` 链接。恶意内容可能根本不经过服务器，服务端过滤管不到。**Trusted Types** 让浏览器在这些 sink 上拒绝普通字符串，只接受经过指定 policy 处理过的对象，把"所有危险写入"收拢到几个可审计的函数里。
:::

## 详细解析

### source 和 sink

三类 XSS 的总体对比见 [XSS 和 CSRF](/basics/browser/06-xss-csrf)。DOM 型的分析方法是找"从哪来、到哪去"：

| 类别 | 常见例子 |
| --- | --- |
| source（输入） | `location.hash`、`location.search`、`document.referrer`、`postMessage` 的 data、`localStorage` 里别处写入的值 |
| HTML sink | `innerHTML`、`outerHTML`、`insertAdjacentHTML`、`document.write` |
| 脚本 sink | `eval`、`new Function`、字符串形式的 `setTimeout`、`script.src`、`script.textContent` |
| URL sink | `a.href`、`location.href`、`iframe.src`，值是 `javascript:` 协议时会执行 |

只要一条数据流从 source 到 sink 中间没有正确编码或清洗，就是漏洞。

### 为什么服务端过滤防不住

- URL 的 **hash 部分不会发给服务器**，服务端根本看不到
- postMessage、localStorage 这类输入完全在浏览器里流转
- 即使数据经过服务端，服务端也不知道前端最终把它放进 HTML、URL 还是 JS，没法选对编码方式

所以防御要在前端写入 DOM 的那一刻做。

### 框架里的危险 API

Vue 的 `{{ }}` 插值和 React 的 JSX 文本默认会转义，是安全的。框架留下的"逃生口"才是重灾区：

- Vue 的 `v-html`，React 的 `dangerouslySetInnerHTML`
- 绑定到 `href`、`src` 的用户数据。React 对 `javascript:` URL 会给出警告（较新版本会直接拦截），但不能依赖它兜底
- 直接操作 DOM 的 ref 代码和第三方库

真要渲染富文本时，先用 DOMPurify 这类白名单清洗库处理。

### Trusted Types 的原理

开启后，浏览器要求 HTML、脚本、脚本 URL 三类 sink 只接受 `TrustedHTML`、`TrustedScript`、`TrustedScriptURL` 对象，传普通字符串直接抛 TypeError。这些对象只能由 **policy** 创建：

```js
// 通过 CSP 开启：
// Content-Security-Policy: require-trusted-types-for 'script'; trusted-types sanitize
const policy = trustedTypes.createPolicy('sanitize', {
  createHTML: (input) => DOMPurify.sanitize(input), // 所有 HTML 写入都过这里
})

el.innerHTML = policy.createHTML(userContent) // ✅ 传入 TrustedHTML
el.innerHTML = userContent // ❌ 抛 TypeError，并上报违规
```

- `require-trusted-types-for 'script'` 打开强制检查
- `trusted-types` 列出允许创建的 policy 名字，防止别的代码随便建一个"什么都放行"的 policy
- 名为 `default` 的 policy 会自动处理所有传给 sink 的字符串，适合老代码迁移过渡，但它等于把关口放宽，要谨慎

它的价值是把审计面从"全项目所有 `innerHTML`"缩小到"几个 policy 函数"。CSP 的其他指令见 [CSP](/basics/web-security/01-csp)。

### 兼容性和落地

Chromium 内核浏览器最早支持，其他主流浏览器到近期的新版本才陆续支持，旧版本仍不支持，上线前查兼容性表。不支持的浏览器会忽略这条指令，所以它是一层加固，不能替代输出编码和清洗。落地时先用 `Content-Security-Policy-Report-Only` 收集违规，把报错的地方逐个改成走 policy，再切换成强制模式。

## 面试官可能追问

::: details Trusted Types 防不住什么？
policy 本身写错（比如直接原样返回）就没有保护。它也不管 sink 之外的问题：用户数据被拼进属性、CSS，或者逻辑漏洞让攻击者改了按钮的跳转目标。它解决的是"字符串流进危险 sink"这一类问题。
:::

::: details 用 textContent 代替 innerHTML 就安全了吗？
写普通元素的 textContent 是安全的，内容只会作为文本显示。但给 `script` 元素设置 textContent 仍然会执行代码，开启 Trusted Types 后这也属于脚本 sink。另外 `href`、`src` 这类 URL 属性要另外校验协议。
:::

::: details 怎么在代码审查里发现 DOM 型 XSS？
搜索 sink：`innerHTML`、`v-html`、`dangerouslySetInnerHTML`、`eval`、`location.href =`，逐个往回追数据来源，看是否可能来自 URL、消息或存储。ESLint 安全插件和浏览器的 Trusted Types 违规报告能帮忙自动发现。
:::

## 易错点

- 以为后端做了 XSS 过滤，前端就不用管。hash 和 postMessage 根本不经过后端
- 用正则"过滤 script 标签"代替白名单清洗，事件属性、SVG 等写法都能绕过
- 开了 Trusted Types 却写一个原样返回的 `default` policy，等于没开
- 只防 HTML sink，忘了 `javascript:` URL 和 `eval` 一类的脚本 sink
