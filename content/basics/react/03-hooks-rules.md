---
difficulty: 2
tags: [高频, 原理]
---

# Hooks 的原理是什么？为什么不能写在条件语句里？

::: tip 一句话回答
函数组件每次渲染都会重新执行，state 不能存在函数内部，而是存在组件对应的 **Fiber 节点**上：每调用一个 Hook，React 就在 Fiber 的 Hook 链表上取下一个节点。Hook 没有名字，React 完全靠**调用顺序**把这次调用和上次保存的状态对应起来。如果把 Hook 写在条件、循环里，某次渲染跳过了一个 Hook，后面所有 Hook 都会错位，读到别人的状态。所以 Hooks 只能在函数组件和自定义 Hook 的**顶层**调用，`eslint-plugin-react-hooks` 会帮你检查。
:::

## 详细解析

### state 存在哪里

函数组件只是一个函数，执行完局部变量就没了。React 为每个组件实例维护一个 Fiber 节点（见 [Fiber 架构](/basics/react/02-fiber)），它的 `memoizedState` 指向一条链表，每个节点保存一个 Hook 的数据：

```text
Fiber.memoizedState
   │
   ▼
[useState: count] ──next──► [useState: text] ──next──► [useEffect: 依赖和清理函数] ──next──► null
```

- **首次渲染**：每调用一个 Hook，就在链表末尾创建一个新节点
- **更新渲染**：每调用一个 Hook，就沿着链表取下一个节点，读出上次保存的状态

### 简化版 useState

下面用数组代替链表，只考虑一个组件，可以直接在 Node.js 中运行：

```js
let hooks = [] // 按调用顺序存放每个 Hook 的状态
let cursor = 0 // 本次渲染执行到第几个 Hook
let Component = null

function useState(initialValue) {
  const index = cursor++ // 记住自己是第几个 Hook
  if (index === hooks.length) hooks.push(initialValue) // 首次渲染：用初始值创建

  const setState = (action) => {
    const next = typeof action === 'function' ? action(hooks[index]) : action
    if (Object.is(next, hooks[index])) return // 值没变，跳过渲染
    hooks[index] = next
    render() // 真实实现是把更新放进队列，再批量调度渲染
  }
  return [hooks[index], setState]
}

function render() {
  cursor = 0 // 每次渲染都从第一个 Hook 开始
  return Component()
}

function Counter() {
  const [count, setCount] = useState(0)
  const [text, setText] = useState('hello')
  console.log(`count = ${count}, text = ${text}`)
  return { increment: () => setCount((c) => c + 1), setText }
}

Component = Counter
const ui = render() // count = 0, text = hello
ui.increment() // count = 1, text = hello
```

`setState` 闭包里记住的是 `index`，也就是"第几个"，React 也只知道这是第几个 Hook，不知道它叫什么。只要每次渲染的调用顺序不变，第 0 个永远是 count，第 1 个永远是 text。

### 条件调用为什么会出错

```jsx
function Profile({ showAge }) {
  const [name, setName] = useState('Tom')
  if (showAge) {
    const [age, setAge] = useState(18) // 违反规则：写在条件语句里
  }
  const [email, setEmail] = useState('')
  // ...
}
```

```text
第 1 次渲染（showAge = true）      第 2 次渲染（showAge = false）
第 0 个 ← useState('Tom')          useState('Tom') → 读第 0 个：'Tom'，正确
第 1 个 ← useState(18)             （被跳过）
第 2 个 ← useState('')             useState('')    → 读第 1 个：18，错位
```

在上面的简化模型里，email 会读到 18。真实的 React 会检测这类问题：Hook 的数量和上次不同时直接报错（如 "Rendered fewer hooks than expected"），开发环境下 Hook 的种类顺序变了也会警告。提前 `return` 写在某个 Hook 之前，效果和条件调用一样。

### Hooks 的规则

- 只在函数组件和自定义 Hook 的**顶层**调用：不要放在条件、循环、嵌套函数、`try/catch` 中，不要放在提前 return 之后，也不要在普通函数、事件处理函数、类组件里调用
- 需要条件逻辑时，把条件写在 Hook **内部**，比如在 effect 里先判断再执行

`eslint-plugin-react-hooks` 的 `rules-of-hooks` 规则会检查上面这些情况，`exhaustive-deps` 规则检查 effect 等的依赖数组。React 19 提供的 `use` 是个例外，它可以写在条件语句里。

### 自定义 Hook：复用逻辑

以 `use` 开头、内部调用了其他 Hook 的函数就是自定义 Hook。它复用的是**逻辑**，不是状态：

```jsx
function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

function Header() {
  const width = useWindowWidth() // 每个调用它的组件，都有自己独立的 width 状态
  return width < 768 ? <MobileNav /> : <DesktopNav />
}
```

自定义 Hook 里的 Hook 调用，展开后就是调用它的组件的 Hook，同样按顺序存在这个组件的链表上。Vue 的组合式函数是类似的思路，区别见 [Composition API](/basics/vue/11-composition-api)。

## 面试官可能追问

::: details 为什么 React 选择靠顺序，而不是给每个 Hook 起个名字？
用名字或 key 区分，同一个自定义 Hook 在一个组件里调用两次、或者两个自定义 Hook 内部碰巧用了同一个名字，就会冲突，只能层层传入唯一的 key，组合起来很麻烦。调用顺序天然是唯一的，自定义 Hook 可以随意嵌套和组合，代价就是要遵守"只在顶层调用"的规则，而这条规则可以用 lint 工具自动检查。
:::

::: details 两个组件调用同一个自定义 Hook，会共享状态吗？
不会。自定义 Hook 只是把一段逻辑提取成函数，每次调用都会在调用方组件的 Fiber 上创建自己的 Hook 节点，状态完全独立。想在组件之间共享状态，要用状态提升、Context 或状态管理库，见 [组件通信](/basics/react/08-context-communication)。
:::

::: details 只想在某个条件满足时执行副作用，怎么写？
把条件放进 Hook 内部，Hook 本身照常调用：`useEffect(() => { if (!enabled) return; ... }, [enabled])`。如果是一整块逻辑都依赖条件，可以把它拆成一个子组件，父组件用条件渲染决定是否渲染这个子组件，子组件里的 Hook 照样在顶层调用。
:::

## 易错点

- 提前 return 写在 Hook 之前，和把 Hook 写在条件语句里是同一个问题
- 自定义 Hook 必须以 `use` 开头，lint 规则才会把它当作 Hook 检查
- `exhaustive-deps` 的警告不要随手关掉：依赖漏写不会报错，但 effect 里会读到旧的值，见 [闭包陷阱](/basics/react/07-stale-closure)
