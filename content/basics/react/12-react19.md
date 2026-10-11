---
difficulty: 2
tags: [高频, 新特性]
---

# React 19 有哪些新特性？Actions、use、useOptimistic 怎么用？

::: tip 一句话回答
React 19 的主线是 **Actions**：`startTransition` 可以接收 async 函数，React 自动管理 pending 状态、错误和乐观更新；`<form action={fn}>` 直接接收函数，提交成功后自动重置非受控表单。围绕它有三个 Hook：`useActionState` 管理"上一次结果 + 提交函数 + isPending"，`useFormStatus`（来自 react-dom）让表单里的子组件读取提交状态，`useOptimistic` 在请求期间先显示预期结果、结束后自动回到真实数据。新的 `use` 可以在渲染时读取 Promise（配合 Suspense）和 Context，而且**能写在条件语句里**。其他变化：函数组件可以直接把 **ref 当 prop** 接收、`<Context>` 直接当 Provider、组件里写 `<title>`、`<meta>` 会被提升到 `<head>`。
:::

## 详细解析

### Actions：异步的 transition

以前提交表单要自己维护 loading、error 几个 state。React 19 把"在 transition 中执行的异步函数"叫作 Action：

```jsx
const [isPending, startTransition] = useTransition()

function handleSubmit() {
  startTransition(async () => {
    const error = await updateName(name) // isPending 覆盖整个异步过程
    if (error) {
      setError(error)
      return
    }
  })
}
```

`<form>`、`<button>` 的 `action` / `formAction` 属性可以直接传函数，函数接收 `FormData`，React 会自动把它放进 transition 中执行。Action 中抛出的错误交给最近的[错误边界](/basics/react/15-error-boundary)。

### useActionState 和 useFormStatus

- `useActionState(action, initialState)` 返回 `[state, dispatchAction, isPending]`。action 的第一个参数是**上一次的 state**，第二个参数是 dispatch 时传入的值，用作表单 action 时就是 FormData。多次提交会**排队依次执行**
- 预期内的失败（校验不通过、接口返回错误）应该 **return** 到 state 里展示；action 里直接 throw 会交给错误边界
- `useFormStatus()` 从 `react-dom` 导入，返回 `{ pending, data, method, action }`，读的是**外层** `<form>` 的状态，所以必须在 form 内部的子组件里调用，在渲染 form 的同一个组件里调用拿不到

### useOptimistic

`useOptimistic(value, reducer?)` 返回 `[optimisticState, setOptimistic]`。没有进行中的 Action 时，optimisticState 就等于 value；在 Action 中调用 setOptimistic 后，先显示乐观值，Action 结束后自动回到最新的 value，失败时等于自动回滚。setOptimistic 必须在 Action 或 startTransition 中调用，否则开发环境会警告，乐观值也会一闪而过。

### use：读取 Promise 和 Context

```jsx
function Comments({ commentsPromise }) {
  const comments = use(commentsPromise) // 未完成时挂起，显示最近的 Suspense fallback
  return comments.map((c) => <p key={c.id}>{c.text}</p>)
}

function Heading({ children }) {
  if (!children) return null
  const theme = use(ThemeContext) // 可以写在提前 return 之后，useContext 不行
  return <h1 className={theme}>{children}</h1>
}
```

`use` 不能读取**在渲染中新建的 Promise**，每次渲染都会得到一个新 Promise，永远等不完。Promise 要来自缓存、框架或者服务端组件传下来的 props，见 [Suspense](/basics/react/16-suspense)。

### 其他变化

- **ref 作为 prop**：函数组件直接从 props 中解构 `ref`，不再需要 `forwardRef`（以后会被废弃）；ref 回调可以返回清理函数，见 [useRef 和 ref 传递](/basics/react/14-ref)
- **Context 当 Provider**：`<ThemeContext value="dark">`，`<ThemeContext.Provider>` 以后会被废弃
- **文档元数据**：组件里渲染的 `<title>`、`<meta>`、`<link>` 会自动放到 `<head>` 中；样式表可以用 `precedence` 控制插入顺序，还有 `preload`、`preinit` 等资源预加载 API
- **错误处理**：`createRoot` 新增 `onCaughtError`、`onUncaughtError` 回调；Server Components 和 Server Functions 进入稳定版本，见 [Server Components](/basics/react/11-server-components)
- 之后的 19.x 版本陆续加入了 `<Activity>`（隐藏子树但保留状态）、`useEffectEvent` 等，useEffectEvent 见 [闭包陷阱](/basics/react/07-stale-closure)

## 代码示例：聊天输入框

```jsx
import { useActionState, useOptimistic } from 'react'
import { useFormStatus } from 'react-dom'

function SubmitButton() {
  const { pending } = useFormStatus() // 读取外层 form 的提交状态
  return <button disabled={pending}>{pending ? '发送中' : '发送'}</button>
}

export function Chat({ initialMessages }) {
  const [state, formAction] = useActionState(
    async (prevState, formData) => {
      const text = formData.get('text')
      if (!text) return { ...prevState, error: '内容不能为空' }
      addOptimistic(text) // 请求结束前先显示出来
      try {
        const saved = await sendMessage(text)
        return { messages: [...prevState.messages, saved], error: null }
      } catch (e) {
        return { ...prevState, error: e.message } // Action 结束，乐观消息自动消失
      }
    },
    { messages: initialMessages, error: null },
  )

  const [optimisticMessages, addOptimistic] = useOptimistic(
    state.messages,
    (current, text) => [...current, { id: 'temp', text, sending: true }],
  )

  return (
    <form action={formAction}>
      <ul>
        {optimisticMessages.map((m) => (
          <li key={m.id}>
            {m.text}
            {m.sending && '（发送中）'}
          </li>
        ))}
      </ul>
      {state.error && <p>{state.error}</p>}
      <input name="text" />
      <SubmitButton />
    </form>
  )
}
```

## 面试官可能追问

::: details useActionState 和自己用 useState 管理 loading 有什么区别？
自己写要处理 loading、error、结果三个 state，还要防止重复提交和旧请求覆盖新结果。useActionState 把提交放进 transition，isPending 自动维护，多次提交按顺序排队、每次都拿到上一次的结果；配合 Server Functions 还支持在 JS 加载完成前提交表单（渐进增强）。
:::

::: details 什么时候用 use，什么时候用 useContext？
读取 Context 两者都可以，`use` 更灵活，可以写在条件和提前 return 之后。读取 Promise 只能用 `use`。但 `use` 也只能在组件或 Hook 的渲染过程中调用，不能在事件处理函数、effect 里调用，也不能放在 try/catch 中。
:::

::: details 升级 React 19 有哪些破坏性变化？
移除了 `ReactDOM.render`、`hydrate`、`unmountComponentAtNode`、`findDOMNode`、字符串 ref、旧版 Context（`contextTypes`）等早已废弃的 API，`propTypes` 检查不再执行，函数组件不再支持 `defaultProps`（改用参数默认值，类组件仍然支持）；ref 回调如果用箭头函数隐式返回了值，TypeScript 会报错，因为返回值现在被当作清理函数。官方提供了 codemod 辅助迁移。
:::

## 易错点

- `useFormStatus` 从 `react-dom` 导入，并且只能在 form 内部的子组件中调用
- `useOptimistic` 的 setter 要在 Action 或 startTransition 中调用，普通事件里直接调用会一闪而过
- async transition 中 await 之后的 setState 不会自动成为过渡更新，需要再包一层 startTransition
- `use` 读取的 Promise 不能在渲染时新建，要缓存起来
