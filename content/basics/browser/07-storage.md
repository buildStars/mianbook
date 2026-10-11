---
difficulty: 1
tags: [高频]
---

# Cookie、localStorage、sessionStorage、IndexedDB 有什么区别？

::: tip 一句话回答
**Cookie** 单个只有约 4KB，会自动随请求发给服务器，适合存登录凭证。**localStorage** 和 **sessionStorage** 是同步 API，只能存字符串，容量通常约 5MB，前者一直保存，后者关闭标签页就清除。**IndexedDB** 是异步的浏览器数据库，容量大，支持事务和索引，适合存大量结构化数据。
:::

## 详细解析

### 对比

| | Cookie | localStorage | sessionStorage | IndexedDB |
| --- | --- | --- | --- | --- |
| 容量 | 单个约 4KB | 每个源通常约 5MB，因浏览器而异 | 同 localStorage | 大，受浏览器的存储配额限制 |
| 生命周期 | 由 `Expires` / `Max-Age` 决定，不设置就是会话 Cookie | 一直保存，直到被清除 | 只在当前标签页的会话中有效，关闭标签页即清除 | 一直保存，直到被清除 |
| 随请求发送 | 自动携带，会增加请求体积 | 不会 | 不会 | 不会 |
| API | 通过 `document.cookie` 读写字符串，用起来不方便 | 同步，只能存字符串 | 同步，只能存字符串 | 异步，支持事务和索引，能存对象和 Blob |
| 作用域 | 由 `Domain`、`Path` 控制，可以在子域名之间共享 | 按源隔离，同源的标签页共享 | 按源隔离，并且每个标签页各有一份 | 按源隔离 |

几个细节：

- 只有 Cookie 会自动发给服务器，而且要满足 `Domain`、`Path`、`SameSite` 等规则；每个请求都带着它，所以 Cookie 要尽量小
- sessionStorage 刷新页面不会清除；新打开的同源标签页之间不共享
- Web Storage 是同步 API，读写大量数据会阻塞主线程；它在 Web Worker 中也不可用，IndexedDB 则可以
- localStorage 被修改时，同源的其他标签页会收到 `storage` 事件，可以用来做[标签页通信](/basics/browser/17-cross-tab)

### Cookie 的属性

服务端通过响应头设置 Cookie：

```text
Set-Cookie: sid=a1b2c3; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax
```

| 属性 | 作用 |
| --- | --- |
| `Domain` | 哪些域名能收到。不设置时只发给设置它的那个域名，不包括子域名；设置为 `example.com` 后，子域名也能收到 |
| `Path` | 哪些路径能收到 |
| `Expires` / `Max-Age` | 过期时间，前者是绝对时间，后者是秒数，同时存在时 `Max-Age` 优先 |
| `HttpOnly` | JS 无法通过 `document.cookie` 读取，降低被 XSS 窃取的风险 |
| `Secure` | 只在 HTTPS 请求中发送 |
| `SameSite` | 跨站请求时是否携带，用来防御 CSRF，见 [XSS 和 CSRF](/basics/browser/06-xss-csrf) |

### 使用建议

- **登录凭证**：放在 HttpOnly Cookie 中，同时设置 `Secure` 和 `SameSite`
- **用户偏好等小数据**：主题、语言等用 localStorage
- **只在当前标签页内有效的临时数据**：用 sessionStorage，比如多步骤表单的中间状态
- **大量结构化数据、离线数据**：用 IndexedDB。原生 API 基于事件回调，写起来繁琐，可以借助 idb、Dexie 等库

```js
import { openDB } from 'idb'

const db = await openDB('app', 1, {
  // 首次创建或版本升级时建表
  upgrade(db) {
    db.createObjectStore('drafts', { keyPath: 'id' })
  },
})

await db.put('drafts', { id: 1, title: '未完成的文章', updatedAt: Date.now() })
const draft = await db.get('drafts', 1)
```

## 面试官可能追问

::: details localStorage 存满了会怎样？
`setItem` 会抛出 `QuotaExceededError` 异常，浏览器不会自动清理旧数据。所以写入要放在 `try/catch` 里，失败时清理过期或不重要的数据，或者改存到 IndexedDB。同一个源下的所有页面共用这份容量。
:::

::: details 怎么给 localStorage 加过期时间？
localStorage 本身没有过期机制。存数据时把过期时间一起存进去，读取时判断是否过期：

```js
// ttl 的单位是毫秒
function setWithExpire(key, value, ttl) {
  localStorage.setItem(key, JSON.stringify({ value, expireAt: Date.now() + ttl }))
}

function getWithExpire(key) {
  const raw = localStorage.getItem(key)
  if (raw === null) return null
  const { value, expireAt } = JSON.parse(raw)
  if (Date.now() > expireAt) {
    localStorage.removeItem(key)
    return null
  }
  return value
}
```
:::

::: details "复制标签页"时 sessionStorage 会怎样？
新标签页会得到一份当前 sessionStorage 的副本，之后两边各自修改，互不影响。这也说明 sessionStorage 是跟着标签页走的，而不是在同源页面之间共享。
:::

## 易错点

- Web Storage 只能存字符串：直接存对象会变成 `"[object Object]"`，要用 `JSON.stringify` 和 `JSON.parse` 转换
- 会话 Cookie 不一定在关闭浏览器时清除：浏览器开启了"继续浏览上次打开的网页"这类会话恢复功能时，会话 Cookie 也会被一起恢复
- HttpOnly 只是让 JS 读不到 Cookie，它仍然会随请求自动发送，所以还要靠 SameSite 等手段防 CSRF
