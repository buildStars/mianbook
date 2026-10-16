---
difficulty: 3
tags: [原理, 实践]
---

# Next.js 有哪几层缓存？数据为什么会'不更新'？

::: tip 一句话回答
从概念上看，App Router 的缓存有四层：**请求记忆化**，同一次渲染里相同的请求只执行一次；**数据缓存**，服务端跨请求复用数据请求的结果，可以按时间或按需重新验证；**整页缓存**，构建时或重新验证时生成的 HTML 和 RSC payload；**客户端路由缓存**，浏览器内存里保存访问过、预取过的路由段。数据"不更新"，通常是其中某一层命中了缓存：页面在构建时被静态预渲染了、数据设了很长的缓存时间、改完数据没有调用 `revalidatePath` / `revalidateTag`、或者客户端跳转时复用了路由缓存。Next.js 不同大版本的默认缓存行为调整过多次，还有新旧两套缓存写法，**具体默认值一定以项目所用版本的文档为准**。
:::

## 详细解析

### 四层缓存

| 层 | 在哪里 | 缓存什么 | 持续多久 | 怎么失效 |
| --- | --- | --- | --- | --- |
| 请求记忆化 | 服务端，单次渲染内 | 相同 URL 和参数的 GET `fetch`；用 React `cache` 包装的函数 | 只在这一次渲染中 | 渲染结束自动丢弃 |
| 数据缓存 | 服务端（内存、磁盘或共享存储） | `fetch` 的响应、被缓存函数的返回值 | 到过期或被重新验证 | 按时间重新验证；`revalidateTag`、`revalidatePath` |
| 整页缓存 | 服务端或 CDN | 预渲染出的 HTML 和 RSC payload | 到重新验证或重新部署 | 同上；重新部署后从头生成 |
| 客户端路由缓存 | 浏览器内存 | 访问过、预取过的路由段的 RSC payload | 页面不刷新期间，按过期时间失效 | `router.refresh()`；Server Action 里重新验证；刷新页面 |

请求记忆化解决的是"layout 和 page 都要用户信息，又不想层层传 props"：两边各自调用，实际只请求一次。它只在一次渲染中有效，和跨请求的数据缓存是两回事。

### 两套写法：fetch 选项和 use cache

较早的写法通过 `fetch` 的选项和路由段配置控制缓存：

```tsx
// 缓存结果，最多 1 小时后重新验证，并打上标签方便按需失效
const posts = await fetch('https://api.example.com/posts', {
  next: { revalidate: 3600, tags: ['posts'] },
}).then((r) => r.json())

// 不缓存，每次请求都取最新
const stock = await fetch('https://api.example.com/stock', { cache: 'no-store' }).then((r) => r.json())
```

开启 Cache Components（`cacheComponents` 配置）后，改为用 `'use cache'` 指令显式声明要缓存的函数或组件，用 `cacheLife` 设置时长、`cacheTag` 打标签，不缓存的动态内容放进 `<Suspense>` 在请求时流式输出：

```tsx
import { cacheLife, cacheTag } from 'next/cache'

export async function getPosts() {
  'use cache'
  cacheLife('hours') // 使用预设的缓存时长配置
  cacheTag('posts')
  return db.post.findMany()
}
```

两套写法背后的概念一致：哪些数据可以缓存、缓存多久、什么时候失效。面试时讲清这些概念，再说明默认值随版本变化，比背某个版本的默认值更可靠。

### 重新验证

- **按时间**：缓存过期后，下一个请求仍然先拿到旧数据，同时在后台重新获取（stale-while-revalidate），之后的请求才拿到新数据
- **按需**：数据变更后，在 Server Action 或 Route Handler 里调用。CMS 的内容更新可以通过 webhook 调一个 Route Handler 来触发

```tsx
'use server'
import { revalidatePath, revalidateTag } from 'next/cache'

export async function createPost(formData: FormData) {
  await db.post.create({ data: { title: String(formData.get('title')) } })
  revalidateTag('posts', 'max') // 带这个标签的缓存标记为过期：之后的请求先拿到旧值，同时在后台刷新
  revalidatePath('/posts') // 让这个路径的缓存失效
}
```

`revalidateTag` 更精确，一份数据被多个页面用到时只需失效一个标签；`revalidatePath` 适合只影响某个页面的情况。`revalidateTag` 的参数形式各版本有差异，部分版本还提供了只能在 Server Action 里调用的 `updateTag`，让缓存立即过期，用户提交后马上能看到自己的修改。

### 什么会让路由变成动态渲染

`cookies()`、`headers()`、`searchParams` 这类**请求相关的数据**，构建时不可能知道，用到它们的路由（开启 Cache Components 时是包着它们的那个 Suspense 边界）只能在请求时渲染。反过来，在没有开启 Cache Components 的项目里，一个页面没有读取任何请求数据，数据请求也没有声明不缓存，就可能在 `next build` 时被预渲染成静态页面，之后一直返回同一份 HTML。这是"数据不更新"最常见的原因。

