---
difficulty: 2
tags: [场景题, 性能优化]
---

# Next.js 项目的客户端 JS 太大，怎么通过调整 'use client' 边界来优化？

::: tip 一句话回答
`'use client'` 划的是**模块边界**：标了它的文件，以及它 import 的所有模块，都会打进客户端包。客户端 JS 变大，多半是边界放得太高，比如页面或布局顶部直接写 `'use client'`，或者 Provider 把整个应用包成了客户端组件。优化思路是**把边界往叶子下沉**：只把需要交互的小组件标成客户端组件，服务端组件通过 **`children` 或其他 props 插槽**传进去，Provider 单独写成只接收 `children` 的组件。再配合 **`import 'server-only'`** 防止服务端代码误入客户端，用打包分析工具定位大依赖。
:::

## 详细解析

概念层面的区别见 [React Server Components 是什么](/basics/react/11-server-components)，这里讲怎么排查和改造。

### 先定位：包大在哪里

1. 用打包分析工具看每个路由的客户端 chunk 里有什么。Next.js 有实验性的 `next experimental-analyze` 命令（支持 Turbopack），`@next/bundle-analyzer` 是 webpack 插件，只在用 `next build --webpack` 构建时可用
2. 找出体积大的依赖：Markdown 解析、代码高亮、日期库、图表库，这些往往只用来渲染一次静态内容
3. 顺着依赖往上找是哪个 `'use client'` 文件把它拉进来的。这个文件就是要动的边界

### 常见问题和改法

| 问题 | 改法 |
| --- | --- |
| `page.tsx` 顶部写了 `'use client'`，整页都进客户端 | 页面保持服务端组件，只把有状态的部分抽出去 |
| 为一个点赞按钮，把整篇文章组件标成客户端组件 | 按钮单独成一个客户端组件，文章正文留在服务端 |
| 根布局里直接写 Context Provider，布局变成客户端组件 | Provider 抽成单独文件，只接收 `children` |
| 第三方组件只能在客户端用，直接在服务端组件里 import 报错 | 写一层薄包装文件，只加 `'use client'` 再导出 |
| 客户端组件里 import 了 Markdown 渲染库 | 在服务端组件里渲染好 HTML 或 JSX，再作为 props 传入 |

### 插槽：让服务端内容穿过客户端组件

客户端组件不能 import 服务端组件，但可以通过 props 接收它渲染好的结果：

```tsx
// app/ui/collapsible.tsx
'use client'
import { useState, type ReactNode } from 'react'

export function Collapsible({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <section>
      <button onClick={() => setOpen(!open)}>{title}</button>
      {open && children}
    </section>
  )
}
```

```tsx
// app/post/[id]/page.tsx（服务端组件）
import { Collapsible } from '@/app/ui/collapsible'
import { renderMarkdown } from '@/lib/markdown' // 大依赖只在服务端运行

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const post = await getPost(id)
  return (
    <Collapsible title={post.title}>
      {/* 渲染结果作为 children 传入，Markdown 库不会进客户端包 */}
      {await renderMarkdown(post.body)}
    </Collapsible>
  )
}
```

Provider 同理：`providers.tsx` 标 `'use client'`，只渲染 `<ThemeContext value={...}>{children}</ThemeContext>`，根布局仍是服务端组件。被包住的页面不会因此变成客户端组件。

### 序列化和传参

服务端组件传给客户端组件的 props 会序列化进 RSC payload：

- 只能传可序列化的值，普通函数传不过去（Server Function 除外）
- 只传需要的字段。把整条数据库记录传给一个只显示用户名的组件，payload 变大，还可能把不该给前端的字段送出去

### 守住边界

```ts
// lib/db.ts
import 'server-only' // 被客户端组件 import 时构建直接报错
```

数据库客户端、带密钥的 SDK 封装都加上这一行。它把"误打进客户端"从运行时的泄露变成构建期的错误。

## 面试官可能追问

::: details 客户端组件里 import 的子组件没写 'use client'，它是服务端组件吗？
不是。`'use client'` 是边界，边界以下 import 的模块都按客户端模块打包，不需要每个文件都写。所以在一个客户端组件里 import 大库，那个库就进了客户端包。只有通过 props 传进来的服务端渲染结果才留在服务端。
:::

::: details 客户端组件在服务端会执行吗？
会。首次请求时客户端组件也在服务端渲染出 HTML，然后在浏览器里水合。"客户端组件"的意思是它的代码要下发到浏览器，不是只在浏览器运行。所以客户端组件里也不能在渲染时直接访问 `window`。
:::

::: details 只在浏览器能用的大组件（比如富文本编辑器）怎么处理？
放在一个客户端组件里，用 `next/dynamic` 或 `React.lazy` 按需加载，用户真正打开编辑器时才下载那部分 JS。这和边界下沉是两件事：下沉减少"必须下载"的代码，动态导入把"可能用到"的代码推迟。
:::

## 易错点

- 为了用一个 hook，在页面最顶部加 `'use client'`，整页的依赖都进了客户端包
- 以为客户端组件里能直接 import 服务端组件；要用 children 或其他 props 插槽传进去
- 把完整的数据对象当 props 传给客户端组件，敏感字段随 payload 下发到浏览器
- Provider 写在根布局文件里并给布局加 `'use client'`，结果整个布局失去服务端组件的能力
