---
difficulty: 2
tags: [原理]
---

# Redux 的数据流是怎样的？中间件（如 redux-thunk）是怎么实现的？

::: tip 一句话回答
Redux 是**单向数据流**：视图 `dispatch(action)`，store 调用 **reducer(state, action)** 算出新 state，再通知订阅者，视图重新渲染。三大原则是**单一数据源、state 只读、用纯函数修改**。中间件是对 `dispatch` 的层层包装：`applyMiddleware` 用 **compose** 把中间件串成链，每个中间件形如 `store => next => action => {}`。redux-thunk 判断 action 是函数就执行它并传入 dispatch，从而支持异步。
:::

## 详细解析

### 数据流

```text
用户操作
  → dispatch({ type: 'add', n: 1 })
  → 中间件链（日志、异步……）
  → reducer(oldState, action) 返回 newState
  → store 保存 newState，通知所有 subscribe 的监听器
  → react-redux 比较选中的数据，有变化的组件重新渲染
```

- **单一数据源**：整个应用的 state 是一棵对象树，放在一个 store 里
- **state 只读**：唯一的修改方式是 dispatch 一个描述"发生了什么"的 action
- **纯函数修改**：reducer 不能有副作用，必须返回新对象而不是改旧对象

纯函数和不可变带来的好处是：可以比较引用判断是否变化，可以记录每一步 action 做时间旅行调试。

### 中间件的签名

```js
const logger = ({ getState }) => (next) => (action) => {
  console.log('before', getState(), action.type)
  const result = next(action) // 交给下一个中间件，最后一个的 next 是原始 dispatch
  console.log('after', getState())
  return result
}
```

三层函数分别拿到：store 的 API、下一个 dispatch、当前 action。

## 代码示例：简化版 applyMiddleware 和 thunk

```js
const compose = (...fns) => (x) => fns.reduceRight((acc, fn) => fn(acc), x)

function applyMiddleware(...middlewares) {
  return (createStore) => (reducer) => {
    const store = createStore(reducer)
    let dispatch = () => {
      throw new Error('构建中间件时不能 dispatch')
    }
    // 中间件里调用的 dispatch 指向最终包装好的 dispatch
    const api = { getState: store.getState, dispatch: (a) => dispatch(a) }
    const chain = middlewares.map((m) => m(api))
    dispatch = compose(...chain)(store.dispatch)
    return { ...store, dispatch }
  }
}

// redux-thunk 的核心
const thunk = ({ dispatch, getState }) => (next) => (action) =>
  typeof action === 'function' ? action(dispatch, getState) : next(action)

// 使用：action 可以是函数，异步完成后再 dispatch 普通 action
const addLater = (n) => (dispatch) =>
  setTimeout(() => dispatch({ type: 'add', n }), 10)
store.dispatch(addLater(2))
```

`compose(a, b)(dispatch)` 等于 `a(b(dispatch))`，所以 action 先经过 a，再经过 b，最后到原始 dispatch。compose 本身的写法见 [柯里化与 compose](/basics/handwriting/03-curry-compose)。

## 面试官可能追问

::: details 中间件里的 dispatch 和 next 有什么区别？
`next` 只把 action 交给链上的下一个中间件。`dispatch` 是包装完的完整 dispatch，会让 action 从链头重新走一遍。thunk 函数里 dispatch 普通 action 时要用 dispatch，这样它还会经过日志等中间件。
:::

::: details reducer 为什么不能直接修改 state？
react-redux 和 DevTools 靠引用比较判断 state 是否变化。直接改旧对象，引用不变，组件不会更新，时间旅行也拿不到历史快照。Redux Toolkit 内部用 Immer，允许"看起来像直接修改"的写法，实际生成的是新对象。
:::

::: details redux-thunk 和 redux-saga 怎么选？
thunk 简单，异步逻辑写在函数里，适合大多数请求场景。saga 用 Generator 描述副作用，擅长取消、竞态、复杂流程编排，但学习成本高。现在很多项目直接用 Redux Toolkit 的 createAsyncThunk，或者把服务端数据交给 React Query 这类库，选型见 [状态管理](/basics/react/13-state-management)。
:::

## 易错点

- 中间件的顺序有影响：thunk 要放在 logger 前面，否则 logger 会打印出函数类型的 action
- reducer 里不能发请求、不能用 `Date.now()` 和随机数，这些都会让结果不可复现
- action 必须有 `type`，普通 action 是可序列化的对象；函数 action 只有装了 thunk 才能 dispatch
