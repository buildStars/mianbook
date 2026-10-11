---
difficulty: 2
tags: [高频, 实践, 对比]
---

# 受控组件和非受控组件有什么区别？表单应该怎么处理？

::: tip 一句话回答
**受控组件**的值由 React state 决定：传 `value`（复选框是 `checked`）和 `onChange`，每次输入都更新 state，React 再把 state 写回输入框，数据只有一个来源，方便做实时校验、格式化和联动。**非受控组件**的值保存在 DOM 里：用 `defaultValue` 设初始值，需要时通过 ref 或提交时的 `FormData` 读取，写法简单、输入时不触发渲染。大表单如果全部受控，每输入一个字符整个表单组件都要重新渲染，常用 **React Hook Form**（基于非受控输入、按需订阅）配合 **Zod** 做校验。React 19 的 `<form action>` 也是非受控的思路。一个输入框不能在受控和非受控之间切换，value 从 undefined 变成字符串会触发警告。
:::

## 详细解析

### 两种写法

```jsx
// 受控：state 是唯一的数据来源
function Controlled() {
  const [name, setName] = useState('')
  return <input value={name} onChange={(e) => setName(e.target.value)} />
}

// 非受控：值在 DOM 里，提交时再读
function Uncontrolled({ onSave }) {
  function handleSubmit(e) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    onSave(Object.fromEntries(formData)) // { title: '...' }，key 来自 name 属性
  }
  return (
    <form onSubmit={handleSubmit}>
      <input name="title" defaultValue="标题" />
      <button>保存</button>
    </form>
  )
}
```

### 对比

| | 受控 | 非受控 |
| --- | --- | --- |
| 数据存在哪 | React state | DOM |
| 设置值 | `value` + `onChange` | `defaultValue`，之后不再受 React 控制 |
| 读取值 | 直接用 state | ref、FormData |
| 输入时渲染 | 每次都渲染 | 不渲染 |
| 适合 | 实时校验、输入格式化、字段联动、按条件禁用按钮 | 简单表单、文件上传、集成非 React 的库 |

`<input type="file">` 的值只能由用户选择，在 React 中总是非受控的。Vue 中的 `v-model` 本质上就是受控写法的语法糖，见 [v-model 的原理](/basics/vue/12-v-model)。

### 受控与非受控的切换

```jsx
const [name, setName] = useState() // 初始是 undefined
<input value={name} onChange={(e) => setName(e.target.value)} />
```

第一次渲染时 value 是 undefined，React 把它当作非受控；输入后 value 变成字符串，又成了受控，控制台警告 "A component is changing an uncontrolled input to be controlled"。解决：初始值用空字符串，或者写 `value={name ?? ''}`；复选框的 `checked` 要保证始终是布尔值。只传 `value` 不传 `onChange`，输入框会变成只读，React 也会提示改用 `defaultValue` 或加上 `readOnly`。

### 大表单的性能问题

受控表单通常把所有字段放在一个 state 对象里，任何一个字段输入，整个表单组件和所有字段都会重新渲染。字段多、还有联动计算时会明显卡顿。可以把字段拆成独立组件并用 memo 包裹，但样板代码很多。

React Hook Form 的做法是让输入框保持非受控，通过 `register` 返回的 ref 和事件直接从 DOM 读取值，输入时默认不触发整个表单的渲染；需要实时读取某个字段时用 `watch` / `useWatch` 单独订阅。错误信息、提交状态放在 `formState` 中，同样是读到哪个字段才订阅哪个字段。

### React 19 的 form action

```jsx
<form action={async (formData) => { await saveProfile(Object.fromEntries(formData)) }}>
  <input name="nickname" defaultValue={user.nickname} />
  <SubmitButton />
</form>
```

`action` 直接接收函数，提交成功后自动重置非受控的字段，提交状态用 `useFormStatus` 或 `useActionState` 获取，见 [React 19 新特性](/basics/react/12-react19)。适合提交逻辑简单的表单，复杂的校验和联动仍然可以交给表单库。

## 代码示例：React Hook Form + Zod

```tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const schema = z
  .object({
    username: z.string().min(3, '用户名至少 3 个字符'),
    password: z.string().min(8, '密码至少 8 位'),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    message: '两次密码不一致',
    path: ['confirm'], // 错误挂到 confirm 字段上
  })

type FormValues = z.infer<typeof schema> // 类型直接从 schema 推导

function SignupForm({ onSubmit }: { onSubmit: (values: FormValues) => Promise<void> }) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  return (
    // handleSubmit 先校验，通过后才调用 onSubmit
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('username')} />
      {errors.username && <p>{errors.username.message}</p>}
      <input type="password" {...register('password')} />
      {errors.password && <p>{errors.password.message}</p>}
      <input type="password" {...register('confirm')} />
      {errors.confirm && <p>{errors.confirm.message}</p>}
      <button disabled={isSubmitting}>注册</button>
    </form>
  )
}
```

同一个 Zod schema 可以在服务端再校验一遍，前端校验只是体验优化，见 [运行时校验](/basics/typescript/18-runtime-validation)。

## 面试官可能追问

::: details 受控输入框为什么会出现光标跳到末尾？
受控组件要求在 onChange 里**同步**把 `e.target.value` 写回 state。如果在 setTimeout、请求回调里异步更新，或者写回的不是原值（比如强制转大写、截断），React 用 state 覆盖 DOM 时光标会跳到末尾。需要格式化时，可以在失焦或提交时处理，或者改用非受控输入。
:::

::: details 怎么让一个组件同时支持受控和非受控？
很多组件库的做法是：外部传了 `value` 就用外部的值（受控），没传就用内部 state，初始值取 `defaultValue`（非受控），变化时都调用 `onChange`。判断依据是 `value !== undefined`，并且在组件生命周期内不应该改变模式。
:::

::: details 什么时候不需要表单库？
字段少、只在提交时校验、没有复杂联动的表单，用非受控输入 + FormData 或 React 19 的 form action 就够了。字段多、动态增删字段（数组字段）、需要异步校验、多步骤表单时，表单库能省掉大量代码。
:::

## 易错点

- 初始值是 undefined 或 null，之后才变成字符串，触发受控和非受控切换的警告
- 以为 React 的 `onChange` 和原生 change 一样在失焦时才触发，它其实每次输入都触发，相当于原生的 input 事件，见 [合成事件](/basics/react/20-synthetic-event)
- 受控组件的 onChange 里异步更新 state，导致光标跳到末尾
