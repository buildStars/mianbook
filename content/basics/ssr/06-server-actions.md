---
difficulty: 3
tags: [安全, 新技术]
---

# Server Actions 是什么？使用时有哪些安全注意点？

::: tip 一句话回答
Server Actions 是用 `'use server'` 标记的**服务端异步函数**（React 文档统称 Server Functions，传给 `action` 使用时叫 Server Action），可以直接作为 `<form>` 的 `action`，也可以在客户端组件里像普通函数一样调用。构建时框架把它替换成一个引用，调用时向服务端发一个 **POST 请求**，参数序列化后传过去，在服务端执行再把结果返回。它的本质是**框架自动生成的公开接口**，任何人都能绕过界面直接调用，所以**每个 Action 内部都要自己做鉴权、权限判断和输入校验**，不能依赖"按钮只对管理员显示"；返回值和闭包捕获的变量都会到达客户端，不能带敏感数据。
:::

## 详细解析

### 基本用法

```ts
// app/posts/actions.ts：文件顶部的 'use server' 让所有导出函数都成为 Server Function
'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'

const schema = z.object({ title: z.string().trim().min(1).max(100) })

export async function createPost(prevState: { error: string | null }, formData: FormData) {
  // 1. 鉴权：不能假设只有登录用户才看得到这个表单
  const session = await getSession()
  if (!session) return { error: '请先登录' }

  // 2. 校验输入：FormData 的内容完全由客户端决定
  const parsed = schema.safeParse({ title: formData.get('title') })
  if (!parsed.success) return { error: '标题长度不合法' }

  // 3. 作者从会话里取，不接收客户端传来的 authorId
  await db.post.create({ data: { title: parsed.data.title, authorId: session.userId } })
  revalidatePath('/posts')
  return { error: null } // 只返回界面需要的东西
}
```

```tsx
'use client'
import { useActionState } from 'react'
import { createPost } from './actions'

export function NewPostForm() {
  const [state, formAction, isPending] = useActionState(createPost, { error: null })
  return (
    <form action={formAction}>
      <input name="title" />
      <button disabled={isPending}>发布</button>
      {state.error && <p>{state.error}</p>}
    </form>
  )
}
```

- `'use server'` 可以写在文件顶部，也可以写在服务端组件里某个 async 函数体的第一行；客户端组件里不能内联定义，只能从 `'use server'` 文件导入，或者通过 props 从服务端组件接收
- 在表单之外调用时，放在 `startTransition` 里执行；传给 `action` 时框架会自动处理。`useActionState` 等 Hook 的用法见 [React 19 新特性](/basics/react/12-react19)
- React 文档的定位是：Server Functions 用于**修改**服务端状态，不推荐用来读取数据

### 本质：框架生成的 POST 接口

```text
构建时：'use server' 函数 → 客户端包里只留一个 action ID 和调用器，实现留在服务端
运行时：客户端调用 createPost(...)
       → 向当前页面 URL 发 POST，带上 action ID 和序列化后的参数
       → 服务端找到对应的函数执行 → 返回结果，需要时连同重新渲染的页面数据一起返回
```

在浏览器开发者工具里就能看到这个请求，任何人都可以复制它、改参数再发一次。Next.js 会把没被用到的 Action 从构建产物里去掉、对 action ID 加密，这能减少暴露面，但不能替代应用自己的校验。

### 安全注意点

