---
difficulty: 3
tags: [原理, 新特性]
---

# Next.js 的 Cache Components 是什么？'use cache' 和 Suspense 怎么决定页面哪些部分能预渲染？

::: tip 一句话回答
开启 `cacheComponents` 后，代码**默认在请求时执行**，要缓存就用 **`'use cache'`** 显式声明。构建时 Next.js 渲染路由，能完成的部分组成**静态外壳**（Partial Prerendering）：同步代码和 `'use cache'` 的结果进外壳；没缓存的异步数据、`cookies()`、`headers()`、`searchParams` 必须放进 **`<Suspense>`**，请求时再流式补上，否则开发和构建时会报错。缓存时长用 **`cacheLife`** 控制，失效用 **`cacheTag`** 打标签，再配合 `updateTag` 或 `revalidateTag`。
:::

## 详细解析

### 开启后的编程模型

```ts
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true, // 文档要求显式设置，不设会打印警告
}
export default nextConfig
```

旧模型里，Next.js 会猜一个路由是静态还是动态，经常"该更新的不更新"。新模型反过来：什么都不缓存，你说缓存哪里才缓存。构建时每个组件只有三种结局：

| 组件里做了什么 | 结果 |
| --- | --- |
| 只有同步代码、导入模块、纯计算 | 构建时完成，进静态外壳 |
| 标了 `'use cache'` 的异步工作（生命周期不太短） | 构建时执行，结果进静态外壳 |
| 未缓存的请求、查库、`cookies()`、`headers()` | 必须包在 Suspense 里；外壳里只放 fallback，请求时流式输出 |

`<Suspense>` 本身不会让组件变成动态的，只做同步工作的组件包了 Suspense 也会在构建时完成。缓存分层和"数据不更新"的排查见 [Next.js 的缓存](/basics/ssr/05-next-caching)。

### 'use cache' 的规则

```tsx
import { cacheLife, cacheTag } from 'next/cache'
import { cookies } from 'next/headers'
import { Suspense } from 'react'

async function ProductList({ category }: { category: string }) {
  'use cache'
  cacheLife('hours')
  cacheTag('products')
  const products = await db.product.findMany({ where: { category } })
  return <ul>{products.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
}

async function Recommend() {
  // 运行时数据：在缓存作用域外读出来，作为参数传进去
  const userId = (await cookies()).get('uid')?.value ?? 'guest'
  return <RecommendList userId={userId} />
}

export default function Page() {
  return (
    <>
      <ProductList category="phone" />  {/* 进静态外壳 */}
      <Suspense fallback={<p>推荐加载中</p>}>
        <Recommend />                   {/* 请求时渲染 */}
      </Suspense>
    </>
  )
}
```

- 放置位置：文件顶部（所有导出都缓存，都必须是 async）、组件或函数体开头
- 缓存键由构建 ID、函数 ID 和参数组成，闭包捕获的外层变量也会自动进缓存键
- 参数和返回值要可序列化：普通对象、数组、Date、Map、Set 可以，class 实例、函数、Symbol 不行。`children` 这类只透传、不读取的值可以传入
- 缓存函数在隔离环境执行，里面不能直接调用 `cookies()`、`headers()`，也不能读 `searchParams`，辅助函数里间接调用一样报错

### cacheLife 和内置配置

三个时间都以秒计：**stale** 是客户端不问服务端直接用缓存的时长；**revalidate** 过后下一次请求先拿旧内容，后台刷新；**expire** 是没有流量时最多保留多久，过了就同步等新内容，必须大于 revalidate。

| 名称 | stale | revalidate | expire |
| --- | --- | --- | --- |
| `default`（不调用时） | 5 分钟 | 15 分钟 | 不过期 |
| `seconds` | 30 秒 | 1 秒 | 1 分钟 |
| `minutes` | 5 分钟 | 1 分钟 | 1 小时 |
| `hours` | 5 分钟 | 1 小时 | 1 天 |
| `days` | 5 分钟 | 1 天 | 1 周 |
| `weeks` | 5 分钟 | 1 周 | 30 天 |
| `max` | 5 分钟 | 30 天 | 1 年 |

生命周期太短的缓存（比如 `seconds`）不会进静态外壳，而是变成请求时解析的部分，同样需要 Suspense。也可以在 `next.config.ts` 的 `cacheLife` 里自定义配置，或者内联传 `{ stale, revalidate, expire }`。

### 打标签和失效

- `updateTag('products')`：只能在 Server Action 里调用，立即过期，下一次请求等新数据，适合"改完马上看到自己的修改"
- `revalidateTag('products', 'max')`：Server Functions 和 Route Handlers 里都能调用，标记为过期，下一次请求先给旧内容、后台刷新，适合 Webhook 通知内容更新。第二个参数必须写，单参数形式已弃用

### 两个变体和随机值

- `'use cache: private'`：用于必须读 cookies、headers 的函数，结果只存在浏览器端，文档说很少需要
- `'use cache: remote'`：结果放进平台提供的共享缓存（如 Redis、KV），跨实例共享，但每次查询多一次网络往返
- `Math.random()`、`Date.now()` 要每次请求不同，先 `await connection()`（来自 `next/server`）并放进 Suspense；想所有用户共享一个值，就放进 `'use cache'`

## 面试官可能追问

::: details 为什么缓存函数里不能读 cookies？
缓存结果会被所有用户共享，如果函数内部读了某个用户的 cookie，这个用户的数据就可能被缓存下来给别人看。强制在外面读、作为参数传入后，cookie 的值就成了缓存键的一部分，不同用户各自一份，行为是可预期的。
:::

::: details 开启 cacheComponents 后构建报错说某个路由"blocking"，怎么改？
说明有未缓存的异步数据或运行时 API 在 Suspense 外面被访问，构建时无法完成。两种改法：这块数据可以共享，就抽成带 `'use cache'` 的函数；必须每次请求取，就用 `<Suspense>` 包住读取它的组件，并给一个合适的 fallback。不要一股脑把整页包进一个 Suspense，那样外壳里只剩 fallback。
:::

::: details updateTag 和 revalidateTag 怎么选？
看谁在等结果。用户自己提交表单后要立刻看到新内容，用 `updateTag`，它只能在 Server Action 里调用。CMS 发 Webhook 通知文章更新，访客多等一会儿也无所谓，用 `revalidateTag(tag, 'max')`，访客先拿旧页面，后台刷新。
:::

::: details 'use cache' 缓存在哪里，多实例部署会怎样？
默认在服务端内存里（LRU），自托管时跨请求保留，但每个实例各一份，serverless 环境下通常不跨请求保留。多实例要共享，就用 `'use cache: remote'` 配合自定义的缓存后端。
:::

## 易错点

- 以为开启 cacheComponents 只是改了配置名；它把默认行为从"尽量缓存"改成了"默认不缓存"，原有代码可能在构建时报错
- 在 `'use cache'` 函数里直接调用 `cookies()`，或者在它调用的辅助函数里间接调用
- `revalidateTag` 只传一个参数
- 以为包了 Suspense 的组件一定是动态的；只有里面有未缓存的异步工作才会在请求时渲染
