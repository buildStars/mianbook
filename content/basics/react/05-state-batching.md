---
difficulty: 2
tags: [高频, 输出题]
---

# setState 是同步还是异步？什么是自动批处理？

::: tip 一句话回答
准确地说，setState 不会立刻修改当前的 state 变量，而是把更新**放进队列**，等当前代码执行完，React 再统一处理并重新渲染。每次渲染里的 state 都是那一次渲染的**快照**，所以调用 setState 后马上读取，拿到的还是旧值。连续三次 `setCount(count + 1)` 只加 1，因为三次读到的是同一个快照；要基于上一次的结果计算，就用**函数式更新** `setCount((c) => c + 1)`。React 18 起（使用 `createRoot`），事件处理函数、定时器、Promise 回调里的多次更新都会**自动批处理**，合并成一次渲染；确实需要立即更新 DOM 时用 `flushSync`。
:::

## 详细解析

### state 是渲染时的快照

```jsx
function Counter() {
  const [count, setCount] = useState(0)

  function handleClick() {
    setCount(count + 1) // 0 + 1
    setCount(count + 1) // 还是 0 + 1
    setCount(count + 1) // 还是 0 + 1
    console.log(count) // 0：这次渲染中的 count 永远是 0
  }

  // 点击一次后显示 1
  return <button onClick={handleClick}>{count}</button>
}
```

`count` 只是这次渲染时组件函数里的一个常量。setState 修改的是 React 内部保存的状态，并安排下一次渲染；下一次渲染时组件函数重新执行，才拿到新的 `count`。即使过一会儿在 `setTimeout` 里读，读到的仍然是这次渲染的快照。

### 更新队列和函数式更新

每次 setState 都是往队列里加一条更新，下次渲染时 React 按顺序处理：传入的是值，就直接替换；传入的是函数，就把上一步的结果作为参数调用它。

```jsx
function handleClick() {
  setCount((c) => c + 1)
  setCount((c) => c + 1)
  setCount((c) => c + 1) // 下次渲染时依次计算：0 → 1 → 2 → 3
}

// 输出题：count 当前是 0，点击后变成多少？
function handleMixed() {
  setCount(count + 5) // 替换为 0 + 5 = 5
  setCount((c) => c + 1) // 5 + 1 = 6
  setCount(count + 10) // 替换为 0 + 10 = 10，最终结果是 10
}
```

新状态依赖旧状态时，用函数式更新最稳妥。

### 自动批处理

批处理是把多次状态更新合并成一次重新渲染：

```jsx
function handleClick() {
  setCount((c) => c + 1)
  setFlag((f) => !f) // 只渲染一次，而不是两次
}

function handleLater() {
  setTimeout(() => {
    setCount((c) => c + 1)
    setFlag((f) => !f) // React 17 及以前：渲染两次；React 18 起（createRoot）：渲染一次
  }, 1000)
}
```

- React 17 及以前，只有 React 事件处理函数里的更新会被批处理；setTimeout、Promise、原生事件监听里的更新不会，每次 setState 都同步渲染一次。早期"setState 在合成事件里是异步的、在 setTimeout 里是同步的"这个说法就是这么来的
- React 18 起，用 `createRoot` 创建的应用在所有场景下都自动批处理；还在用旧的 `ReactDOM.render` 时，行为和 React 17 相同

### flushSync：强制同步更新

批处理意味着 setState 之后 DOM 还没更新。需要马上读取更新后的 DOM 时，用 `react-dom` 提供的 `flushSync` 包住更新，React 会在它返回前同步完成渲染和 DOM 更新：

```jsx
import { flushSync } from 'react-dom'

function addMessage(text) {
  flushSync(() => {
    setMessages((list) => [...list, text])
  })
  // 新消息已经渲染到 DOM 中，可以滚动到它的位置
  listRef.current.lastElementChild.scrollIntoView()
}
```

flushSync 会打破批处理，频繁使用会影响性能，只在确实需要同步读 DOM 时使用。

### 和 Vue 的对比

Vue 中修改 `count.value` 后，变量本身**立即**就是新值，只是 DOM 更新被放进微任务统一执行，要读新的 DOM 时用 `nextTick`，见 [nextTick 的原理](/basics/vue/09-next-tick)。React 中 setState 之后，当前渲染里的变量**根本不会变**，新值要等下一次渲染，DOM 也要等提交后才更新。两者都会把同一轮的多次修改合并成一次渲染。

## 面试官可能追问

::: details 怎么在 setState 之后拿到新值？
- 新值本来就是自己算出来的：先存到变量里，`const next = count + 1`，`setCount(next)` 之后的逻辑直接用 next
- 要在 state 变化后执行副作用：用 useEffect 监听这个 state
- 要读取更新后的 DOM：用 flushSync，或者在 effect 里读
:::

::: details 直接修改对象再 setState，为什么界面不更新？
```jsx
// 错误：修改了原对象，引用没变，Object.is 判断相等，React 跳过这次更新
user.name = 'Jerry'
setUser(user)

// 正确：创建一个新对象
setUser({ ...user, name: 'Jerry' })
```

React 用 `Object.is` 判断新旧 state 是否相同，同一个对象引用会被认为没有变化。state 要当作不可变数据对待，修改时总是创建新的对象或数组；嵌套很深时可以借助 Immer 简化写法。
:::

::: details 类组件的 this.setState 有什么不同？
类组件的 setState 会把传入的对象**浅合并**到原来的 state 中；函数组件的 setState 是**整体替换**，更新对象时要自己展开旧值。批处理和"当前读不到新值"的规则两者相同。类组件的 setState 还接受第二个参数，作为更新完成后的回调。
:::

## 易错点

- setState 不返回 Promise，不能用 await 等待更新完成
- 一次事件里多次更新同一个 state，或者在异步回调里更新时，用函数式更新
- flushSync 之后 DOM 已经更新，但当前函数里的 state 变量仍然是旧值
