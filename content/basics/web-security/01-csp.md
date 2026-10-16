---
difficulty: 2
tags: [安全, 实践]
---

# CSP 是什么？怎么配置才能既安全又不影响业务？

::: tip 一句话回答
CSP（内容安全策略）是服务端通过 `Content-Security-Policy` 响应头告诉浏览器：这个页面**允许从哪里加载、执行哪些资源**，不在策略里的一律拦截。它挡不住内容被注入，但能让注入的脚本**执行不了**，是转义输出之外的第二道防线。脚本推荐用 **nonce 或 hash** 放行，配合 `'strict-dynamic'` 让受信任的脚本加载它的依赖，而不是写 `'unsafe-inline'` 或一长串域名白名单。上线前先用 **`Content-Security-Policy-Report-Only`** 只上报、不拦截，根据违规报告改完代码再正式启用。
:::

## 详细解析

### CSP 能拦住什么

浏览器加载资源、执行脚本之前，都会对照策略检查一遍。只要策略里有 `script-src`（或者兜底的 `default-src`），下面这些默认都会被禁止，而它们正是 XSS 最常利用的方式：

- 内联的 `<script>` 代码块
- 内联事件处理器，如 `onclick="..."`、`onerror="..."`
- `javascript:` 开头的 URL
- `eval`、`new Function`、给 `setTimeout` 传字符串这类"把字符串当代码执行"的 API

所以即使攻击者把一段 HTML 塞进了页面，里面的脚本也跑不起来。但 CSP 只是兜底，注入点还是要靠转义修掉，见 [XSS 和 CSRF](/basics/browser/06-xss-csrf)；渲染 AI 生成的内容时同样要靠它兜底，见[渲染模型输出的安全风险](/engineering/security/05-output-rendering)。

### 常用指令

| 指令 | 控制什么 | 说明 |
| --- | --- | --- |
| `default-src` | 其他抓取类指令没写时的默认值 | 通常设成 `'self'`，再按类型放开 |
| `script-src` | 脚本 | 最关键的一条 |
| `style-src` | 样式表和内联样式 | 很多 UI 库会注入内联样式 |
| `img-src`、`font-src`、`media-src` | 图片、字体、音视频 | 用户头像、外链图片的域名要加上 |
| `connect-src` | fetch、XHR、WebSocket、EventSource 的目标 | 接口域名、监控上报地址 |
| `frame-src` | 页面里能嵌入哪些 iframe | 第三方支付、视频播放器 |
| `object-src` | `<object>`、`<embed>` | 建议直接设成 `'none'` |
| `base-uri` | `<base>` 能设成什么 | 防止注入 `<base>` 后，相对路径的脚本被指到别处 |
| `frame-ancestors` | 谁能用 iframe 嵌入我 | 防点击劫持，见[点击劫持](/basics/web-security/02-clickjacking) |

来源的写法：`'self'`（同源）、`https://cdn.example.com`（指定源）、`https:`（任意 HTTPS 地址）、`'none'`（全部禁止）。关键字必须带单引号。`base-uri`、`form-action`、`frame-ancestors` 不是抓取类指令，**不会回退到 `default-src`**，要单独写。

### nonce、hash 和 strict-dynamic

只写域名白名单有个问题：白名单里只要有一个域名托管了用户能控制的内容，或者有能按参数返回任意脚本的接口（如 JSONP），攻击者就能借它绕过 CSP。而且大型站点的白名单很难列全。所以现在推荐"严格 CSP"：

- **nonce**：服务端每次响应生成一个随机值，写进 `script-src 'nonce-随机值'`，同时加到页面里每个合法的 `<script nonce="随机值">` 上。注入的脚本猜不到这个值，就不会执行。nonce 必须**每次响应都不同、不可预测**，页面因此必须动态生成
- **hash**：把内联脚本内容的 SHA-256 等哈希写进策略，内容一字不差才放行。适合静态页面，脚本改一个字符就要重新计算
- **`'strict-dynamic'`**：被 nonce 或 hash 放行的脚本，再用 `document.createElement('script')` 加载的脚本也被信任。第三方 SDK 会层层加载其他脚本，有了它就不用把这些域名全列出来。启用后，策略里的域名白名单、`'self'` 和 `'unsafe-inline'` 都会被忽略
- 指令里只要出现 nonce 或 hash，`'unsafe-inline'` 就会被忽略。利用这一点可以兼容老浏览器：不认识 nonce 的老浏览器按 `'unsafe-inline' https:` 执行，新浏览器只认 nonce 和 `'strict-dynamic'`

### 上线流程