要让页面在请求时渲染：旧写法可以导出路由段配置 `export const dynamic = 'force-dynamic'`，或者给 fetch 加 `cache: 'no-store'`；也可以先调用 `await connection()`（来自 `next/server`），表示后面的代码要等真实请求到来才执行。开启 Cache Components 后，没有用 `'use cache'` 声明的数据本来就在请求时获取。

### "数据不更新"的排查思路

1. **先确认用的是哪套缓存模型**：看 `next.config` 里有没有开启 `cacheComponents`（新建项目的模板可能已经默认开启），两套模型的写法和默认行为不一样，查文档也要对上
2. **在生产模式复现**：开发环境里页面每次请求都重新渲染，缓存问题要用 `next build` 加 `next start` 才能复现
3. **看构建输出**：路由被标记为静态（预渲染）还是动态
4. **看响应头 `x-nextjs-cache`**：`HIT`、`STALE`、`MISS`、`REVALIDATED`，判断是不是整页缓存在起作用
5. **看数据请求的缓存设置**：`fetch` 的 `cache`、`next.revalidate`，或者 `'use cache'` 的 `cacheLife`。开发环境下在 `next.config` 里开启 `logging.fetches` 可以打印每个 fetch 是否命中缓存（这个配置只在开发环境生效）；生产模式下可以设置环境变量 `NEXT_PRIVATE_DEBUG_CACHE=1`，让服务端打印缓存命中情况
6. **看改数据的地方**：有没有调用 `revalidatePath` / `revalidateTag`，标签名、路径是否和读取时的一致
7. **只有客户端跳转回来时是旧的，刷新页面就正常**：是客户端路由缓存，变更要通过 Server Action 并在里面调用 `revalidatePath` 或 `updateTag`，或者在客户端调用 `router.refresh()`
7. **多实例部署**：默认缓存存在各实例本地，按需失效只影响收到请求的那个实例，需要配置共享的缓存处理器

## 面试官可能追问

::: details 为什么开发环境正常，上线后数据不更新？
开发环境下页面按请求渲染，不会生成整页缓存，看到的总是新数据。生产构建时，没有用到请求数据的页面会被预渲染，之后命中整页缓存。上线前用 `next build` 加 `next start` 在本地验证，看构建输出里每个路由是静态还是动态。
:::

::: details 客户端路由缓存是什么？什么时候会让人困惑？
App Router 在浏览器里缓存访问过和预取过的路由段的 RSC payload，前进后退、再次访问时直接复用，切换时共享的 layout 也不会重新请求。困惑的场景是：在一个页面通过普通接口改了数据，再跳到列表页，看到的还是旧列表。解决办法是用 Server Action 做变更，并在其中调用 `revalidatePath` 或 `updateTag`，响应会顺带带回当前页面重新渲染后的数据（用 `'max'` 这类配置的 `revalidateTag` 只标记过期，不会立即带回新页面）；或者变更后调用 `router.refresh()`。旧模型下缓存时长可以通过实验性的 `staleTimes` 配置调整；开启 Cache Components 后，客户端保留多久由 `cacheLife` 的 `stale` 时间决定。
:::

::: details 用户相关的数据能放进缓存吗？
共享的数据缓存里不能放按用户区分的数据，除非用户标识是缓存键的一部分，否则就会把一个用户的数据返回给另一个用户。要特别注意：显式开启缓存（`cache: 'force-cache'`）的 `fetch` 即使带了 `cookie`、`authorization` 请求头也会被缓存，请求头会计入缓存键，不同用户各存一份，但用户数据会因此落进服务端的共享缓存存储。Cache Components 下，`'use cache'` 的函数里不能直接读 `cookies()`、`headers()`，推荐在外面读出来作为参数传进去，参数会成为缓存键的一部分；确实要在缓存函数里读请求数据时有专门的 `'use cache: private'`，结果只缓存在该用户的浏览器里。
:::

::: details revalidatePath 之后页面立刻就是新的吗？
不一定。`revalidatePath` 是让缓存失效，页面在下一次请求时重新生成；在 Server Action 里调用时，框架会在同一次响应里带回当前页面重新渲染后的数据。`revalidateTag` 用 stale-while-revalidate 方式时，当前和紧接着的请求可能还会拿到旧值，后台刷新完成后才更新。
:::

## 易错点

- 背某个版本的默认缓存行为去回答，默认值调整过多次，要说明"以项目版本的文档为准"
- 以为请求记忆化能跨请求复用，它只在一次渲染内有效
- 在服务端组件渲染过程中调用 `revalidatePath` 或设置 Cookie：这类操作只能在 Server Action 或 Route Handler 里做
- 只在开发环境验证缓存行为，开发环境不会生成整页缓存
