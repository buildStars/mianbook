---
difficulty: 3
tags: [原理, 新特性]
---

# React 的并发特性有哪些？useTransition 和 useDeferredValue 怎么用？

::: tip 一句话回答
并发渲染是指 React 可以在后台准备新的界面，渲染过程**可以被打断、也可以被丢弃**，完成之前不会提交到页面上。在此基础上，更新分成两类：输入、点击这类需要立即响应的**紧急更新**，和切换视图、过滤结果这类可以稍后完成的**过渡更新**。`useTransition` 把一段状态更新标记为过渡，并通过 `isPending` 告诉你它是否还在进行；`useDeferredValue` 返回一个"延迟"版本的值，让依赖它的部分在后台重新渲染。它们和防抖节流不同：没有固定的延迟，后台渲染还能被新的输入打断。`Suspense` 则用来声明加载中的界面。
:::

## 详细解析

### 并发渲染是什么意思

同步渲染一旦开始就必须完成，期间主线程被占满。并发渲染下，React 渲染一个低优先级的更新时，如果用户又输入了，可以暂停或丢弃当前的渲染，先处理输入；后台渲染完成之前，屏幕上保持旧的界面，不会出现渲染了一半的状态。

底层依赖 Fiber 的可中断渲染和优先级调度，见 [Fiber 架构](/basics/react/02-fiber)。要注意，只有用到并发特性的更新才会这样渲染：即使用 `createRoot` 创建应用，没有标记为过渡的普通 setState，渲染一旦开始也会一口气做完，中途不会让出主线程。

### 紧急更新和过渡更新

以搜索框过滤一个很长的列表为例：输入框里的文字要立刻跟着键盘变化，否则用户会觉得卡，这是紧急更新；过滤后的列表晚一点出现用户也能接受，而且渲染很耗时，这是过渡更新。如果两者一起同步渲染，每输入一个字符都要等长列表渲染完，输入就会卡顿。

### useTransition

```jsx
function SearchPage({ allItems }) {
  const [query, setQuery] = useState('')
  const [filterText, setFilterText] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleChange(e) {
    setQuery(e.target.value) // 紧急更新：输入框立刻变化
    startTransition(() => {
      setFilterText(e.target.value) // 过渡更新：可以晚一点，也可以被下一次输入打断
    })
  }

  return (
    <>
      <input value={query} onChange={handleChange} />
      {isPending && <span>更新中</span>}
      <ResultList items={allItems} filterText={filterText} />
    </>
  )
}
```

- `startTransition` 的回调会**立即同步执行**，它只是把其中的状态更新标记为过渡，并不会推迟执行
- `isPending` 在过渡更新还没渲染完时为 true，可以用来显示提示或者让旧内容变淡
- React 19 起，`startTransition` 可以接收异步函数，`isPending` 会覆盖整个异步过程，常用于表单提交

### useDeferredValue

值来自 props 或其他 Hook、改不了它的更新方式时，可以延迟这个值：

```jsx
function SearchPage({ allItems }) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const isStale = query !== deferredQuery // 列表还没跟上输入

  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <div style={{ opacity: isStale ? 0.5 : 1 }}>
        <ResultList items={allItems} filterText={deferredQuery} />
      </div>
    </>
  )
}

// 必须用 memo 包裹：紧急渲染时 filterText 还是旧值，memo 才能跳过这次渲染
const ResultList = memo(function ResultList({ items, filterText }) {
  const filtered = items.filter((item) => item.name.includes(filterText))
  return (
    <ul>
      {filtered.map((item) => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  )
})
```

每次输入，React 先用旧的 `deferredQuery` 完成一次紧急渲染，输入框更新了，列表的 props 没变；再在后台用新值渲染列表，期间又有输入就丢弃它重新开始。如果 ResultList 没有被 memo 包裹，紧急渲染时它也会跟着父组件重新渲染，耗时的过滤照样卡住输入，上面 useTransition 的例子同样如此。

### 和防抖、节流的区别

| | 防抖、节流 | useTransition、useDeferredValue |
| --- | --- | --- |
| 何时开始渲染 | 等待一段固定的时间 | 没有固定延迟，紧急更新完成后立即在后台开始 |
| 渲染过程 | 开始后是一个同步的长任务，期间仍然会卡 | 可以被新的输入打断 |
| 设备差异 | 快设备也要等同样的时间 | 快设备几乎立刻完成，慢设备上自然延后 |
| 减少网络请求 | 可以 | 不能，请求仍然需要防抖或取消 |

防抖节流的实现见 [防抖和节流](/basics/javascript/13-debounce-throttle)。

### Suspense

`<Suspense fallback={<Spinner />}>` 声明子树还没准备好时显示什么，可以配合 `lazy` 加载的组件，以及支持 Suspense 的数据加载方案（如框架提供的数据加载，或 React 19 中用 `use` 读取 Promise）。

和过渡结合时有一个重要的行为：如果让子组件进入等待的更新是在过渡中触发的，已经显示出来的内容不会被替换成 fallback，React 会保留旧界面，直到新内容准备好，期间 `isPending` 为 true。比如切换标签页时，用户继续看到旧标签页，而不是突然闪一下加载动画。

## 面试官可能追问

::: details useTransition 和 useDeferredValue 怎么选？
能拿到触发更新的 setState 代码时，用 useTransition 包住低优先级的那部分更新，还能直接拿到 isPending。只拿到一个值、改不了它的更新方式（来自 props 或其他 Hook）时，用 useDeferredValue。两者底层机制相同，都是让一部分渲染以较低的优先级在后台进行。
:::

::: details 并发渲染对代码有什么要求？
渲染可能被打断、重来，组件函数可能被调用多次却只提交一次，所以渲染必须是纯的，副作用放到 effect 或事件处理函数里。另外，组件在渲染时直接读取外部的可变数据（全局变量、自己实现的 store），并发渲染期间数据可能被修改，同一次渲染中不同组件读到不同的值，界面就会不一致（tearing）。订阅外部 store 要用 `useSyncExternalStore`，React Redux、Zustand 等状态库内部就是用它实现订阅的。
:::

::: details 被打断的过渡渲染会怎样？
直接丢弃。React 只提交完整渲染完的结果，被打断的那次渲染没有产生任何 DOM 修改，effect 也不会执行；等紧急更新处理完，再用最新的状态重新开始过渡渲染。所以快速连续输入时，中间那些输入对应的列表可能根本不会出现在屏幕上。
:::

## 易错点

- `startTransition` 不是 setTimeout，回调是立即同步执行的，它只是给其中的更新标记优先级
- 控制输入框的 state 不能放进过渡更新里，否则输入会跟不上
- 被延迟渲染的耗时子组件要用 memo 包裹，否则紧急渲染时它照样会重新渲染
- useTransition 和 useDeferredValue 不会减少请求次数，网络请求仍然需要防抖或取消
