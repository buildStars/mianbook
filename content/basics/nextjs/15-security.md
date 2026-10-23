---
difficulty: 3
tags: [安全, 综合]
---

# Next.js 应用有哪些常见的安全风险？怎么防范？

::: tip 一句话回答
Next.js 把服务端和客户端代码写在一起，最大的风险是**边界模糊**：服务端数据被整个传给客户端组件、带 `NEXT_PUBLIC_` 前缀的变量被打进 JS 包、**Server Actions 被当成内部函数**而忘了它是公开的 POST 接口。防御的核心是建一个只在服务端运行的**数据访问层（DAL）**，统一做鉴权并只返回需要的字段；每个 Server Action 单独鉴权、校验输入、检查资源归属；不把 Proxy 当成唯一防线。框架本身也出过严重漏洞，要**关注官方安全公告并及时升级**。
:::

## 详细解析

### 服务端数据泄露到客户端

服务端组件传给客户端组件的 props 会被序列化进页面，用户能在网络面板里看到全部字段：

```tsx
// ❌ 整条用户记录（含密码哈希、手机号）都会发到浏览器
const user = await db.user.findUnique({ where: { id } })
return <Profile user={user} />
```

防御思路是在服务端收口：

- **数据访问层（DAL）**：所有取数都经过一个只在服务端运行的模块，里面做鉴权，返回只含页面所需字段的 **DTO**。官方还建议只让 DAL 读取 `process.env`
- **`import 'server-only'`**：在 DAL 和含密钥的模块顶部加上，一旦被客户端组件引入，构建直接报错
- **taint API**（`experimental_taintObjectReference` 等）可以标记某个对象或值不允许传给客户端，但它是实验性的辅助手段，不能代替 DTO 过滤

```ts
// lib/dal.ts
import 'server-only'
import { cache } from 'react'

export const getProfile = cache(async (userId: string) => {
  const session = await verifySession() // 未登录直接抛错或重定向
  if (session.userId !== userId) throw new Error('无权访问')
  const u = await db.user.findUnique({ where: { id: userId } })
  return u && { name: u.name, avatar: u.avatar } // 只返回 UI 需要的字段
})
```

环境变量同理：只有 `NEXT_PUBLIC_` 开头的变量会在**构建时内联**进客户端 JS，任何人都能看到，密钥绝不能加这个前缀。更多泄露途径见 [前端代码里的敏感信息泄露](/basics/web-security/08-sensitive-data)。

### Server Actions 是公开的入口

`'use server'` 导出的函数会变成一个 POST 端点，即使页面上没有按钮调用它，也能被直接请求。页面做了登录校验，不代表页面里的 action 也受保护。每个 action 都要：

1. **鉴权**：在 action 内部验证会话
2. **校验输入**：表单数据、参数都是不可信的，用 schema 校验类型和范围
3. **检查资源归属**：确认要改的记录属于当前用户，防止改 ID 就能操作别人的数据（越权访问）
4. **控制返回值**：返回值会发到客户端，只返回 UI 需要的内容

框架会比对请求的 Origin 和 Host，不一致就拒绝，用来防跨站请求伪造。经过反向代理、域名不一致时，要用 `experimental.serverActions.allowedOrigins` 显式配置允许的来源，而不是关掉检查。闭包变量虽然会被加密，官方也明确说不要依赖加密来保护敏感值。Server Actions 的基本机制见 [Server Actions](/basics/ssr/06-server-actions)。

### 鉴权放在哪一层

Proxy 适合做**乐观检查**：读 cookie 看有没有会话，没有就跳登录页。但它不该是唯一防线：matcher 写漏了路径、框架出现绕过漏洞、Server Action 走的路径被排除，都会让检查失效。真正的授权放在靠近数据的地方，也就是 DAL 和每个 Server Action 里。layout 在客户端导航时不会重新渲染，也不能决定子页面是否渲染，所以也不适合放鉴权。Proxy 的用法见 [Next.js 的 Proxy](/basics/nextjs/06-proxy)。

### 图片优化和 CSP

- **图片优化接口**会替你去请求远程图片。`images.remotePatterns` 写得太宽（比如只写协议、通配所有域名），这个接口就可能被滥用成代理，去访问内网地址或耗尽服务器资源，属于 SSRF 风险。按协议、域名、路径写到最具体；新版本默认也不再优化指向本地 IP 的图片
- **SVG**：默认不优化 SVG，开启 `dangerouslyAllowSVG` 时要同时配置 `contentDispositionType` 和 `contentSecurityPolicy`
- **CSP 用 nonce**：每个请求生成新的 nonce，在 Proxy 里写进 CSP 响应头和请求头，页面读出来传给脚本。这要求页面**动态渲染**，静态页面构建时没有请求，无法注入 nonce。原理见 [CSP](/basics/web-security/01-csp)

### 框架自身的漏洞

近年 Next.js 和上游 React 出过多个严重漏洞，涉及 React Server Components 协议的反序列化、`'use cache'`、图片优化（包括上游图片库）、Proxy 绕过、缓存投毒等，部分可以导致未授权的远程代码执行。应对方式：

- 订阅官方安全公告，按公告给出的修复版本升级，不要停留在已不维护的版本线上
- 依赖锁文件纳入代码审查，用依赖扫描工具在 CI 里发现带漏洞的版本
- 在修复前已经暴露在公网、可能被利用过的应用，升级之后还要**轮换密钥**（数据库密码、API 密钥、会话签名密钥等）
- 不在代码里写死密钥，即使源码意外暴露也不会直接泄露凭证

## 面试官可能追问

::: details 用了服务端组件，代码不会发到浏览器，是不是就不用担心泄露了？
服务端组件的代码确实不进客户端包，但它**传给客户端组件的数据**会进页面。把整个数据库对象作为 props 传下去，所有字段都会暴露。另外 `NEXT_PUBLIC_` 变量和客户端组件里引入的模块也会进包。
:::

::: details Server Action 的 ID 是加密的，别人猜不到，还需要鉴权吗？
需要。action ID 是为了不暴露函数实现，不是访问控制。页面加载时 ID 就已经在 HTML 或 JS 里，任何能打开页面的人都能拿到并直接请求。
:::

::: details 只在 Proxy 里校验登录，会有什么问题？
matcher 漏配的路径、被排除路径上的 Server Action 都不经过检查；Proxy 里也不适合查库，只能做乐观判断；框架层出现过绕过 Proxy 的漏洞。所以授权要在 DAL 和每个 action 里再做一次。
:::

## 易错点

- 把 ORM 查出的整条记录直接传给客户端组件，敏感字段随页面下发
- 给密钥加上 `NEXT_PUBLIC_` 前缀"方便前端用"，密钥被内联进公开的 JS
- 只在页面或 Proxy 里鉴权，Server Action 内部不校验身份和资源归属
- `remotePatterns` 写成通配所有域名，图片优化接口变成公开代理
