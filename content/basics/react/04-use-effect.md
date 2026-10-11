---
difficulty: 2
tags: [高频, 原理]
---

# useEffect 和 useLayoutEffect 有什么区别？依赖和清理怎么处理？

::: tip 一句话回答
两者的区别是**执行时机**：`useLayoutEffect` 在 DOM 更新之后、浏览器绘制之前**同步**执行，会阻塞绘制，适合读取布局并立即调整，比如定位浮层、避免闪烁；`useEffect` 一般在浏览器绘制之后**异步**执行，不阻塞页面，绝大多数副作用都用它。依赖数组决定 effect 何时重新执行：不传则每次渲染后都执行，`[]` 只在挂载时执行，`[a, b]` 在任一依赖变化（用 `Object.is` 比较）时执行。清理函数在下一次执行 effect 之前和组件卸载时运行。开发环境的 StrictMode 会故意多执行一次"清理 → 再执行"，用来暴露漏写的清理逻辑。
:::

## 详细解析

### 执行时机

```text
状态更新 → render：调用组件函数 → commit：更新 DOM
  → useLayoutEffect：同步执行，阻塞绘制
  → 浏览器绘制，用户看到新界面
  → useEffect：异步执行
```

- **useEffect** 不阻塞绘制，适合请求数据、订阅事件、上报日志。注意由点击、按键这类离散交互触发的更新，React 可能在绘制前就执行 effect，不要依赖"它一定在绘制之后"
- **useLayoutEffect** 适合"读取 DOM 布局，再根据结果更新"的场景：在它里面调用的 setState 会在绘制前同步处理完，用户看不到中间状态。代价是推迟了绘制，里面不能放耗时操作

```jsx
function Tooltip({ targetRect, text }) {
  const ref = useRef(null)
  const [top, setTop] = useState(0)

  useLayoutEffect(() => {
    // 测量浮层自身的高度：下方放不下，就显示在目标上方
    const { height } = ref.current.getBoundingClientRect()
    const fitsBelow = targetRect.bottom + height <= window.innerHeight
    setTop(fitsBelow ? targetRect.bottom : targetRect.top - height)
  }, [targetRect])

  return (
    <div ref={ref} style={{ position: 'fixed', top }}>
      {text}
    </div>
  )
}
```

换成 useEffect，用户可能先看到浮层出现在错误的位置，再跳到正确的位置。

### 依赖数组

| 写法 | 执行时机 |
| --- | --- |
| 不传 | 每次渲染后都执行 |
| `[]` | 只在挂载后执行，卸载时清理 |
| `[a, b]` | 挂载后执行，之后 a 或 b 变化时再执行 |

React 用 `Object.is` 逐个比较依赖的新旧值：原始值比较值，对象、数组、函数比较引用。在组件里直接创建的对象，每次渲染都是新的：

```jsx
function SearchResults({ keyword }) {
  const options = { keyword, pageSize: 20 } // 每次渲染都是一个新对象
  useEffect(() => {
    fetchResults(options)
  }, [options]) // 依赖每次都变，每次渲染后都会重新请求
}
```

解决方法：把对象移到 effect 内部创建，依赖改成用到的原始值 `[keyword]`；或者用 useMemo 让对象的引用保持稳定。依赖要写全，漏写会读到旧的值，见 [闭包陷阱](/basics/react/07-stale-closure)。

### 清理函数

effect 返回的函数就是清理函数，在两个时刻执行：依赖变化后、下一次执行 effect **之前**，用来清理上一次的副作用，这时它读到的是上一次渲染的 props 和 state；以及组件卸载时。

```jsx
useEffect(() => {
  const ws = new WebSocket(`wss://example.com/rooms/${roomId}`)
  return () => ws.close() // roomId 变化时，先断开旧房间，再连接新房间
}, [roomId])
```

### StrictMode 下为什么执行两次

开发环境中，被 `<StrictMode>` 包裹的组件挂载时，React 会额外执行一次清理和重新执行，即 setup → cleanup → setup。如果 effect 订阅了事件却没有取消、发起了连接却没有关闭，执行两次就会出现重复订阅、重复连接，问题能更早暴露。React 希望组件能承受 effect 被多次执行和清理，这样才能支持"隐藏组件时保留状态，再次显示时重新执行 effect"这类能力。生产环境不会这样执行。

正确的应对是写好清理函数，让"执行 → 清理 → 再执行"和"只执行一次"的效果一样，而不是用 ref 标记来跳过第二次执行。

## 代码示例：处理请求竞态

userId 从 1 快速切换到 2，如果用户 1 的请求后返回，就会覆盖用户 2 的数据。两种处理方式（代码都写在组件内部）：

```jsx
// 方式一：忽略过期的结果，适合无法取消的异步操作
useEffect(() => {
  let ignore = false
  fetchUser(userId).then((data) => {
    if (!ignore) setUser(data)
  })
  return () => {
    ignore = true // userId 变化或卸载时，标记上一次的请求已过期
  }
}, [userId])

// 方式二：直接取消请求，还能节省带宽
useEffect(() => {
  const controller = new AbortController()
  fetch(`/api/users/${userId}`, { signal: controller.signal })
    .then((res) => res.json())
    .then(setUser)
    .catch((err) => {
      if (err.name !== 'AbortError') setError(err)
    })
  return () => controller.abort()
}, [userId])
```

实际项目中，数据请求常交给 TanStack Query、SWR 这类库或框架自带的数据加载机制，它们内置了缓存、去重和竞态处理。Vue 中的同类问题见 [computed 和 watch 的区别](/basics/vue/15-computed-vs-watch)。

## 面试官可能追问

::: details 为什么不能直接把 async 函数传给 useEffect？
effect 的返回值必须是清理函数或 undefined，而 async 函数总是返回 Promise。React 在开发环境会给出警告，也没法正确执行清理。应该在 effect 内部定义 async 函数再调用，竞态问题照样用上面的 ignore 标记处理。
:::

::: details 哪些情况不需要 effect？
effect 是用来和 React 之外的系统同步的，比如网络、浏览器 API、第三方库。下面这些都不需要：根据 props 或 state 算出来的值，直接在渲染时计算，开销大就用 useMemo，不要用 effect 同步到另一个 state；由用户操作引起的逻辑，比如提交表单，放在事件处理函数里；想在某个 prop 变化时重置组件的全部 state，给组件加上 key。
:::

::: details 父子组件的 effect 谁先执行？
子组件的先执行。commit 阶段按深度优先的顺序处理 Fiber 树，子节点比父节点先完成，effect 也按这个顺序执行，useLayoutEffect 同理。另外，所有 DOM 修改都在 layout effect 执行之前完成，所以在父组件的 useLayoutEffect 里能读到子组件更新后的 DOM。
:::

## 易错点

- 依赖里放每次渲染都会新建的对象或函数，effect 会每次都执行；如果 effect 里还会 setState，可能陷入无限循环
- 空依赖数组不等于"永远只执行一次"：StrictMode 下会多执行一次，组件卸载后重新挂载也会再执行
- useLayoutEffect 在服务端渲染时不会执行，依赖它的布局计算要考虑首屏的情况
