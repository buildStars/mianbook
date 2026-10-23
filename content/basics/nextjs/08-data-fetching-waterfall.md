---
difficulty: 2
tags: [性能优化, 实践]
---

# Next.js 的服务端组件里取数据，怎么避免请求瀑布？并行请求、预加载和去重怎么做？

::: tip 一句话回答
连续写 `await` 会让请求**串行**执行，形成瀑布，只有后一个请求依赖前一个结果时才该这么写。互不依赖的请求先发起、再用 **`Promise.all`** 一起等待；允许部分失败就用 `Promise.allSettled`。慢的部分用 **`<Suspense>`** 拆出去流式输出，不拖慢整页。同一次渲染里相同的 `fetch` **自动去重**，数据库查询用 React 的 **`cache()`** 包一层，去重只在**当前请求内**有效。**预加载**就是在耗时操作之前先调用一次不 await 的取数函数，让请求提前出发。
:::

## 详细解析

### 瀑布是怎么来的

```tsx
// ❌ 三个请求互不依赖，却一个等一个：总耗时 = 三者之和
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getUser(id)
  const orders = await getOrders(id)
  const coupons = await getCoupons(id)
  return <Dashboard user={user} orders={orders} coupons={coupons} />
}
```

组件嵌套也会产生瀑布：父组件 await 完数据才渲染子组件，子组件再 await 自己的数据。每多一层，就多一次串行等待。

### 并行：先发起，再等待

```tsx
// ✅ 调用时请求就已经发出，Promise.all 只是一起等结果
const userP = getUser(id)
const ordersP = getOrders(id)
const couponsP = getCoupons(id)
const [user, orders, coupons] = await Promise.all([userP, ordersP, couponsP])
```

- `Promise.all` 有一个失败就整体失败。推荐位这类可有可无的数据用 `Promise.allSettled`，失败的部分降级显示
- 真有依赖时保持顺序，比如先拿到 artist 才能查 albums。这种瀑布是合理的
- layout 和 page 默认**并行渲染**，不用担心 layout 的数据拖住 page 的请求

### 用 Suspense 拆开慢的部分

`Promise.all` 解决了并行，但整页仍要等最慢的那个请求。把慢的部分放进独立组件，用 `<Suspense>` 包起来：

```tsx
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await getUser(id) // 快，页面主体需要
  return (
    <>
      <Profile user={user} />
      <Suspense fallback={<p>推荐加载中</p>}>
        <Recommendations userId={id} /> {/* 慢，单独流式输出 */}
      </Suspense>
    </>
  )
}
```

也可以把**没有 await 的 promise** 传给客户端组件，在客户端组件里用 React 的 `use()` 读取，外面同样包 `<Suspense>`。数据在服务端开始获取，结果随流到达客户端。

### 去重：同一请求内只查一次

```ts
// lib/data.ts
import { cache } from 'react'

// fetch 在同一次渲染里自动去重；数据库查询要自己用 cache 包
export const getUser = cache(async (id: string) => {
  return db.user.findUnique({ where: { id } })
})
```

layout、page、`generateMetadata` 和多个子组件都调用 `getUser(id)`，一次请求里只查一次库。所以不必把数据层层通过 props 往下传，在哪里用就在哪里调。

去重的范围是**当前请求**，下一个用户请求会重新查。跨请求复用是缓存的事，见 [Next.js 有哪几层缓存](/basics/ssr/05-next-caching)。

### 预加载：让请求比组件更早出发

```tsx
// 组件里先触发、不等待
export const preloadItem = (id: string) => {
  void getItem(id) // getItem 已用 cache 包裹
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  preloadItem(id)                       // 1. 先发出商品请求
  const allowed = await checkAccess(id) // 2. 同时做权限检查
  return allowed ? <Item id={id} /> : null // 3. Item 里再调 getItem，命中同一份结果
}
```

关键是 `getItem` 必须能去重：`fetch` 天然可以，ORM 要用 `cache()`。否则预加载和组件里的调用就是两次独立请求。开启 Cache Components 时，也可以给取数函数加 `'use cache'`。

## 面试官可能追问

::: details Promise.all 和 Suspense 该怎么选？
看用户是否需要同时看到这些数据。必须一起显示的用 `Promise.all`，总耗时取最慢的那个；可以先后出现的用 Suspense 拆开，快的先显示，慢的流式补上。两者经常配合：Suspense 内部的组件自己再用 `Promise.all` 并行取数。
:::

::: details React 的 cache 能当跨请求的缓存用吗？
不能。它的作用域是当前请求，请求结束就丢弃，下一个请求重新执行。它解决的是"一次渲染里多个组件重复查询"。跨请求复用要用 `'use cache'` 或 fetch 的缓存选项。
:::

::: details 并行请求一定更快吗？
对用户的等待时间来说通常更快，但会瞬间给后端带来更多并发。如果几个请求打的是同一个慢查询或同一个限流接口，并行可能触发限流。这时可以合并成一个批量接口，或者在服务端做聚合。
:::

## 易错点

- 先 `await` 第一个请求，再调用第二个，然后才写 `Promise.all`，这样仍然是串行
- 以为 `cache()` 包过的函数在不同请求之间也会命中
- 预加载的函数没有去重能力，预加载反而多发了一次请求
- 所有数据都在页面顶部 await，最慢的接口决定了整页的首字节时间
