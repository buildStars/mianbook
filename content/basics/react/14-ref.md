---
difficulty: 2
tags: [高频, 实践]
---

# useRef 有哪些用法？怎么把 ref 传给子组件？

::: tip 一句话回答
`useRef(initial)` 返回一个在组件整个生命周期内**不变的对象** `{ current }`，修改 `current` **不会触发重新渲染**。两个用途：一是访问 DOM，把 ref 交给元素的 `ref` 属性，commit 后 `current` 就是 DOM 节点；二是保存渲染用不到的可变值，比如定时器 id、最新的回调。把 ref 传给子组件：React 19 起函数组件可以**直接从 props 里拿到 `ref`**，之前要用 `forwardRef` 包一层；只想暴露几个方法时用 `useImperativeHandle`。ref 不要在渲染过程中读写，应该在 effect 和事件处理函数里用。
:::

## 详细解析

### 两种用途

```jsx
function Stopwatch() {
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef(null) // 保存定时器 id：界面不需要显示它
  const inputRef = useRef(null) // 访问 DOM

  function start() {
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setElapsed((t) => t + 1), 1000)
    inputRef.current.focus()
  }

  return (
    <>
      <input ref={inputRef} placeholder="备注" />
      <p>{elapsed} 秒</p>
      <button onClick={start}>开始</button>
      <button onClick={() => clearInterval(timerRef.current)}>停止</button>
    </>
  )
}
```

| | useState | useRef |
| --- | --- | --- |
| 修改后重新渲染 | 会 | 不会 |
| 修改后何时能读到新值 | 下一次渲染 | 立即 |
| 适合 | 要显示在界面上的数据 | 定时器 id、DOM 节点、最新的回调（避免[闭包陷阱](/basics/react/07-stale-closure)）、上一次的值 |

### 不要在渲染期间读写 ref.current

渲染应该是纯的。React 不跟踪 ref 的变化，渲染时读 `ref.current`，界面可能和数据对不上；渲染时写它，在并发渲染或 StrictMode 下组件函数可能被调用多次，结果不可预测。例外是惰性初始化：

```jsx
const playerRef = useRef(null)
if (playerRef.current === null) {
  playerRef.current = new VideoPlayer() // 只在第一次渲染时创建，结果每次都一样
}
```

另外，DOM ref 要等 commit 后才有值，首次渲染时 `inputRef.current` 还是 null。

### ref 回调

`ref` 属性也可以是函数，节点挂载时以 DOM 节点为参数调用。React 19 起它可以**返回清理函数**，节点移除时执行，适合给一组动态的元素绑定观察器：

```jsx
const observe = useCallback((node) => {
  const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
  observer.observe(node)
  return () => observer.disconnect() // 节点卸载时执行
}, [])

return <div ref={observe}>...</div>
```

ref 回调的函数引用变了，React 会先执行旧的清理（或者以 null 调用旧回调），再用新回调重新绑定。写成内联箭头函数，每次渲染都会解绑再绑定一次，开销大时用 useCallback 稳定引用。

### 把 ref 传给子组件

```jsx
// React 19：ref 就是普通的 prop
function MyInput({ ref, ...props }) {
  return <input ref={ref} {...props} />
}

// React 18 及以前：用 forwardRef 接收第二个参数
const MyInput = forwardRef(function MyInput(props, ref) {
  return <input ref={ref} {...props} />
})
```

forwardRef 在 React 19 中仍然可用，官方计划以后废弃。类组件上的 ref 仍然指向组件实例，不会作为 prop 传入。

## 代码示例：只暴露 focus 和 clear

只暴露有限的方法，子组件可以自由修改内部实现，父组件也不能随意改动子组件的 DOM。

```jsx
import { useRef, useImperativeHandle } from 'react'

function SearchInput({ ref, ...props }) {
  const inputRef = useRef(null)
  // 父组件拿到的是这个对象，而不是整个 input 元素
  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current.focus(),
    clear: () => {
      inputRef.current.value = ''
    },
  }), [])
  return <input ref={inputRef} {...props} />
}

function Toolbar() {
  const searchRef = useRef(null)
  return (
    <>
      <SearchInput ref={searchRef} defaultValue="react" />
      <button onClick={() => searchRef.current.focus()}>聚焦</button>
      <button onClick={() => searchRef.current.clear()}>清空</button>
    </>
  )
}
```

## 面试官可能追问

::: details 为什么修改 ref 不会触发渲染？useRef 是怎么实现的？
useRef 在首次渲染时创建 `{ current: initial }`，保存在 Hook 链表上，之后每次渲染都返回这个对象本身。修改 current 只是改了一个普通对象的属性，没有经过 setState，React 不知道它变了，见 [Hooks 的原理](/basics/react/03-hooks-rules)。可以把它理解成"不触发渲染的 useState"：`useState({ current: initial })[0]`。
:::

::: details 什么场景应该用 ref，什么场景应该用 props？
能用 props 描述的状态就用 props，比如弹窗是否打开传 `isOpen`，而不是暴露 `open()`、`close()`。ref 只适合命令式的操作：聚焦、滚动到某个位置、播放视频、选中文本、触发动画，以及集成不受 React 管理的第三方库。
:::

::: details 列表中每一项都需要 ref，怎么办？
Hook 不能在循环里调用，不能给每一项调用 useRef。可以用一个 ref 保存 Map，在 ref 回调里按 id 存入节点、在清理函数里删除：`ref={(node) => { map.set(item.id, node); return () => map.delete(item.id) }}`，需要时用 id 从 Map 里取。
:::

## 易错点

- 在渲染时读写 `ref.current`（惰性初始化除外），以及首次渲染时以为 DOM ref 已经有值
- 用 ref 保存需要显示的数据，修改后界面不会更新
- React 18 及以前，函数组件不用 forwardRef 就拿不到 ref；React 19 的 ref 回调如果用箭头函数隐式返回了值（如 `ref={(n) => (el = n)}`），返回值会被当作清理函数，要改成带花括号的函数体
