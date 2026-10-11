---
difficulty: 2
tags: [手写题, 实践]
---

# 怎么设计自定义 Hook？手写 useDebounce 和 useRequest

::: tip 一句话回答
自定义 Hook 是以 `use` 开头、内部调用了其他 Hook 的函数，用来复用**有状态的逻辑**。它复用的是逻辑而不是状态：每个调用它的组件都有自己独立的一份 state。设计时要遵守 Hooks 规则（只在顶层调用），**清理好副作用**（定时器、订阅、请求），处理好**竞态**（旧请求晚返回不能覆盖新结果），返回值保持稳定（返回的函数用 useCallback 包裹）。useDebounce 的核心是"值变化时重设定时器，清理函数里清掉上一个"；useRequest 的核心是"管理 data / loading / error，参数变化时用 AbortController 取消上一次请求并丢弃它的结果"。
:::

## 详细解析

### 自定义 Hook 是什么

自定义 Hook 就是普通函数，只是名字以 `use` 开头，lint 规则据此检查里面的 Hook 调用。它在调用它的组件里展开执行，内部的 useState、useEffect 都挂在这个组件的 Fiber 上，所以两个组件调用同一个 Hook，状态互不影响，原理见 [Hooks 的原理](/basics/react/03-hooks-rules)。想共享状态要用 Context 或状态库，见 [状态管理](/basics/react/13-state-management)。

### 设计要点

- **命名和职责**：以 `use` 开头，一个 Hook 只做一件事，名字说明它做什么（useDebounce、useOnlineStatus），而不是怎么做（useMountEffect）
- **输入和输出**：参数尽量是普通值；返回值少时用数组（方便重命名，如 useState），多时用对象（方便按需取用）
- **清理**：所有定时器、订阅、事件监听、请求，都要在 effect 的清理函数里撤销
- **竞态**：异步结果返回时检查它是否已经过期
- **引用稳定**：返回给调用方的函数用 useCallback 包裹，否则调用方把它放进依赖数组时，effect 会每次都执行
- **依赖完整**：内部 effect 的依赖要写全，需要"读最新值但不触发重新执行"时用 ref 或 useEffectEvent，见 [闭包陷阱](/basics/react/07-stale-closure)

### 什么时候不必抽 Hook

- 逻辑里没有用到任何 Hook：写成普通函数就行，不要加 `use` 前缀
- 只是想在多个组件中复用一段计算：普通工具函数即可
- 只在一个地方用、而且不长：抽出来反而要跳着读代码

还要注意，很多"在 effect 里同步 state"的逻辑本来就不需要 effect，抽成 Hook 也只是把问题藏起来，见 [useEffect 的使用](/basics/react/04-use-effect)。

## 代码示例：useDebounce

```jsx
function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer) // value 在 delay 内又变了：取消上一次
  }, [value, delay])

  return debounced
}
```

这是"值防抖"：输入框的 state 照常实时更新，只有 delay 毫秒内不再变化，debounced 才更新。如果需要"函数防抖"（比如防抖地调用某个回调），要用 ref 保存定时器和最新的回调，并在卸载时清理，实现原理见 [防抖和节流](/basics/javascript/13-debounce-throttle)。

## 代码示例：useRequest

```jsx
function useRequest(service, deps) {
  const [state, setState] = useState({ data: undefined, error: null, loading: true })
  const [version, setVersion] = useState(0) // 自增触发重新请求

  useEffect(() => {
    const controller = new AbortController()
    setState((s) => ({ ...s, loading: true, error: null }))

    service(controller.signal).then(
      (data) => {
        // 已取消（参数变了或组件卸载）就丢弃结果，避免旧请求覆盖新数据
        if (!controller.signal.aborted) setState({ data, error: null, loading: false })
      },
      (error) => {
        if (!controller.signal.aborted) setState((s) => ({ ...s, error, loading: false }))
      },
    )

    return () => controller.abort()
    // 由调用方通过 deps 声明何时重新请求，service 每次渲染都是新函数，不放进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])

  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  return { ...state, refresh }
}

// 使用：输入防抖 + 请求
function UserSearch() {
  const [keyword, setKeyword] = useState('')
  const debouncedKeyword = useDebounce(keyword, 300)
  const { data, loading, error, refresh } = useRequest(
    (signal) =>
      fetch(`/api/users?q=${encodeURIComponent(debouncedKeyword)}`, { signal }).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      }),
    [debouncedKeyword],
  )

  return (
    <div>
      <input value={keyword} onChange={(e) => setKeyword(e.target.value)} />
      <button onClick={refresh}>刷新</button>
      {loading && <p>加载中</p>}
      {error && <p>出错了：{error.message}</p>}
      <ul>{data?.map((u) => <li key={u.id}>{u.name}</li>)}</ul>
    </div>
  )
}
```

竞态处理不依赖 service 是否真的响应了 signal：即使请求没被取消、晚返回了，`aborted` 已经是 true，结果会被丢弃。生产项目中这类需求通常直接用 TanStack Query、SWR 或 ahooks 的 useRequest，它们还处理了缓存、重试和请求去重。

## 面试官可能追问

::: details 为什么 useRequest 要把 deps 交给调用方，而不是把 service 放进依赖？
service 一般是在组件里内联写的函数，每次渲染都是新的引用，放进依赖会导致每次渲染都重新请求。让调用方声明"哪些值变了要重新请求"更直观。另一种做法是要求调用方用 useCallback 包裹 service，再把 service 放进依赖，这样能通过 lint 检查，但调用方容易忘记。
:::

::: details 自定义 Hook 返回的函数为什么要用 useCallback？
调用方可能把这个函数传给 memo 子组件，或者放进自己的 effect 依赖里。如果每次渲染都返回新函数，子组件的 memo 失效，effect 每次都执行。Hook 作为被复用的基础代码，应该替调用方保证引用稳定。使用 React Compiler 的项目中，这类记忆化可以由编译器自动完成。
:::

::: details 怎么测试自定义 Hook？
用 Testing Library 的 `renderHook` 渲染 Hook，读取 `result.current`；定时器相关的用假定时器（如 Vitest 的 `vi.useFakeTimers()`）推进时间；请求用 MSW 或 mock fetch 模拟，专门构造"先发出的请求后返回"的场景验证竞态处理。
:::

## 易错点

- 以为两个组件调用同一个自定义 Hook 会共享状态
- 没写清理函数：组件卸载后定时器还在跑、请求返回后还在 setState
- 只用 AbortController 取消请求，却没在回调里检查是否已取消，不支持 signal 的异步函数照样会覆盖新数据
- 普通工具函数也加 `use` 前缀，lint 会对它套用 Hooks 规则
