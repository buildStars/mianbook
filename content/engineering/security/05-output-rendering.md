---
difficulty: 2
tags: [高频, 安全, 实践]
---

# 把 AI 生成的内容渲染到页面上，有哪些安全风险？

::: tip 一句话回答
模型输出是**不可信内容**：它可能被提示注入操纵，也可能原样复述用户输入或网页里的恶意代码。直接用 `v-html` 或 `dangerouslySetInnerHTML` 渲染会导致 **XSS**。Markdown 渲染器要**关闭原始 HTML**，或者渲染后用 **DOMPurify** 清洗；链接要过滤 `javascript:` 等危险协议；外链图片在渲染时会自动发出请求，可能被用来**外传数据**，要禁用或只允许白名单域名；最后用 **CSP** 兜底。
:::

## 详细解析

### 为什么模型输出不可信

- 模型会复述输入：用户粘贴的代码、检索到的网页里有恶意 HTML，模型可能原样带到回答里
- 模型可能被[间接提示注入](/engineering/security/02-indirect-injection)操纵，故意输出攻击内容
- 即使没有攻击，模型也会自己写出 HTML 标签，这些标签不该被浏览器执行

所以模型输出要和用户输入一样对待。XSS 的基础原理见 [XSS 和 CSRF](/basics/browser/06-xss-csrf)。

### 风险和防御

| 风险 | 怎么发生 | 防御 |
| --- | --- | --- |
| HTML 注入 | 渲染了带 `<img onerror>` 或 `<script>` 的内容 | 关闭 Markdown 的原始 HTML；必须保留时用 DOMPurify 清洗 |
| 危险协议的链接 | 链接地址以 `javascript:` 开头，用户一点就执行脚本 | 只允许 `http:`、`https:`、`mailto:` 等协议 |
| 外链图片外传数据 | 图片地址带着对话里的敏感数据，浏览器加载时自动发出请求 | 不渲染外部图片，或只允许白名单域名；CSP 的 `img-src` 兜底 |
| 钓鱼链接 | 链接文字写着"官方文档"，实际指向仿冒网站 | 显示真实域名；跳转外链前提示 |
| 输出进入其他系统 | 模型输出被拼进 SQL、shell 命令、邮件模板 | 同样当作不可信输入：参数化查询、转义、白名单校验 |

### 常见 Markdown 库的默认行为

| 库 | 原始 HTML | 危险协议的链接 |
| --- | --- | --- |
| markdown-it | 默认 `html: false`，HTML 被转义成文本 | 默认拦截 `javascript:`、`vbscript:`、`file:` 和大部分 `data:` |
| marked | 默认原样输出，官方建议对结果用 DOMPurify 等库清洗 | 同样交给清洗库处理 |
| react-markdown | 默认转义 HTML，加了 rehype-raw 才会渲染 | 默认只放行 http、https、mailto 等少数协议 |

这些库的默认配置都不处理外链图片，要自己加规则。流式输出时每次重新渲染都要走同样的清洗流程，不能为了性能跳过，流式渲染的其他问题见[流式 Markdown 渲染](/engineering/streaming/05-markdown-streaming)。

## 代码示例

markdown-it：关闭 HTML，外链图片只允许白名单域名，最后再用 DOMPurify 清洗一遍：

```ts
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const IMAGE_HOSTS = new Set(['cdn.example.com']) // 允许加载的图片域名

const md = new MarkdownIt({ html: false, linkify: true })

const renderImage = md.renderer.rules.image!
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  let host = ''
  try {
    host = new URL(token.attrGet('src') ?? '').hostname
  } catch {
    // 相对路径或非法地址，按不允许处理
  }
  if (!IMAGE_HOSTS.has(host)) {
    // 不加载图片，只显示替代文字
    return md.utils.escapeHtml(`[图片：${token.content || '无描述'}]`)
  }
  return renderImage(tokens, idx, options, env, self)
}

// 第二道保险：以后有人打开了 html 选项、或者加了直接输出 HTML 的插件，也不会出问题
export const renderAnswer = (text: string) => DOMPurify.sanitize(md.render(text))
```

Vue 组件里用 `v-html` 绑定 `renderAnswer(content)` 的结果即可：问题从来不在 `v-html` 本身，而在于绑定的内容有没有清洗。

React 项目用 react-markdown 时，不要给模型输出加 rehype-raw，图片通过 `components` 覆盖（`isAllowedImage` 按域名白名单判断）：

```tsx
import Markdown from 'react-markdown'

export function Answer({ content }: { content: string }) {
  return (
    <Markdown
      components={{
        img: ({ src, alt }) =>
          isAllowedImage(src) ? <img src={src} alt={alt} /> : <span>[图片：{alt}]</span>,
      }}
    >
      {content}
    </Markdown>
  )
}
```

最后在响应头里用 CSP 限制图片来源，前面的规则有遗漏时，浏览器也不会去请求：

```text
Content-Security-Policy: img-src 'self' https://cdn.example.com
```

## 面试官可能追问

::: details markdown-it 已经关闭了 HTML，为什么还要 DOMPurify？
纵深防御。配置可能被后来的人改掉，有些插件（数学公式、自定义容器）会直接输出 HTML，不受 `html: false` 控制。DOMPurify 的成本很低，放在最后一步能兜住这些情况。服务端渲染时没有 DOM，需要配合 jsdom 使用。
:::

::: details 模型生成的 HTML 页面或代码，想在前端预览运行怎么办？
不要在主页面里执行。放进带 `sandbox` 属性的 iframe，并且用独立的域名提供，让它和主站不同源，读不到主站的 Cookie、localStorage 和 DOM；再用 CSP 限制它能访问的网络地址。更多隔离手段见[代码执行沙箱](/engineering/security/06-sandbox)。
:::

::: details 为什么外链图片比链接危险得多？
图片在渲染时由浏览器**自动**请求，用户什么都不用做，数据就发出去了；链接需要用户点击，用户还有机会看到真实地址。不过有的应用会自动抓取链接生成预览卡片，这时链接也变成了自动请求，要一并处理。
:::

::: details 模型输出的图表配置里带了函数，能用 eval 执行吗？
不能。让模型只输出 JSON 格式的配置，用 Schema 校验后再交给图表库；需要的格式化函数由前端预先写好，配置里只能引用它们的名字。确实要执行模型写的代码，就放到沙箱里执行。
:::

## 易错点

- 认为模型输出是"自己系统生成的"，可以信任
- 只在保存时清洗，流式渲染过程中却把未清洗的内容直接塞进 DOM
- 自己写正则只过滤 `<script>` 标签：`onerror` 这类事件属性、`javascript:` 链接同样能执行脚本，清洗要交给成熟的库