1. 盘点页面用到的脚本、样式、图片、接口和 iframe 的来源
2. 用 `Content-Security-Policy-Report-Only` 下发策略：浏览器只上报违规，不拦截，业务不受影响
3. 收集报告逐条处理：内联事件改成 `addEventListener`、去掉 `eval`、补上漏掉的来源
4. 报告基本清零后，改成 `Content-Security-Policy` 正式拦截。两个响应头可以同时存在：一个执行当前策略，一个试运行更严格的新策略

上报地址用 `report-to` 指令加 `Reporting-Endpoints` 响应头声明。旧的 `report-uri` 已不推荐，但支持的浏览器更多，现阶段可以两个都写。

## 代码示例

Express 中每个请求生成 nonce（域名为示例）：

```js
import crypto from 'node:crypto'
import express from 'express'

const app = express()

app.use((req, res, next) => {
  const nonce = crypto.randomBytes(16).toString('base64') // 每个响应一个新的随机值
  res.locals.nonce = nonce
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    // 'unsafe-inline' 和 https: 是给老浏览器的降级，支持 'strict-dynamic' 的浏览器会忽略它们
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https:`,
    "style-src 'self' 'unsafe-inline'", // 样式注入的风险比脚本小，先放开，以后再收紧
    "img-src 'self' data: https://cdn.example.com",
    "connect-src 'self' https://api.example.com",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
    'report-to csp',
    'report-uri https://example.com/csp-reports', // 兼容还不支持 report-to 的浏览器
  ].join('; '))
  res.setHeader('Reporting-Endpoints', 'csp="https://example.com/csp-reports"')
  next()
})

app.get('/', (req, res) => {
  const { nonce } = res.locals
  res.send(`<!doctype html>
<script nonce="${nonce}">window.__CONFIG__ = { theme: 'dark' }</script>
<script nonce="${nonce}" src="/app.js"></script>`)
})
```

## 面试官可能追问

::: details 有了 CSP 就不用担心 XSS 了吗？
不是。CSP 只限制脚本和资源从哪里来，注入本身还在：攻击者仍然可以插入伪造的登录框、钓鱼链接这类不需要脚本的 HTML。策略里放行的来源如果能被用户控制，策略里有 `'unsafe-eval'`，或者受信任的脚本用不可信的地址动态创建 `<script>`（`'strict-dynamic'` 下会被放行），CSP 也拦不住。转义输出和过滤 HTML 仍然是主防线，CSP 是兜底。
:::

::: details 能用 meta 标签设置 CSP 吗？有什么限制？
可以写 `<meta http-equiv="Content-Security-Policy" content="...">`，适合没法改响应头的静态托管。限制是：`frame-ancestors`、`report-uri`、`sandbox` 三个指令不生效，Report-Only 也不能用 meta 下发；策略只对 meta 之后的内容生效，所以要放在 `<head>` 的最前面。能用响应头就用响应头。
:::

::: details 统计、客服这类第三方脚本怎么处理？
给第三方的加载脚本加上 nonce，再配合 `'strict-dynamic'`，它后续加载的脚本就不用逐个列出；它要上报数据的域名加进 `connect-src`、`img-src`。有的老 SDK 依赖 `eval` 或内联事件：前者只能评估后加 `'unsafe-eval'`，后者要用 `'unsafe-hashes'` 加哈希逐个放行；都不划算时就换掉它，或者把它放进单独源的 iframe 里隔离。版本固定的文件还可以加 SRI，见[供应链安全](/basics/web-security/05-supply-chain)。
:::

::: details 违规报告很多，大部分是噪音，怎么办？
大量报告来自浏览器扩展注入的脚本，`source-file` 或 `blocked-uri`（`report-to` 格式里叫 `sourceFile`、`blockedURL`）是 `chrome-extension:`、`moz-extension:` 这类地址，可以直接过滤。剩下的按"指令 + 被拦截的地址"聚合，看排名靠前的几类。上报接口是公开的，要做限流和采样，防止被刷。
:::

## 易错点

- nonce 写死在模板里，或者页面被 CDN 缓存，每次响应都是同一个值，等于没有 nonce
- 只写了 `default-src 'none'`，以为页面不能被嵌入：`frame-ancestors` 不回退到 `default-src`
- 内联事件处理器（`onclick="..."`）不能加 nonce：nonce 放行的是整个 `<script>`、`<style>` 这类元素，管不到元素上的事件属性，要改成 `addEventListener`
- 以为同时写 nonce 和 `'unsafe-inline'` 能两全：支持 nonce 的浏览器会忽略 `'unsafe-inline'`，没带 nonce 的内联脚本照样被拦
