---
difficulty: 2
tags: [原理, 实践]
---

# Next.js 里的错误怎么处理？error.tsx、global-error、notFound() 和 redirect() 是怎么配合的？

::: tip 一句话回答
先分两类错误。**预期内的错误**（表单校验失败、没有权限）当作**返回值**处理，Server Function 返回错误信息，客户端用 `useActionState` 显示。**意外错误**交给错误边界：路由段里的 **`error.tsx`** 是客户端组件，接收 `error` 和 `retry`；根布局出错时由 **`global-error.tsx`** 兜底。**`notFound()` 和 `redirect()`** 不是普通函数，它们通过**抛出框架内部的特殊错误**中断渲染，所以不能被自己的 try/catch 吞掉。
:::

## 详细解析

### 预期内的错误：用返回值

```tsx
// app/actions.ts
'use server'
export async function createPost(prev: { message: string }, formData: FormData) {
  const title = String(formData.get('title') ?? '')
  if (!title) return { message: '标题不能为空' } // 不 throw，返回给 UI
  await db.post.create({ data: { title } })
  return { message: '' }
}
```

```tsx
// app/new/form.tsx
'use client'
import { useActionState } from 'react'
import { createPost } from '../actions'

export function PostForm() {
  const [state, formAction, pending] = useActionState(createPost, { message: '' })
  return (
    <form action={formAction}>
      <input name="title" />
      <p aria-live="polite">{state.message}</p>
      <button disabled={pending}>发布</button>
    </form>
  )
}
```

校验失败抛异常会触发错误边界，整块 UI 换成错误页，体验很差。

### error.tsx：路由段的错误边界

```tsx
// app/dashboard/error.tsx
'use client' // 错误边界必须是客户端组件

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div>
      <p>加载失败，请稍后再试</p>
      {error.digest && <small>错误编号：{error.digest}</small>}
      <button onClick={() => retry()}>重试</button>
    </div>
  )
}
```

- `retry()` 会重新请求数据并重新渲染边界内的子树；`reset()` 只清掉错误状态、不重新取数，大多数情况用 `retry`
- 生产环境下，服务端组件抛出的错误 `message` 会被换成通用文本，防止泄露内部信息。用 `error.digest` 到服务端日志里找原始错误。客户端组件抛出的错误保留原 message
- 嵌套关系是 `layout → template → error → loading → not-found → page`，所以 `error.tsx` **包不住同一段的 layout**。layout 出错由上一级的 error 处理
- 根布局没有上一级，要用 `app/global-error.tsx`。它会替换整个根布局，所以必须自己写 `<html>` 和 `<body>`，也不支持导出 metadata

错误边界只捕获渲染过程中的错误，事件处理函数、`setTimeout` 这类异步回调里的错误要自己 try/catch，原理见 [React 的错误边界](/basics/react/15-error-boundary)。

### notFound() 和 redirect()：靠抛错中断渲染

调用 `notFound()` 会渲染最近的 `not-found.tsx`；`redirect()` 默认是 307 临时重定向，`permanentRedirect()` 是 308。两者的返回类型都是 `never`，内部实现是抛出一个框架识别的特殊错误。这带来一个坑：

```tsx
import { notFound, unstable_rethrow } from 'next/navigation'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let post
  try {
    post = await getPost(id)
  } catch (err) {
    unstable_rethrow(err) // 放在 catch 开头，把框架的控制流错误原样抛出
    console.error(err)
    throw new Error('获取文章失败')
  }
  if (!post) notFound() // ✅ 放在 try 外面
  return <h1>{post.title}</h1>
}
```

把 `redirect()` 写在 try 里，catch 会把它当普通错误吞掉，跳转就失效了。要么挪到 try 外面，要么在 catch 开头调用 `unstable_rethrow`。

### 流式输出后的状态码

页面开始流式输出后，HTTP 状态码已经发出去了。这时再触发 `notFound()`，页面会显示 not-found 的 UI，但状态码仍是 200。Next.js 会注入 `<meta name="robots" content="noindex">`，避免搜索引擎收录。要拿到真正的 404，就在流开始之前（比如 Suspense 边界之外、页面最开始）判断并调用 `notFound()`。

## 面试官可能追问

::: details error.tsx 为什么必须是客户端组件？
错误边界依赖 React 在客户端捕获渲染错误并切换 UI 的能力，还要响应"重试"点击，这些都只能在客户端完成。服务端渲染时出错，框架会把错误信息传到客户端，由这个边界显示。
:::

::: details 生产环境看不到错误信息，怎么排查？
页面上只有通用文本和 `digest`。服务端日志里会打印完整错误和同一个 digest，按它对应。一般还会接入错误监控服务，集中上报服务端错误。
:::

::: details Server Action 里调用 redirect() 要注意什么？
同样要放在 try/catch 外面，通常写在 action 的最后。Server Action 里 `redirect` 的默认导航方式是 push；表单在没有 JS 的情况下提交时返回 303。客户端事件处理函数里不能调用 `redirect()`，要用 `useRouter().push()`。
:::

## 易错点

- 以为 `error.tsx` 能捕获同一段 `layout.tsx` 的错误，实际要靠上一级的 error 或 `global-error`
- 写了 `global-error.tsx` 却没写 `<html>`、`<body>`，根布局出错时页面结构不完整
- 把 `redirect()`、`notFound()` 包在 try 里，被 catch 吞掉后页面继续往下渲染
- 用 throw 处理表单校验失败，导致整块 UI 被错误页替换，应改成返回值
