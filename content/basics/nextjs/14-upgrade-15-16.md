---
difficulty: 2
tags: [新特性, 高频]
---

# Next.js 15、16 带来了哪些重要变化？升级时要注意什么？

::: tip 一句话回答
**Next.js 15** 的核心是"默认不缓存、请求 API 异步化"：`cookies()`、`headers()`、`params`、`searchParams` 变成异步，`fetch` 和 GET Route Handler 默认不再缓存，最低要求 React 19。**Next.js 16** 把方向定型：**Turbopack** 成为 dev 和 build 的默认打包器，`middleware` 改名 **`proxy`**，**Cache Components**（`'use cache'`）取代实验性的 PPR 和 dynamicIO，`revalidateTag` 必须传第二个参数，同步访问请求 API 被彻底移除。升级时先跑官方 codemod，再逐个处理构建报错和缓存行为的变化。
:::

## 详细解析

### Next.js 15：缓存从"默认开"变成"默认关"

| 变化 | 以前 | 15 之后 |
| --- | --- | --- |
| `fetch` | 默认缓存 | 默认不缓存，要缓存写 `cache: 'force-cache'` |
| GET Route Handler | 默认静态缓存 | 默认动态，用 `export const dynamic = 'force-static'` 开启缓存 |
| 客户端导航 | 复用页面段的客户端缓存 | 页面段不复用，layout、loading 和前进后退仍会复用 |
| `cookies()`、`headers()`、`draftMode()` | 同步 | 返回 Promise |
| `params`、`searchParams` | 普通对象 | Promise |

```tsx
// 15 之后的写法
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const { tab } = await searchParams
  const token = (await cookies()).get('token')?.value
  // ...
}
```

请求 API 改成异步，是为了让框架知道"哪里真正依赖请求"，没用到的部分可以提前渲染。15 里同步访问还能凑合用（开发环境有警告），16 里直接移除。

15 还把最低版本提到 **React 19**，`useFormState` 被 `useActionState` 取代，详见 [React 19 新特性](/basics/react/12-react19)。

### Next.js 16：打包器、Proxy 和缓存模型

- **Turbopack 默认启用**：`next dev`、`next build` 都用它。项目里有自定义 `webpack` 配置时，`next build` 会直接失败，要么迁移配置，要么用 `next build --webpack` 退回。`experimental.turbopack` 改成顶层的 `turbopack`
- **middleware → proxy**：文件改名 `proxy.ts`，导出函数改名 `proxy`，固定运行在 Node.js 运行时。需要 Edge 运行时的场景只能继续用已弃用的 middleware，见 [Next.js 的 Proxy](/basics/nextjs/06-proxy)
- **Cache Components**：顶层配置 `cacheComponents: true`，用 `'use cache'` 显式声明缓存，取代实验性的 `ppr`、`dynamicIO`、`useCache`。`cacheLife`、`cacheTag` 去掉 `unstable_` 前缀。打开它不是简单改名，在 Suspense 之外读取未缓存数据会报构建错误，见 [Cache Components](/basics/nextjs/03-cache-components)
- **缓存 API**：`revalidateTag(tag)` 单参数写法已弃用，要写 `revalidateTag(tag, 'max')` 这样带 cacheLife 配置的形式；新增只能在 Server Actions 里调用的 `updateTag`（立即失效、读到自己刚写的数据）和 `refresh`
- **并行路由**：每个 slot 都必须有 `default.js`，否则构建失败
- **移除**：AMP、`next lint` 命令（改用 ESLint 自己的 CLI）、`serverRuntimeConfig` 和 `publicRuntimeConfig`（改用环境变量）
- **next/image 默认值收紧**：`qualities` 默认只允许 `[75]`，`minimumCacheTTL` 默认从 60 秒变成 4 小时，默认不优化指向本地 IP 的图片，跟随重定向最多 3 次；`priority` 属性弃用，改用 `preload`
- **环境**：Node.js 最低 20.9，TypeScript 最低 5.1

之后的小版本里，官方开始把 Cache Components 推荐为所有新应用的默认写法，`create-next-app` 新建的项目默认开启。

### 升级步骤

```bash
# 1. 升级依赖并运行升级 codemod
npx @next/codemod@canary upgrade latest

# 2. 异步请求 API 的 codemod 不包含在上一步里，要单独运行
npx @next/codemod@canary next-async-request-api .

# 3. 其他按需运行的 codemod
npx @next/codemod@canary middleware-to-proxy .
npx @next/codemod@canary next-lint-to-eslint-cli .
```

1. 先读官方升级指南，确认 Node.js、React、TypeScript 版本满足要求
2. 跑 codemod，看 diff 检查改动，codemod 处理不了的写法人工修改
3. 处理构建报错：自定义 webpack 配置、缺少的 `default.js`、`revalidateTag` 参数
4. 重点回归缓存行为：哪些页面以前靠默认缓存变快，现在每次请求都在查库；需要缓存的地方显式加 `cache: 'force-cache'` 或 `'use cache'`
5. 上线前压测，对比数据库 QPS 和响应时间

## 面试官可能追问

::: details 为什么 Next.js 15 要把 fetch 改成默认不缓存？
以前默认缓存导致很多"数据不更新"的困惑，开发者不清楚哪里被缓存了。改成默认不缓存后行为更可预测，要缓存时显式声明。Cache Components 延续了这个思路：缓存是 opt-in 的，用 `'use cache'` 标在具体的函数或组件上。
:::

::: details 升级到 15 后数据库压力突然变大，可能是什么原因？
以前依赖 `fetch` 默认缓存或 GET Route Handler 默认静态化的页面，升级后变成每次请求都执行。排查方法是看哪些路由从静态变成了动态，再对需要缓存的请求显式加缓存配置。用 ORM 直接查库的代码本来就不走 fetch 缓存，不受这一条影响。
:::

::: details 升级到 16 后构建报错 webpack 配置不兼容，怎么办？
短期可以用 `next build --webpack` 继续用 webpack 构建。长期要把配置迁移到 Turbopack：常见的 alias 用 `turbopack.resolveAlias`，loader 看 Turbopack 是否支持。Sass 里的 `~` 前缀写法 Turbopack 不支持，要去掉。
:::

## 易错点

- 只跑了 `upgrade` codemod，以为异步请求 API 也改好了，实际那个 codemod 要单独运行
- 以为打开 `cacheComponents` 只是把 `dynamicIO` 改个名，实际会暴露出一批构建错误
- `revalidateTag(tag)` 不写第二个参数，TypeScript 报错，行为也和以前不同
- 升级后只看页面能不能打开，不看缓存是否失效，上线后数据库被打满
