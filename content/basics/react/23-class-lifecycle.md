---
difficulty: 1
tags: [高频]
---

# React 类组件有哪些生命周期？在 Hooks 里分别怎么实现？

::: tip 一句话回答
类组件分**挂载、更新、卸载**三个阶段：挂载走 `constructor → getDerivedStateFromProps → render → componentDidMount`；更新多了 `shouldComponentUpdate` 和 `getSnapshotBeforeUpdate`，最后是 `componentDidUpdate`；卸载是 `componentWillUnmount`。Hooks 里用 **useEffect** 覆盖 didMount、didUpdate、willUnmount，**React.memo** 对应 shouldComponentUpdate，**useLayoutEffect** 对应需要在绘制前同步执行的场景。`componentWillMount` 等旧方法被废弃，因为 Fiber 的渲染阶段可能被打断、重复执行。
:::

## 详细解析

### 三个阶段

```text
挂载：constructor → static getDerivedStateFromProps → render
      → (更新 DOM) → componentDidMount
更新：static getDerivedStateFromProps → shouldComponentUpdate → render
      → getSnapshotBeforeUpdate → (更新 DOM) → componentDidUpdate
卸载：componentWillUnmount
出错：static getDerivedStateFromError / componentDidCatch
```

render 及之前是**渲染阶段**，必须是纯的，可能执行多次；之后是**提交阶段**，DOM 已经更新，可以做副作用。

### 几个不常用但常考的方法

- **getDerivedStateFromProps(props, state)**：静态方法，每次渲染前调用，返回对象合并进 state。用于 state 需要跟着 props 变的少见场景，拿不到 `this`
- **shouldComponentUpdate(nextProps, nextState)**：返回 false 跳过本次渲染。`PureComponent` 就是自动做了浅比较
- **getSnapshotBeforeUpdate(prevProps, prevState)**：DOM 更新前读取信息（如滚动位置），返回值作为 componentDidUpdate 的第三个参数。聊天列表新增消息后保持滚动位置就靠它

### 被废弃的 componentWillXxx

`componentWillMount`、`componentWillReceiveProps`、`componentWillUpdate` 已加上 `UNSAFE_` 前缀。原因是它们处在渲染阶段：Fiber 下渲染可能被打断、重来，这些方法会被调用多次，里面的请求、订阅等副作用就会重复。很多人还在 willMount 里发请求，其实它并不比 didMount 早拿到数据。

### Hooks 对应关系

| 类组件 | Hooks 写法 |
| --- | --- |
| constructor | `useState` 初始值，或惰性初始化 `useState(() => ...)` |
| componentDidMount | `useEffect(fn, [])` |
| componentDidUpdate | `useEffect(fn, [deps])`，首次也会执行，要跳过需用 ref 标记 |
| componentWillUnmount | `useEffect` 返回的清理函数 |
| shouldComponentUpdate | `React.memo(Comp, areEqual)`，注意返回值含义相反 |
| getDerivedStateFromProps | 渲染时直接计算，或渲染中比较上一次 props 后 setState |
| getSnapshotBeforeUpdate | 没有直接对应，可用 `useLayoutEffect` 加 ref 近似 |
| componentDidCatch | 没有 Hook，仍要写类组件错误边界 |

```jsx
function Clock() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000) // didMount
    return () => clearInterval(id) // willUnmount
  }, [])
  return <span>{new Date(now).toLocaleTimeString()}</span>
}
```

useEffect 的依赖和清理细节，见 [useEffect](/basics/react/04-use-effect)。

## 面试官可能追问

::: details useEffect 和 componentDidMount 执行时机一样吗？
不完全一样。componentDidMount 在 DOM 更新后同步执行，浏览器绘制前就跑完。useEffect 通常在绘制之后异步执行，不阻塞渲染。和 didMount 时机一致的是 useLayoutEffect。
:::

::: details 为什么说 useEffect 不是生命周期？
useEffect 的思路是"让副作用和某些数据保持同步"，而不是"在某个时刻执行"。依赖变了就清理旧的、执行新的。按生命周期去套，容易漏写依赖，出现[闭包陷阱](/basics/react/07-stale-closure)。
:::

::: details 错误边界为什么还只能用类组件？
React 目前没有提供对应 getDerivedStateFromError 和 componentDidCatch 的 Hook。实际项目一般写一个类组件错误边界，或用 react-error-boundary 这样的库，见 [错误边界](/basics/react/15-error-boundary)。
:::

## 易错点

- `React.memo` 的比较函数返回 true 表示"相等、不渲染"，和 shouldComponentUpdate 的 true 正好相反
- 严格模式开发环境下，组件会额外挂载、卸载、再挂载一次，用来暴露清理不完整的 effect，不是 bug
- getDerivedStateFromProps 每次渲染都会调用，不只是 props 变化时
