---
difficulty: 2
tags: [高频, 原理]
---

# 什么是 Hooks 的闭包陷阱？怎么解决？

::: tip 一句话回答
函数组件每次渲染都是一次新的函数调用，每次渲染里的 state、props 和函数都是那一次的快照。如果某个回调是在早先的渲染中创建的，之后没有被重新创建，它读到的就一直是那次渲染的旧值，这就是闭包陷阱（过期闭包）。最典型的是 effect 的依赖写成 `[]`，里面的 `setInterval` 一直读到初始 state。解决办法：**补全依赖**，让 effect 随值变化重建；用**函数式更新**避免读取 state；用 **useRef** 保存最新值；把用到的函数**移到 effect 内部**，让依赖一目了然。`exhaustive-deps` 规则就是用来提前发现这类问题的。
:::

## 详细解析

### 典型例子

```jsx
function Timer() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setCount(count + 1) // 这里的 count 永远是 0
    }, 1000)
    return () => clearInterval(id)
  }, []) // 只在挂载时执行一次

  return <h1>{count}</h1>
}
```

页面上的数字变成 1 之后就再也不动了。

### 原因

```text
第 1 次渲染：count = 0，创建 effect 回调 A，A 中的定时器回调捕获了 count = 0
            A 执行，启动定时器
第 2 次渲染：count = 1，创建新的 effect 回调 B，但依赖 [] 没变，B 不会执行
……
定时器回调一直是第 1 次渲染时创建的那个，每秒执行 setCount(0 + 1)
```

每次渲染都会创建新的闭包，问题在于定时器一直持有第一次的闭包，看不到之后的渲染。闭包本身的原理见 [闭包](/basics/javascript/02-closure)。

### 解决方法

**1. 函数式更新**：只是根据旧值计算新值时最简单，回调不再读取外部的 count：

```jsx
useEffect(() => {
  const id = setInterval(() => setCount((c) => c + 1), 1000) // React 传入最新的值
  return () => clearInterval(id)
}, [])
```

**2. 补全依赖**：依赖写成 `[count]`，count 每次变化 effect 都重新执行，先清掉旧定时器，再用最新的 count 建一个新的。结果正确，代价是定时器每秒都被重建。

**3. useRef 保存最新值**：回调需要读取最新的 props 或 state，又不希望 effect 重新执行时，把最新的值放进 ref。ref 对象在组件的整个生命周期内是同一个，读 `.current` 总能拿到最后一次写入的值：

```jsx
function useInterval(callback, delay) {
  const savedCallback = useRef(callback)

  useEffect(() => {
    savedCallback.current = callback // 每次渲染后，更新为最新的回调
  })

  useEffect(() => {
    const id = setInterval(() => savedCallback.current(), delay)
    return () => clearInterval(id)
  }, [delay]) // 只有 delay 变化时才重建定时器
}

function Timer({ step }) {
  const [count, setCount] = useState(0)
  useInterval(() => setCount(count + step), 1000) // 回调里读到的 count 和 step 都是最新的
  return <h1>{count}</h1>
}
```

**4. 把逻辑移到 effect 内部**：effect 调用了组件里定义的函数，函数里又用到 props 或 state 时，依赖关系很难看清。把函数移进 effect，它用到的值都会出现在依赖数组里：

```jsx
useEffect(() => {
  // 只在这里用的函数就定义在这里，它用到的 userId 自然会写进依赖
  async function loadOrders() {
    const res = await fetch(`/api/users/${userId}/orders`)
    setOrders(await res.json())
  }
  loadOrders()
}, [userId])
```

React 19.2 起正式提供了 `useEffectEvent`，用来定义"在 effect 里调用、总能读到最新的值、但不算作依赖"的函数，解决的也是这一类问题：

```jsx
import { useEffect, useEffectEvent } from 'react'

function ChatRoom({ roomId, theme }) {
  // 每次调用都能读到最新的 theme，但 theme 变化不会让 effect 重新执行
  const onConnected = useEffectEvent(() => {
    showNotification('已连接', theme)
  })

  useEffect(() => {
    const connection = createConnection(roomId)
    connection.on('connected', () => onConnected())
    connection.connect()
    return () => connection.disconnect()
  }, [roomId]) // 只有切换房间才重连，onConnected 不写进依赖
}
```

它只能在 effect 内部调用，不能用来省掉本该写的依赖。

### 和 eslint 依赖检查的关系

`react-hooks/exhaustive-deps` 规则会检查 useEffect、useMemo、useCallback 的回调用到了哪些组件内的值，没写进依赖数组就给出警告，本质上是在提示"这里可能产生过期闭包"。遇到警告不要直接关掉，而是用上面的方法调整代码：确实不希望某个值变化时重新执行 effect，说明应该用 ref 等方式读取它的最新值，而不是把依赖藏起来。

## 面试官可能追问

::: details 为什么 Vue 的组合式 API 没有这个问题？
Vue 的 `setup` 只执行一次，回调里读的是 `count.value`，ref 始终是同一个对象，`.value` 永远是最新的值，依赖也由响应式系统自动收集。React 的函数组件每次渲染都重新执行，变量是每次渲染的快照，所以需要依赖数组告诉 React 什么时候重建回调。更多对比见 [React 和 Vue 的区别](/basics/react/10-react-vs-vue)。
:::

::: details 用 useRef 保存最新值要注意什么？
修改 `ref.current` 不会触发重新渲染，不能用它保存需要显示在界面上的数据。也不要在渲染过程中读写 `ref.current`（初始化除外），React 要求渲染是纯的，应该在 effect 或事件处理函数里更新它。ref 适合保存定时器 id、最新的回调这类"渲染用不到、回调里要用"的值。
:::

::: details 闭包捕获旧值一定是坏事吗？
不一定。比如点击"发送"后 3 秒才真正发出消息，这期间用户切换了联系人，回调里读到的仍然是点击时的联系人，这正是想要的结果。每次渲染有自己的快照，事件处理函数用的是触发它的那次渲染的数据，行为可预测。只有回调存活时间很长（定时器、订阅、长连接），又需要最新数据时，才是陷阱。
:::

## 易错点

- 补全依赖后，effect 会随依赖变化反复清理和重建，定时器、订阅这类开销要考虑在内
- 函数式更新只解决"根据旧 state 计算新 state"的问题，要读取最新的 props 或其他 state，还得用 ref 等办法
- 为了消除 lint 警告随手删掉依赖或禁用规则，往往就是在制造闭包陷阱
