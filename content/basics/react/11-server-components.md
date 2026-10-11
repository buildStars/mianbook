---
difficulty: 3
tags: [原理, 新特性, 对比]
---

# React Server Components 是什么？和 SSR 有什么区别？

::: tip 一句话回答
Server Components（RSC）是**只在服务端运行**的组件：在构建时或每次请求时执行，可以是 async 函数，直接读数据库、文件系统，**它的代码和依赖不会进入客户端的 JS 包**，浏览器拿到的只是渲染结果（RSC payload）。需要交互的组件在文件顶部写 `'use client'`，成为客户端组件。SSR 解决的是"首屏先出 HTML"，所有组件的代码照样下发到浏览器再**水合**；RSC 解决的是"哪些代码根本不用下发"。两者不冲突，Next.js App Router 这类框架里通常同时使用。
:::

## 详细解析

### 服务端组件能做什么

在支持 RSC 的框架里，组件**默认就是服务端组件**，没有专门的指令。它可以写成 async 函数，在渲染时直接 await 数据：

```jsx
// app/posts/[id]/page.jsx：服务端组件（默认）
import { format } from 'date-fns' // 只在服务端用，不会打进客户端包
import { db } from '@/lib/db'
import LikeButton from './LikeButton'

export default async function PostPage({ params }) {
  const { id } = await params // Next.js 15 起 params 是 Promise
  const post = await db.post.findUnique({ where: { id } }) // 直接查库，不用另写接口
  return (
    <article>
      <h1>{post.title}</h1>
      <time>{format(post.createdAt, 'yyyy-MM-dd')}</time>
      <p>{post.content}</p>
      <LikeButton postId={post.id} initialCount={post.likes} />
    </article>
  )
}
```

```jsx
// LikeButton.jsx：客户端组件
'use client'
import { useState } from 'react'

export default function LikeButton({ postId, initialCount }) {
  const [count, setCount] = useState(initialCount)
  return <button onClick={() => setCount(count + 1)}>赞 {count}</button>
}
```

服务端组件不能用 useState、useEffect、事件处理函数和浏览器 API，这些都要放到客户端组件里。

### 'use client' 划分的是模块边界

- `'use client'` 写在文件最顶部（注释之后、import 之前），标记这个模块**及它导入的所有模块**都属于客户端代码，边界划在**模块依赖树**上，不是组件树上
- 客户端组件不能 import 服务端组件（被导入后就变成了客户端代码），但可以通过 `children` 等 props 接收服务端组件渲染好的结果，所以"客户端组件包着服务端组件"是可以的
- `'use server'` 标记的是 **Server Functions**（可以被客户端调用的服务端异步函数），不是服务端组件。官方 2024 年 9 月起统一叫 Server Functions，传给 action 属性或在 Action 中调用时才叫 Server Action

### RSC payload 和序列化边界

服务端组件不输出 HTML，而是输出一种序列化的树结构（RSC payload）：

```text
服务端：执行服务端组件 → 得到 RSC payload
  ├─ 服务端组件：只留下渲染结果（div、h1、文本……）
  └─ 客户端组件：留一个"引用"（对应哪个 JS 模块）+ 它的 props
客户端：React 读取 payload，加载引用的客户端组件代码，拼成完整的组件树
```

所以服务端传给客户端组件的 props **必须可序列化**：字符串、数字、布尔、null、undefined、数组、普通对象、Date、Map、Set、Promise、JSX 都可以；普通函数、class 实例、`Symbol('x')` 这类不行。函数里唯一的例外是 Server Function，传过去的只是一个引用，客户端调用时发请求到服务端执行。

客户端路由跳转时，框架只请求新页面的 RSC payload，React 把它合并进现有的树，共享布局里客户端组件的 state 不会丢。

### 和 SSR 的区别

| | SSR | Server Components |
| --- | --- | --- |
| 产物 | HTML | RSC payload（序列化的组件树） |
| 组件代码 | 全部下发，浏览器上再执行一遍做水合 | 服务端组件的代码不下发 |
| 执行时机 | 每次请求（或构建时，即 SSG） | 构建时或每次请求 |
| 解决的问题 | 首屏速度、SEO | 减少客户端 JS、数据就近获取 |
| 客户端组件 | 在服务端也渲染一次 | 不涉及，客户端组件照常走 SSR + 水合 |

在框架中，首次请求通常是：先执行服务端组件得到 payload → 再用 payload 和客户端组件把整棵树渲染成 HTML 流式返回，payload 也内联在 HTML 里 → 浏览器先展示 HTML，React 用 payload 还原组件树，客户端组件水合。水合本身见 [SSR 和水合](/basics/vue/18-ssr-hydration)，流式渲染见 [Suspense](/basics/react/16-suspense)。

### 怎么使用

RSC 需要打包工具配合：把 `'use client'` 模块单独打包，生成模块引用，还要有服务端运行环境。所以一般不自己搭，而是用支持它的框架，例如 Next.js 的 App Router。

## 面试官可能追问

::: details 客户端组件里需要放一个服务端组件，怎么写？
不能在客户端组件里 import 它，可以让共同的父组件（服务端组件）把它作为 `children` 传进去：`<Tabs><ServerList /></Tabs>`。ServerList 在服务端渲染好，Tabs 只拿到渲染结果，负责决定放在哪里。渲染关系上的父子，不代表运行环境相同。
:::

::: details 'use client' 的组件只在浏览器上运行吗？
不是。在框架里客户端组件同样会参与 SSR，在服务端先渲染一次出 HTML，再在浏览器上水合。所以客户端组件在渲染阶段也不能直接访问 `window`、`localStorage`，要放到 effect 里。`'use client'` 的意思是"这段代码要下发到客户端"，不是"只在客户端执行"。
:::

::: details Server Functions 有什么安全上要注意的？
每个 Server Function 本质上都是一个可以被直接请求的 HTTP 端点，参数来自客户端，不可信。要在函数内部做参数校验、登录和权限检查，不能因为"按钮只有管理员能看到"就省略。RSC 的序列化协议出现过严重漏洞，相关依赖要及时跟进安全更新。
:::

::: details 服务端组件怎么避免数据请求的瀑布？
互不依赖的请求用 `Promise.all` 并行发起；次要的数据可以不 await，直接把 Promise 作为 prop 传给客户端组件，在那里用 `use` 读取，外面包一层 Suspense，主要内容先出来，次要内容后流式补上，见 [React 19 新特性](/basics/react/12-react19)。
:::

## 易错点

- 把 `'use server'` 当成服务端组件的标记，它标记的是 Server Functions
- RSC 不等于 SSR：RSC 本身不产生 HTML，SSR 也不会减少下发的组件代码
- 把函数、class 实例当 props 从服务端组件传给客户端组件，会在序列化时报错
- `'use client'` 加在很上层的组件上，它导入的整棵模块树都会变成客户端代码，失去 RSC 的好处，边界应尽量往叶子节点放
