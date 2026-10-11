---
difficulty: 2
tags: [高频, 性能优化]
---

# React 组件之间怎么通信？Context 有什么性能问题？

::: tip 一句话回答
按组件关系选择：**父传子**用 props，**子传父**通过 props 传入回调函数；兄弟组件之间把状态**提升**到共同的父组件；跨很多层用 **Context**；父组件需要调用子组件的方法时，用 ref 配合 `useImperativeHandle` 暴露有限的接口；多处读写、更新频繁的全局状态用 Redux Toolkit、Zustand 等**状态管理库**。Context 的问题在于：Provider 的 value 一变，**所有**读取这个 Context 的组件都会重新渲染，哪怕只用到其中一个没变的字段，memo 也挡不住。解决办法是**拆分 Context**、用 useMemo **稳定 value 的引用**，或者改用支持**选择器订阅**的状态库。
:::

## 详细解析

### props、回调和状态提升

React 是单向数据流：数据通过 props 从父组件流向子组件，子组件不能修改 props，要修改就调用父组件传下来的回调，由父组件改自己的 state：

```jsx
function SearchPage() {
  const [keyword, setKeyword] = useState('')
  return (
    <>
      <SearchInput value={keyword} onChange={setKeyword} />
      <ResultList keyword={keyword} />
    </>
  )
}

function SearchInput({ value, onChange }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} />
}
```

SearchInput 和 ResultList 是兄弟组件，keyword 被**提升**到它们共同的父组件：一个负责修改，一个负责读取。Vue 中对应的方式见 [Vue 组件之间有哪些通信方式](/basics/vue/04-component-communication)。

### Context：跨层级传递

层级很深时逐层传 props 很繁琐，可以用 Context：

```jsx
const ThemeContext = createContext('light')

function App() {
  const [theme, setTheme] = useState('light')
  return (
    <ThemeContext value={theme}>
      <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>切换主题</button>
      <Page />
    </ThemeContext>
  )
}

function Button() {
  const theme = useContext(ThemeContext) // 任意层级都能读取，取的是上方最近的 Provider 的值
  return <button className={theme}>按钮</button>
}
```

React 19 起可以直接把 `<ThemeContext>` 当作 Provider 使用，之前的版本要写 `<ThemeContext.Provider value={theme}>`。

### ref 和 useImperativeHandle

```jsx
function VideoPlayer({ src, ref }) {
  const videoRef = useRef(null)
  // 只暴露 play 和 pause，而不是整个 video 元素
  useImperativeHandle(ref, () => ({
    play: () => videoRef.current.play(),
    pause: () => videoRef.current.pause(),
  }), [])
  return <video ref={videoRef} src={src} />
}

// 父组件：const playerRef = useRef(null)，<VideoPlayer ref={playerRef} />，需要时调用 playerRef.current.play()
```

React 19 起函数组件可以直接从 props 中拿到 ref，之前的版本要用 `forwardRef` 包一层。这种命令式的写法只适合聚焦、滚动、播放这类操作，能用 props 描述的状态（比如"是否展开"）还是用 props。

### 状态管理库

| 场景 | 选择 |
| --- | --- |
| 父子、兄弟之间的少量状态 | props、状态提升 |
| 变化不频繁的全局数据：主题、语言、当前用户 | Context |
| 多处读写、更新频繁的客户端状态 | Zustand 这类轻量 store，可以按需订阅 |
| 大型应用、多人协作，需要统一规范和调试工具 | Redux Toolkit |
| 服务端数据的缓存、刷新、去重 | TanStack Query、SWR 这类请求库 |

### Context 的性能问题

Provider 的 value 变化时（用 `Object.is` 比较），所有调用了 `useContext` 读取它的组件都会重新渲染，即使只用到了 value 中没变的字段，即使被 memo 包裹。对应的三种优化：

**1. 稳定 value 的引用**：value 写成对象字面量，Provider 所在的组件每次渲染都会创建新对象，所有消费者都跟着渲染：

```jsx
function UserProvider({ children }) {
  const [user, setUser] = useState(null)
  const value = useMemo(() => ({ user, setUser }), [user]) // 不要直接写 value={{ user, setUser }}
  return <UserContext value={value}>{children}</UserContext>
}
```

**2. 拆分 Context**：把变化频率不同的数据、把"状态"和"修改状态的方法"放进不同的 Context。只调用 `logout` 的按钮只读取"方法 Context"，它的值不变，这个按钮不会因为 user 变化而重新渲染。

**3. 用选择器订阅**：Context 本身不支持只订阅一部分。Zustand、Redux 的 `useSelector` 这类基于外部 store 的方案，组件只订阅自己需要的字段，选中的值不变就不渲染：

```jsx
import { create } from 'zustand'

const useCartStore = create((set) => ({
  items: [],
  addItem: (item) => set((state) => ({ items: [...state.items, item] })),
}))

function CartBadge() {
  const count = useCartStore((state) => state.items.length) // 只有数量变化时才重新渲染
  return <span>{count}</span>
}
```

## 面试官可能追问

::: details 为什么 React.memo 挡不住 Context 引起的渲染？
memo 只比较父组件传进来的 props，而 Context 的更新不经过 props：Provider 的 value 变化后，React 会直接找到所有读取了这个 Context 的组件，安排它们重新渲染。想减少渲染，只能从 value 本身入手：稳定引用、拆分，或者换成支持选择器的方案。
:::

::: details Context 适合放什么数据？
变化不频繁、很多组件都要用的数据：主题、语言、当前登录用户、权限等。输入框的值、鼠标位置这类高频变化的数据放进 Context，会让大量组件频繁渲染。Context 只是"传递"数据的机制，不是状态管理工具，数据本身仍然保存在某个组件的 state 或外部 store 中。
:::

::: details Redux Toolkit 和 Zustand 怎么选？
Redux Toolkit 有统一的写法（slice、action、reducer）、中间件和完善的调试工具，状态变化可追踪，适合大型应用和多人协作。Zustand 的 API 很少，一个 `create` 就得到一个带选择器的 Hook，样板代码少，适合中小型项目。两者都能按需订阅，没有 Context 全量渲染的问题。服务端数据最好交给专门的请求库，不要手动塞进全局 store。
:::

## 易错点

- Provider 的 value 写成对象字面量，每次渲染都是新对象，所有消费者都会重新渲染
- `useContext` 读的是组件**上方**最近的 Provider；没有 Provider 时得到 `createContext` 的默认值，同一个组件里自己提供的值自己读不到
- 子组件不能直接修改 props，要修改就调用父组件传下来的回调
