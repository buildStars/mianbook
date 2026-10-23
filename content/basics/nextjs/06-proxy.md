---
difficulty: 2
tags: [安全, 实践]
---

# Next.js 的 Proxy（以前叫 Middleware）能做什么？为什么不能只靠它做登录校验？

::: tip 一句话回答
Proxy 是放在项目根目录（或 `src` 下）的 **`proxy.ts`**，导出一个 `proxy` 函数，在路由渲染之前对请求做**重定向、重写、改请求头和响应头、读写 cookie，或者直接返回响应**。旧的 `middleware` 文件约定已经废弃并改名为 proxy。它对每个匹配的请求都运行，**包括预取**，所以只适合读 cookie 做**乐观检查**，不要在里面查数据库。真正的权限校验要放在**数据访问层**和每个 Server Function、Route Handler 里，Proxy 只是第一道门，不是唯一一道。
:::

## 详细解析

### 文件和写法

```ts
// proxy.ts（和 app 目录同级）
import { NextResponse, type NextRequest } from 'next/server'

export function proxy(request: NextRequest) {
  const session = request.cookies.get('session')?.value
  // 乐观检查：只看有没有会话 cookie，不查库
  if (!session && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  const response = NextResponse.next()
  response.headers.set('x-frame-options', 'DENY')
  return response
}

export const config = {
  // 排除静态资源和图片优化接口
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
```

- 一个文件只能有一个 proxy，可以是默认导出或具名导出 `proxy`
- `config.matcher` 必须是**静态常量**，写成变量会被忽略。可以是字符串、数组、正则风格的路径，或者带 `has`、`missing` 条件的对象
- **不写 matcher 会对所有请求运行**，包括 `_next/static`、`_next/image` 和 public 下的文件，白白增加开销
- 旧项目的 `middleware.ts` 可以用官方 codemod 迁移，主要是改文件名和函数名

### 能做的事

| 操作 | 写法 |
| --- | --- |
| 重定向 | `NextResponse.redirect(url)` |
| 重写（URL 不变，内容换成另一个路由） | `NextResponse.rewrite(url)` |
| 改发给后续路由的请求头 | `NextResponse.next({ request: { headers } })` |
| 改响应头 | `response.headers.set(...)` |
| 读写 cookie | `request.cookies.get`、`response.cookies.set / delete` |
| 直接响应 | 返回 `Response` 或 `NextResponse` |

常见用途：未登录跳登录页、按语言或实验分组重写、给每个请求生成 CSP nonce、加安全响应头。

### 执行时机和运行时

```text
next.config 的 headers → redirects → Proxy → beforeFiles rewrites
→ 文件系统路由 → afterFiles rewrites → 动态路由 → fallback
```

Proxy 在路由渲染之前执行。它运行在 **Node.js 运行时**，不能在 proxy 文件里配置 `runtime`，也不支持 edge；确实需要 Edge 的场景只能继续用已经废弃的 middleware。静态导出（`output: 'export'`）不支持 Proxy。

### 为什么不能只靠它做登录校验

1. **它跑得太频繁**：每个匹配的请求都会经过，包括 `<Link>` 的预取。在里面查数据库，相当于给每次预取都加一次查询
2. **它覆盖不全**：Server Function 不是独立路由，而是向所在页面发的 POST。matcher 排除了某个路径，这个路径上的 Server Function 调用也就不经过 Proxy。而且导出的 Server Action 可以被直接调用，不一定从你的页面发起
3. **单层拦截有风险**：Next.js 历史上出现过多次在特定配置下绕过中间件、跳过其中鉴权逻辑的漏洞。只靠 Proxy 的应用，一旦这一层被绕过，数据就直接暴露；在数据层也校验的应用，被绕过也只是看到一个空壳页面
4. **layout 也不可靠**：layout 在客户端导航时不重新渲染，也不控制同一路由下其他部分是否渲染，在 layout 里判断登录同样拦不住

推荐的分层：

```text
Proxy        读 cookie，没会话就跳登录页（乐观检查，体验优化）
数据访问层    verifySession() 查会话 + 检查资源归属（真正的安全边界）
Server Function / Route Handler   每个入口自己再校验一次
```

```ts
// lib/dal.ts
import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

export const verifySession = cache(async () => {
  const token = (await cookies()).get('session')?.value
  // db 代表项目自己的数据库客户端（伪代码，导入省略）
  const session = token ? await db.session.find(token) : null // 安全检查：查库
  if (!session) redirect('/login')
  return { userId: session.userId }
})
```

SSR 场景下 cookie 怎么转发、Set-Cookie 怎么回传，见 [SSR 应用里怎么处理登录态](/basics/ssr/10-ssr-auth)。

## 面试官可能追问

::: details Proxy 里能不能调用 revalidateTag？
不能。`revalidateTag` 只能在 Server Functions 和 Route Handlers 里调用，Client Components 和 Proxy 里都不行。Proxy 的职责是改写请求和响应，不负责缓存失效。
:::

::: details 重写（rewrite）和重定向（redirect）有什么区别？
重定向返回 3xx，浏览器地址栏变成新地址，会多一次往返。重写在服务端把请求交给另一个路由处理，地址栏不变，用户感知不到。A/B 实验、多租户按域名分发通常用重写，登录跳转用重定向。
:::

::: details 为什么在 Proxy 里查数据库不好？
Proxy 处在每个请求的关键路径上，预取也会触发它。查库会让每个请求、每次预取都多一次网络往返，页面整体变慢，数据库压力也成倍增加。要查库的安全检查应该放在真正读数据的地方，并用 React 的 `cache` 在同一请求内去重。
:::

::: details 用 Proxy 做 CSP nonce 要注意什么？
每个请求都要生成新的 nonce，同时写进请求头（供页面读取）和 `Content-Security-Policy` 响应头。用了 nonce 的页面必须动态渲染，因为静态页面在构建时没有请求，无法注入每次不同的值。
:::

## 易错点

- 不写 matcher，结果 Proxy 对每个静态文件和图片都运行一遍
- 把 matcher 写成从变量拼出来的值，被框架静默忽略，规则不生效
- 认为页面在 Proxy 里拦住了，Server Action 就安全了；实际上每个 Server Action 都要单独校验身份和权限
- 还按旧习惯给 proxy 配置 edge 运行时，proxy 文件里写 `runtime` 会直接报错
