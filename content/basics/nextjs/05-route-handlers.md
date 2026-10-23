---
difficulty: 2
tags: [实践, 对比]
---

# Next.js 的 Route Handlers 怎么写？什么时候该用它，而不是 Server Actions 或者在服务端组件里直接取数据？

::: tip 一句话回答
在 `app` 目录下放 `route.ts`，导出 `GET`、`POST` 等以 HTTP 方法命名的函数，参数是 Web 标准的 **Request**（Next.js 传入的 `NextRequest` 多了 `cookies` 和 `nextUrl`），返回 **Response**。它就是一个普通的 HTTP 接口，**默认不缓存**，不参与布局和客户端导航。选择原则：**页面读数据用服务端组件，自己页面上的写操作用 Server Function，给外部调用的用 Route Handler**，比如 Webhook、移动端接口、文件下载、OAuth 回调。三种方式都要自己做鉴权和输入校验。
:::

## 详细解析

### 基本写法

```ts
// app/api/posts/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params // 第二个参数里的 params 是 Promise
  const fields = request.nextUrl.searchParams.get('fields')
  const post = await db.post.findUnique({ where: { id } }) // db 是项目自己的数据库客户端，导入省略
  if (!post) return NextResponse.json({ message: 'not found' }, { status: 404 })
  return NextResponse.json(fields === 'title' ? { title: post.title } : post)
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(request.cookies.get('session')?.value)
  if (!session) return new Response(null, { status: 401 })
  const { id } = await params
  await db.post.delete({ where: { id, authorId: session.userId } }) // 校验资源归属
  return new Response(null, { status: 204 })
}
```

- 支持 `GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`HEAD`、`OPTIONS`。没导出的方法返回 405；没写 `OPTIONS` 时自动实现，并设置 `Allow` 头
- TypeScript 里可以用全局的 `RouteContext<'/api/posts/[id]'>` 给第二个参数标类型
- 同一个路由段不能同时有 `route.ts` 和 `page.tsx`，`app/route.ts` 会和 `app/page.tsx` 冲突，`app/api/route.ts` 则没问题
- 只在 `app` 目录内有效，段配置（`dynamic`、`runtime` 等）和页面一样

### 缓存

Route Handler 默认不缓存，每次请求都执行。只有 GET 能开启缓存，同一个文件里的 POST 等方法永远不缓存。

开启 Cache Components 后，GET 和页面用同一套模型：不碰未缓存的数据时可以预渲染。要把数据库查询的结果缓存起来，不能直接在 handler 里写 `'use cache'`，要抽成单独的函数：

```ts
// app/api/products/route.ts
import { cacheLife } from 'next/cache'

async function getProducts() {
  'use cache'
  cacheLife('hours')
  return db.product.findMany()
}

export async function GET() {
  return Response.json(await getProducts())
}
```

handler 里读了 `request.headers`、`cookies()`，或者做了未缓存的请求，就会在请求时执行。缓存的编程模型见 [Cache Components](/basics/nextjs/03-cache-components)。

### 适用场景

- **Webhook 回调**：支付、代码托管平台、CMS 推送事件，要按对方的格式校验签名、返回指定状态码
- **给外部的接口**：移动端 App、小程序、第三方系统调用的 REST 接口
- **文件和流**：生成 CSV 下载、返回图片、用 `ReadableStream` 做流式响应（比如转发大模型的流式输出）
- **OAuth 回调**：第三方登录跳回来时，用 code 换 token、写 cookie、重定向

### 三种方式怎么选

| 需求 | 用什么 | 原因 |
| --- | --- | --- |
| 页面初始数据 | 服务端组件里直接查 | 不多一次 HTTP 往返，结果直接进 HTML |
| 本站表单提交、点赞、删除 | Server Function | 和组件写在一起，支持渐进增强，能直接刷新缓存 |
| 外部系统调用，或需要控制 HTTP 细节 | Route Handler | 有稳定的 URL、方法、状态码和响应头 |

一个常见的反模式是：服务端组件里 `fetch('/api/posts')` 调自己的 Route Handler。这在服务端多绕了一次 HTTP 请求，还要处理绝对地址的问题，直接调用查询函数就行。Server Actions 的原理和安全问题见 [Server Actions](/basics/ssr/06-server-actions)。

## 面试官可能追问

::: details Route Handler 和 Server Action 本质上都是 POST 接口，安全上有什么区别？
都可以被任何人直接请求，都要在函数内部做认证、授权和输入校验。区别是 Server Action 有框架帮忙做了一些事，比如比较 `Origin` 和 `Host`、加密闭包变量；Route Handler 完全是自己的接口，CSRF 防护、CORS、限流都要自己考虑。用 cookie 鉴权的写接口，要检查来源或者用 CSRF token。
:::

::: details Proxy 里已经校验了登录，Route Handler 里还要校验吗？
要。Proxy 适合做读 cookie 的乐观检查和重定向，matcher 写漏一个路径就失效了，文档也说它不应该是唯一的防线。真正的权限检查放在靠近数据的地方，Route Handler 里或者它调用的数据访问层里。
:::

::: details 怎么在 Route Handler 里返回流式响应？
直接返回一个以 `ReadableStream` 为 body 的 `Response`，Web 标准的写法就行。自托管时前面的反向代理要关闭响应缓冲，否则流会被攒成一整块再发出去。
:::

## 易错点

- 在同一个段放 `route.ts` 和 `page.tsx`
- 以为 Route Handler 默认缓存 GET；现在默认是每次都执行
- 在服务端组件里请求自己的 Route Handler 取数据，多一次无意义的 HTTP 往返
- 忘了 `params` 是 Promise，直接解构出来的是 undefined
