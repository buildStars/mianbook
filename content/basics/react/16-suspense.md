---
difficulty: 3
tags: [原理, 实践]
---

# Suspense 是怎么工作的？怎么配合懒加载和数据请求？

::: tip 一句话回答
组件在渲染时发现需要的东西还没准备好（懒加载的代码、还没返回的数据），就**挂起**（suspend），React 向上找到**最近的 `<Suspense>` 边界**，先显示它的 `fallback`，等 Promise 完成后再重新渲染这部分。代码分割用 `React.lazy` + Suspense；数据请求要用**支持 Suspense 的方案**：框架的数据加载、`use` 读取**缓存好的** Promise、TanStack Query 的 `useSuspenseQuery` 等，在 effect 里请求数据 Suspense 是感知不到的。嵌套多个 Suspense 可以控制内容分批出现；在 transition 中触发的更新不会把已经显示的内容替换成 fallback。服务端渲染时，Suspense 是流式 SSR 的分块单位。
:::

## 详细解析

### 挂起和最近的边界

```text
<Suspense fallback={<Spinner />}>   ← 最近的边界：显示 Spinner
  <Header />                         已经渲染好的兄弟节点也一起被 fallback 替换
  <PostList />                       渲染时发现数据没准备好 → 挂起
</Suspense>
```

- 一个 Suspense 里的所有内容**一起出现**：只要有一个子组件挂起，整个边界都显示 fallback
- 挂起的 Promise 完成后，React 从这个边界重新渲染
- 首次挂载就挂起的组件，它的 state 不会保留，重新渲染相当于重新挂载

### 懒加载：React.lazy

```jsx
import { lazy, Suspense } from 'react'

// 必须在模块顶层声明，模块需要有 default 导出
const Chart = lazy(() => import('./Chart.jsx'))

function Dashboard({ showChart }) {
  return (
    <Suspense fallback={<p>图表加载中</p>}>
      {showChart && <Chart />}
    </Suspense>
  )
}
```

打包工具会把 `import()` 的模块拆成单独的 chunk，第一次渲染 Chart 时才去下载。常见做法是按路由拆分。lazy 写在组件内部，每次渲染都会得到新的组件类型，state 会被重置。

### 数据请求要用支持 Suspense 的方案

`use(promise)` 会在 Promise 未完成时挂起。关键是 **Promise 必须稳定**：在渲染时直接 `use(fetch(...))`，每次渲染都会创建新的 Promise，永远等不完。要把 Promise 缓存起来：

```jsx
const cache = new Map()
function fetchPosts(tab) {
  // 同一个 tab 返回同一个 Promise，重新渲染时不会重复请求
  if (!cache.has(tab)) {
    cache.set(tab, fetch(`/api/posts?tab=${tab}`).then((res) => res.json()))
  }
  return cache.get(tab)
}

function PostList({ tab }) {
  const posts = use(fetchPosts(tab)) // 没完成时挂起
  return <ul>{posts.map((p) => <li key={p.id}>{p.title}</li>)}</ul>
}
```

真实项目中缓存的失效、重试、错误处理都很麻烦，一般交给框架（如 Next.js 的服务端组件把 Promise 传给客户端组件）或者请求库（如 TanStack Query 的 `useSuspenseQuery`）。用 `useEffect` + `setState` 请求数据，组件不会挂起，Suspense 不起作用。请求失败时 Promise reject，错误会抛给最近的[错误边界](/basics/react/15-error-boundary)，两者通常一起使用。

### 嵌套和 transition

嵌套的 Suspense 决定加载顺序：外层准备好就先显示外层，内层继续显示自己的 fallback。边界的粒度应该和你希望用户看到的加载顺序一致。

切换标签页时，如果新内容挂起，已经显示的旧列表会被替换成 fallback，界面闪一下。把更新放进 transition，React 会**保留旧内容**直到新内容就绪，期间 `isPending` 为 true；想让"切换到另一个用户"这种完全不同的内容立刻显示 fallback，就给 Suspense 设置不同的 `key`。原理见 [并发特性](/basics/react/09-concurrent)。

### 流式 SSR

服务端渲染时，React 先把 Suspense 之外的部分和 fallback 作为 HTML 发出去，某个边界的数据准备好后，再把它的 HTML 和一小段替换脚本追加到同一个响应里：

```text
第 1 块：<h1>标题</h1><!--$?--><template id="B:0"></template><p>加载列表</p><!--/$-->
第 2 块：<div hidden id="S:0"><ul><li>...</li></ul></div><script>把 S:0 移到 B:0 的位置</script>
```

慢的数据不会拖住整个页面。客户端用 `hydrateRoot` 水合时，每个 Suspense 边界也可以独立水合（选择性水合）：已经到达的部分先变得可交互，用户点击了还没水合的区域，React 会优先水合它。

## 代码示例：标签页切换

```jsx
function Tabs() {
  const [tab, setTab] = useState('react')
  const [isPending, startTransition] = useTransition()

  return (
    <>
      {['react', 'vue'].map((t) => (
        // 用 transition 切换：旧列表保持显示，而不是闪成 fallback
        <button key={t} onClick={() => startTransition(() => setTab(t))}>
          {t}
        </button>
      ))}
      {isPending && <span>切换中</span>}
      <Suspense fallback={<p>加载列表</p>}>
        <PostList tab={tab} />
      </Suspense>
    </>
  )
}
```

## 面试官可能追问

::: details 组件是怎么"挂起"的？
早期的实现方式是在渲染时 throw 一个 Promise，React 捕获后找到最近的 Suspense 边界显示 fallback，并在 Promise 完成后重新渲染。现在官方的入口是 `lazy` 和 `use`，throw Promise 属于内部实现，不要在业务代码里直接这样做。
:::

::: details Suspense 和自己写 isLoading 判断有什么区别？
自己写 isLoading，每个组件都要处理加载状态，多个请求时容易出现多个 loading 闪烁、先后不一致。Suspense 把"等待"声明在组件树上，由边界统一决定在哪里显示加载状态、哪些内容一起出现，还能和 transition、流式 SSR 配合。代价是数据请求要换成支持 Suspense 的写法。
:::

::: details 一个 Suspense 里两个组件分别请求数据，会产生瀑布吗？
如果第二个组件的请求要等第一个组件渲染出来才发起，就会形成串行的瀑布。应该尽早发起请求：在路由层或父组件中同时创建两个 Promise，再分别传给子组件用 `use` 读取；或者用框架的数据预加载。
:::

## 易错点

- 在渲染中直接 `use(fetch(...))`，没有缓存 Promise，会不断重新请求、一直挂起
- 以为在 useEffect 里请求数据也能触发 Suspense 的 fallback
- `lazy` 写在组件内部，或者懒加载的模块没有 default 导出
- 只放 Suspense 不放错误边界，请求失败时整个应用出错
