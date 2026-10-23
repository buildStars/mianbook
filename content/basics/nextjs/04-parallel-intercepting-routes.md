---
difficulty: 3
tags: [场景题, 实践]
---

# Next.js 的并行路由和拦截路由是什么？怎么实现'在列表里弹窗看详情，刷新后变成完整详情页'？

::: tip 一句话回答
**并行路由**用 `@slot` 文件夹定义命名插槽，作为 props 传给同级 layout，一个页面可以同时渲染多块独立路由的内容，slot 不影响 URL。**拦截路由**用 `(.)`、`(..)`、`(...)` 这些前缀，在客户端导航时"截住"目标路由，在当前页面里渲染另一份 UI。两者组合就能做弹窗详情：在列表里点链接是软导航，被拦截成弹窗，URL 也变成详情地址；刷新或直接打开链接是硬导航，不拦截，渲染完整的详情页。每个 slot 都要有 **`default`** 文件，处理硬导航时无法恢复的情况。
:::

## 详细解析

### 并行路由：@slot

```text
app/
├── layout.tsx          ← 接收 children、team、analytics
├── page.tsx            ← 隐式的 children slot
├── @team/page.tsx
└── @analytics/
    ├── page.tsx
    └── views/page.tsx  ← URL 是 /views，不是 /@analytics/views
```

- slot 不是路由段，不进 URL；`children` 是隐式的 slot，`app/page.tsx` 等价于 `app/@children/page.tsx`
- 每个 slot 可以有自己的 loading 和 error，一块出错或慢不影响其他块
- 同一层的 slot 不能有的预渲染、有的动态，一个是动态的，同层都得动态

### 软导航、硬导航和 default

- **软导航**（`<Link>`、`router.push`）：只替换变化的 slot，其他 slot 保留当前显示的子页面
- **硬导航**（刷新、直接打开链接）：Next.js 不知道其他 slot 之前显示的是什么，就渲染该 slot 的 `default.tsx`

所以每个 slot 都要提供 `default.tsx`，`children` 也需要。缺少 default 文件会直接构建失败。想保持 404 的效果，可以在 default 里调用 `notFound()`；想什么都不显示，就 `return null`。

### 拦截路由的约定

| 前缀 | 匹配 |
| --- | --- |
| `(.)` | 同一层的段 |
| `(..)` | 上一层 |
| `(..)(..)` | 上两层 |
| `(...)` | 从根 `app` 目录算起 |

层数按**路由段**算，`@modal` 这种 slot 文件夹不算一段。所以 `app/@modal/(.)photo` 拦截的是 `/photo`，因为 `@modal` 和 `photo` 在路由上处于同一层。

### 弹窗详情的完整写法

```text
app/
├── layout.tsx                    ← 同时渲染 children 和 modal
├── page.tsx                      ← 图片列表
├── photo/[id]/page.tsx           ← 完整详情页（硬导航时显示）
└── @modal/
    ├── default.tsx               ← return null，平时不显示弹窗
    └── (.)photo/[id]/page.tsx    ← 软导航时显示的弹窗
```

```tsx
// app/layout.tsx
export default function RootLayout({ children, modal }: { children: React.ReactNode; modal: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        {modal}
      </body>
    </html>
  )
}

// app/@modal/(.)photo/[id]/page.tsx
import { Modal } from '@/components/modal'
import { PhotoDetail } from '@/components/photo-detail'

export default async function PhotoModal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Modal>
      <PhotoDetail id={id} />
    </Modal>
  )
}

// components/modal.tsx
'use client'
import { useRouter } from 'next/navigation'

export function Modal({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  return (
    <div role="dialog" aria-modal="true">
      {/* 返回上一个历史记录，URL 回到列表，弹窗 slot 回到 default */}
      <button onClick={() => router.back()}>关闭</button>
      {children}
    </div>
  )
}
```

流程：列表页里 `<Link href="/photo/1">` 软导航，`children` 还是列表，`@modal` 被拦截成弹窗，URL 变成 `/photo/1`；把链接发给别人或者刷新，是硬导航，`children` 渲染完整详情页，`@modal` 渲染 default 返回 null。弹窗和详情页共用 `PhotoDetail` 组件，内容保持一致。

## 面试官可能追问

::: details 关闭弹窗不用 router.back()，改用 Link 跳回首页可以吗？
可以，但 `@modal` slot 在软导航时会保留之前的弹窗内容，跳到 `/` 时弹窗不会自己消失。要给 `@modal` 加一个 `page.tsx` 返回 null，或者用 `@modal/[...catchAll]/page.tsx` 兜住其他路径，让 slot 被清空。
:::

::: details 并行路由做权限控制要注意什么？
layout 里根据角色决定显示哪个 slot，只是不显示而已，所有 slot 都会在服务端渲染并进入响应。所以每个 slot 的页面或者数据访问层要自己校验权限，不能只靠 layout 的条件判断。
:::

::: details 为什么弹窗的路径写 (.) 而不是 (..)？
看的是路由段的层级，不是文件夹层级。`@modal` 不是路由段，`app/@modal/(.)photo` 和 `app/photo` 在路由上是同一层，所以用 `(.)`。如果按文件夹算成 `(..)`，就会去匹配上一层，拦截不到。
:::

::: details 并行路由还适合哪些场景？
仪表盘里多个独立加载、独立报错的面板；同一个 URL 下按角色显示不同内容；页面内的标签页，各标签有自己的子路由和导航历史。
:::

## 易错点

- 忘了给 slot 写 `default.tsx`，构建直接失败
- 按文件夹层级数拦截前缀，把 `@slot` 也算成一段
- 以为刷新后也会显示弹窗；硬导航不拦截，显示的是完整页面
- 只在 layout 里按权限隐藏 slot，slot 的数据其实已经发给了客户端
