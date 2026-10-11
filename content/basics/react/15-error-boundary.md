---
difficulty: 2
tags: [高频, 实践]
---

# 错误边界是什么？React 应用的错误怎么处理？

::: tip 一句话回答
错误边界是一个能捕获**子组件树渲染过程中**抛出的错误、并显示降级 UI 的组件，避免一个组件出错导致整个应用白屏（没有被捕获的渲染错误会让 React 卸载整棵树）。目前只能用**类组件**实现：`static getDerivedStateFromError` 返回新 state 来显示降级 UI，`componentDidCatch` 做上报；函数组件项目一般直接用 `react-error-boundary`。它捕获不到**事件处理函数**、**异步代码**（setTimeout、Promise 回调）、**服务端渲染**和**错误边界自身**的错误，这些要用 try/catch 处理，或者手动转交给错误边界。React 19 还可以在 `createRoot` 上配置 `onCaughtError`、`onUncaughtError` 统一上报。
:::

## 详细解析

### 为什么需要错误边界

React 16 起，渲染过程中抛出的错误如果没有被任何错误边界捕获，React 会卸载整个组件树，页面直接空白。因为渲染到一半的界面可能是错的，显示错误的数据（比如付款金额）比白屏更糟。错误边界让你决定"哪一块坏了，就只让哪一块显示出错提示"。

### 两个生命周期

| | getDerivedStateFromError(error) | componentDidCatch(error, info) |
| --- | --- | --- |
| 调用阶段 | render 阶段 | commit 阶段 |
| 作用 | 返回新 state，切换到降级 UI | 执行副作用，比如上报日志 |
| 要求 | 必须是纯函数 | 可以有副作用 |

`info.componentStack` 是出错组件到根组件的组件栈，生产环境下组件名被压缩了，需要配合 Source Map 还原。目前没有对应的 Hook，所以错误边界只能写成类组件。

### 捕获不到的错误

- **事件处理函数**：点击回调里的错误不发生在渲染过程中，React 不需要靠它决定界面怎么显示，用 try/catch 自己处理
- **异步代码**：`setTimeout`、`requestAnimationFrame`、Promise 回调执行时，渲染早已结束。例外：React 19 中 `useTransition` 的 startTransition 里抛出的错误（包括 async 函数）会交给错误边界
- **服务端渲染**：Suspense 边界内的组件在服务端出错时，React 会在 HTML 里输出这个边界的 fallback，再到客户端重试渲染
- **错误边界自身**：它自己 render 出错时，会交给更上层的错误边界

事件和异步中的错误想用错误边界统一展示，可以 catch 后存进 state，在下次渲染时 throw；`react-error-boundary` 提供的 `useErrorBoundary` 封装了这件事。

### 放在哪里

- **根部一个**：兜底，显示"页面出错了，请刷新"
- **路由级别**：一个页面出错不影响导航栏和其他页面
- **独立模块**：侧边栏、评论区、第三方组件、图表这类可以单独坏掉的区域各包一个

边界不是越细越好：每个按钮都包一个，界面会出现大量零散的错误提示，用户反而不知道发生了什么。按"用户能理解的功能块"来划分。

### 上报和监控

React 19 的 `createRoot` 和 `hydrateRoot` 在选项中支持三个回调，参数都是 `(error, errorInfo)`：`onCaughtError` 在错误被错误边界捕获时调用，`onUncaughtError` 在没有被捕获时调用，`onRecoverableError` 在 React 自动恢复的错误（如 hydrateRoot 遇到水合不匹配，改为在客户端重新渲染）时调用。在这里统一上报，比在每个错误边界里分别上报更不容易漏。全局错误监听、白屏检测等前端监控方案见 [前端监控](/basics/browser/20-monitoring)。

## 代码示例

```jsx
class ErrorBoundary extends Component {
  state = { error: null }

  // render 阶段调用：返回新的 state，下次渲染显示降级 UI，必须是纯函数
  static getDerivedStateFromError(error) {
    return { error }
  }

  // commit 阶段调用：适合做上报这类副作用
  componentDidCatch(error, info) {
    reportError({ message: error.message, componentStack: info.componentStack })
  }

  reset = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return this.props.fallback({ error: this.state.error, reset: this.reset })
    }
    return this.props.children
  }
}

// 使用
<ErrorBoundary fallback={({ error, reset }) => (
  <div>
    <p>出错了：{error.message}</p>
    <button onClick={reset}>重试</button>
  </div>
)}>
  <Profile user={user} />
</ErrorBoundary>
```

用 `react-error-boundary` 处理事件中的异步错误：

```jsx
import { ErrorBoundary, useErrorBoundary } from 'react-error-boundary'

function LoadButton() {
  const { showBoundary } = useErrorBoundary()
  async function handleClick() {
    try {
      await loadData()
    } catch (err) {
      showBoundary(err) // 交给最近的错误边界显示
    }
  }
  return <button onClick={handleClick}>加载</button>
}

// <ErrorBoundary fallbackRender={({ error, resetErrorBoundary }) => ...} resetKeys={[userId]}>
```

`resetKeys` 中的值变化时会自动重置边界，比如切换到另一个用户时重新尝试渲染。

## 面试官可能追问

::: details 为什么错误边界不捕获事件处理函数里的错误？
错误边界的职责是"渲染失败时决定显示什么"。事件处理函数里的错误不会让当前界面处于渲染了一半的状态，界面本身仍然是完整的，React 把它当作普通的 JS 异常，由开发者用 try/catch 决定提示方式。需要显示降级 UI 时，再通过 state 或 `showBoundary` 转交给错误边界。
:::

::: details 重试之后马上又报同样的错，怎么办？
重置边界只是清掉错误状态、重新渲染子组件，如果导致出错的数据没变，会立刻再次出错。重试时要同时改变数据：重新请求、清空出错的缓存，或者用 `resetKeys`、给边界设置 key，在依赖的数据变化时才重置。
:::

::: details 被错误边界捕获的错误，`window.onerror` 能收到吗？
React 19 中收不到。React 18 及以前，开发环境会把渲染错误重新抛出，即使被错误边界捕获，`window` 的 error 事件也会触发，控制台还会重复打印。React 19 不再重新抛出：被捕获的错误只用 `console.error` 打印，未被捕获的错误交给 `window.reportError`。依赖全局错误监听做上报的项目，升级后要改用 `onCaughtError`、`onUncaughtError` 或 componentDidCatch。
:::

## 易错点

- 以为错误边界能捕获所有错误：事件处理函数、setTimeout、普通 Promise 回调中的错误都捕获不到
- 在 getDerivedStateFromError 里做上报，它在 render 阶段执行，可能被调用多次，上报应该放在 componentDidCatch
- 整个应用只在根部放一个错误边界，任何小模块出错都会让整页变成错误页