1. **每个 Action 内部都要鉴权**：页面里的登录判断不会延伸到 Action，它是一个独立的入口。Proxy（以前叫 Middleware）会处理发到页面路径的 Action 请求，但是否覆盖取决于 matcher，改了 matcher 或者把 Action 挪到别的路由，保护就会悄悄失效，所以也不能只靠它。不仅要查"是谁"（认证），还要查"能不能操作这条数据"（授权），否则用户改个 id 就能删别人的帖子
2. **校验所有输入**：TypeScript 类型只在编译期有效，运行时参数可以是任何值，要用 zod 这类库校验。客户端只传要操作的 id 和要修改的字段，归属、价格、角色这类数据从服务端重新读取
3. **控制返回值**：返回值会序列化后发给客户端，只返回界面需要的字段，不要直接返回整条数据库记录
4. **闭包里不要带敏感数据**：在服务端组件里内联定义的 Action 如果用到了外层变量，这些值会随页面发到客户端、调用时再发回来。Next.js 会加密这些值，但官方也不建议只依赖加密，敏感数据应该在 Action 内部重新查询
5. **CSRF**：Action 只能通过 POST 调用，Next.js 还会比对请求的 `Origin` 和 `Host`，不一致就拒绝；通过反向代理或多个域名访问时要配置允许的来源 `serverActions.allowedOrigins`。登录 Cookie 同时设置 SameSite
6. **滥用防护**：发短信、发邮件、写库这类操作加限流；删除、改密码等危险操作要求重新验证身份

把鉴权和数据库操作统一放进只在服务端运行的数据访问层（模块里 `import 'server-only'`），Action 只负责调用，能避免某个 Action 忘了校验。

### 渐进增强

把 Server Action 传给 `<form action>` 后，表单不必等 JS 加载完才能用。按 Next.js 文档的说法：服务端组件渲染的表单，JS 还没加载完或者被禁用时也能提交，浏览器按原生方式发 POST，服务端执行后返回新页面；客户端组件里的表单，JS 还没加载完时提交会先排队，并优先水合这个组件。水合完成后都改为无刷新提交。这对弱网下的首屏表单（登录、搜索、评论）有意义。

### 和单独写 API 路由怎么选

| 场景 | 选择 |
| --- | --- |
| 应用内部的表单提交、按钮触发的修改 | Server Action：不用设计接口，能和缓存失效、页面刷新配合 |
| 给移动端、第三方、webhook 调用 | Route Handler 或独立的后端接口：有稳定的 URL 和协议 |
| 读取数据 | 服务端组件里直接获取；客户端需要时用 Route Handler |
| 要并行发起、流式返回、下载文件，或者精细控制状态码和缓存头 | Route Handler |

Next.js 在客户端会逐个派发 Server Action：连续触发三个，后一个要等前一个完成，所以不适合用 `Promise.all` 并行调用。

## 面试官可能追问

::: details 页面已经做了登录校验，Action 里还要再校验吗？
要。页面级的校验只决定渲染什么界面，Action 是可以被直接 POST 的独立入口，攻击者不需要打开那个页面。官方文档也明确说明，页面级的鉴权不会延伸到页面里定义的 Server Action。
:::

::: details 部署新版本后，用户操作时报"找不到 Server Action"是怎么回事？
action ID 是构建产物的一部分，新的部署通常会生成新的 ID。用户还开着旧版本的页面，调用的是旧 ID，新服务器上找不到对应的函数。缓解办法：滚动发布，避免新旧版本突然切换；多实例部署时配置统一的加密密钥 `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`；界面上把这个错误处理成"请刷新后重试"。
:::

::: details Server Action 和自己用 fetch 调接口相比，好在哪里，代价是什么？
好处：像调用函数一样调用，不用约定 URL 和请求格式，类型直接共享；变更后在同一次响应里带回刷新后的页面数据；支持渐进增强。代价：参数和返回值要能被序列化；客户端串行派发，不适合高频或并行的请求；它不是一个稳定的公开接口，别的端没法调用；调试时看到的是框架的私有协议。
:::

::: details 为什么不推荐用 Server Action 读数据？
它走 POST，没法利用 HTTP 缓存；客户端串行派发，多个读取会排队；而且读取数据有更合适的地方：服务端组件里直接获取，数据随页面一起返回。React 文档对它的定位就是处理修改操作。
:::

## 易错点

- 把 `'use server'` 当成"这个组件在服务端渲染"的标记，它标记的是可被客户端调用的函数，见 [Server Components](/basics/react/11-server-components)
- 只在页面或 Proxy 里做鉴权，Action 内部不查
- 直接把客户端传来的整个对象写进数据库，包括 id、作者、金额这类字段
- 在 Action 里返回整条数据库记录，把内部字段暴露给客户端
