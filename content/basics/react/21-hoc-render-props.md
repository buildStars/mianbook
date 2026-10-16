---
difficulty: 2
tags: [高频]
---

# React 的高阶组件（HOC）和 Render Props 是什么？和自定义 Hook 相比有什么问题？

::: tip 一句话回答
两者都是 Hooks 出现之前复用**组件逻辑**的模式。**HOC** 是"接收组件、返回新组件"的函数，把数据通过 props 注入；**Render Props** 是把"渲染什么"做成一个函数 prop，由组件调用并传入数据。它们的问题是**嵌套地狱、props 命名冲突、数据来源不清晰、ref 要额外透传**。自定义 Hook 直接在函数组件里调用，不增加组件层级，所以成为主流。
:::

## 详细解析

### 高阶组件（HOC）

HOC 本质是一个函数：参数是组件，返回值是包装后的新组件。典型例子是 react-redux 的 `connect`、旧版 React Router 的 `withRouter`。

```jsx
function withWindowWidth(Wrapped) {
  return function WithWindowWidth(props) {
    const [width, setWidth] = useState(window.innerWidth)
    useEffect(() => {
      const onResize = () => setWidth(window.innerWidth)
      window.addEventListener('resize', onResize)
      return () => window.removeEventListener('resize', onResize)
    }, [])
    // 把数据作为 props 注入，其他 props 原样透传
    return <Wrapped {...props} width={width} />
  }
}

const Header = withWindowWidth(({ width }) => <h1>宽度 {width}</h1>)
```

HOC 还常用来做横切逻辑：权限判断、埋点、加载态包装。

### Render Props

组件不决定渲染内容，只负责提供数据，把渲染交给调用方传入的函数。`children` 也可以是这个函数。

```jsx
function WindowWidth({ children }) {
  const [width, setWidth] = useState(window.innerWidth)
  // ...同上，监听 resize
  return children(width)
}

<WindowWidth>{(width) => <h1>宽度 {width}</h1>}</WindowWidth>
```

比 HOC 灵活：数据从哪来、叫什么名字，在 JSX 里一眼能看到。

### 两种模式的问题

| 问题 | HOC | Render Props |
| --- | --- | --- |
| 组件层级 | 每包一层多一个组件，DevTools 里一长串 `withXxx` | 多个组合时回调层层嵌套，形成"回调地狱" |
| 命名冲突 | 多个 HOC 都注入 `data`，后面的会覆盖前面的 | 参数名由调用方定，没有冲突 |
| 来源清晰度 | 组件拿到一堆 props，不知道哪个是哪个 HOC 给的 | 较清晰 |
| ref 和静态方法 | ref 指向包装组件，要用 `forwardRef` 透传；静态方法要手动复制 | 一般不涉及 |
| 类型推导 | TS 里泛型签名写起来很绕 | 较好 |

### 自定义 Hook 为什么更好

```jsx
function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth)
  // ...同上
  return width
}

function Header() {
  const width = useWindowWidth()
  return <h1>宽度 {width}</h1>
}
```

- 不产生额外组件，组件树是平的
- 返回值由调用方自己命名，多个 Hook 组合不会冲突
- 数据来源就是那一行调用，读代码一目了然
- Hook 之间可以互相传参组合，比如 `useRequest(useDebounce(keyword))`

怎么设计好的自定义 Hook，见 [自定义 Hook](/basics/react/18-custom-hooks)。

## 面试官可能追问

::: details 有了 Hooks，HOC 和 Render Props 还有用吗？
有。Hooks 只能复用逻辑，不能包裹 JSX。需要统一包一层外壳的场景，比如权限拦截后渲染"无权限"页面、给组件统一加错误边界，用 HOC 仍然很自然。Render Props 在组件库里也常见，比如列表组件让调用方自定义每一项的渲染。
:::

::: details 写 HOC 有哪些约定？
不要修改传入的组件，而是返回新组件；透传无关的 props；设置 `displayName` 方便调试；用 `forwardRef` 转发 ref；不要在组件的 render 里调用 HOC，否则每次渲染都生成新组件类型，子树会被卸载重建、状态丢失。
:::

::: details Render Props 会带来性能问题吗？
如果在 JSX 里写内联箭头函数，每次父组件渲染都会传入新函数，使接收方即使用了 `React.memo` 也会重新渲染。多数情况下影响不大；确实需要时，可以把函数提出来用 `useCallback` 包一下。
:::

## 易错点

- HOC 是函数不是组件，`connect(mapState)(Comp)` 里 `connect(mapState)` 返回的才是 HOC
- 在组件内部调用 HOC 会导致每次渲染组件类型都变，子树状态丢失
- 自定义 Hook 复用的是**逻辑**，不是**状态**：两个组件调用同一个 Hook，各有一份独立的 state
