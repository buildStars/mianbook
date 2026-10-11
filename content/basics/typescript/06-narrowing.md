---
difficulty: 2
tags: [高频, 实践]
---

# 类型收窄有哪些方式？怎么写自定义类型守卫？

::: tip 一句话回答
类型收窄是 TS 根据代码里的判断，在某个分支中把变量的类型缩小到更具体的类型，依靠的是**控制流分析**。常用方式有 `typeof`、`instanceof`、`in`、相等判断、真值判断，以及**可辨识联合**（用公共的字面量字段区分成员）。内置判断不够用时，可以写返回值为 `x is T` 的**自定义类型守卫**，或者 `asserts x is T` 的**断言函数**。要注意，对属性和可变变量的收窄在回调函数里会失效，因为回调执行时值可能已经变了。
:::

## 详细解析

### 内置的收窄方式

```ts
function format(value: string | number | Date | null | undefined): string {
  if (value == null) return '' // == null 同时排除 null 和 undefined
  if (typeof value === 'string') return value.trim() // string
  if (value instanceof Date) return value.toISOString() // Date
  return value.toFixed(2) // 只剩 number
}
```

| 方式 | 适用场景 | 注意 |
| --- | --- | --- |
| `typeof x === 'string'` | 原始类型和函数 | `typeof null` 是 "object"，判断对象时要额外排除 null |
| `x instanceof Date` | 类的实例 | interface 和 type 在运行时不存在，不能用 instanceof |
| `'swim' in x` | 区分属性不同的对象类型 | x 必须是对象类型；对 `object` 判断后可以访问该属性，类型是 unknown |
| `===`、`!==`、`== null` | 字面量类型，排除 null 和 undefined | `== null` 同时匹配 null 和 undefined |
| `if (x)` 真值判断 | 排除 null 和 undefined | `0`、`''`、`NaN` 也是假值，会被一起排除 |
| `Array.isArray(x)` | 数组 | 比 `typeof x === 'object'` 更准确 |

### 可辨识联合

给联合类型的每个成员一个公共的字面量字段（常叫 `type`、`kind`、`status`），判断这个字段就能收窄到具体成员：

```ts
type RequestState =
  | { status: 'loading' }
  | { status: 'success'; data: string[] }
  | { status: 'error'; error: Error }

function render(state: RequestState): string {
  switch (state.status) {
    case 'loading':
      return '加载中'
    case 'success':
      return state.data.join(',') // 这个分支里 state 一定有 data
    case 'error':
      return state.error.message // 这个分支里 state 一定有 error
  }
}
```

和"`data`、`error` 都写成可选字段"相比，可辨识联合准确表达了"成功时一定有 data、失败时一定有 error"，每个分支里都不用再判断字段是否存在。新增成员时可以配合 never 做穷尽检查，见 [any、unknown、never 的区别](/basics/typescript/02-any-unknown-never)。

### 自定义类型守卫：x is T

返回值写成 `参数 is 类型`，函数返回 true 时，调用处的 if 分支里参数就被收窄为这个类型：

```ts
interface User {
  id: number
  name: string
}

function isUser(value: unknown): value is User {
  if (typeof value !== 'object' || value === null) return false
  // 'id' in value 之后可以访问 value.id，类型是 unknown，再用 typeof 判断
  return 'id' in value && typeof value.id === 'number' && 'name' in value && typeof value.name === 'string'
}

const list: unknown[] = JSON.parse('[{"id": 1, "name": "Tom"}, null]')
const users = list.filter(isUser) // User[]：类型守卫可以直接传给 filter
```

### 断言函数：asserts

断言函数不返回布尔值，而是在条件不满足时抛错，调用之后的代码都按断言的类型处理：

```ts
function assertIsDefined<T>(value: T, message?: string): asserts value is NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error(message ?? '值不能为空')
  }
}

function mountApp() {
  const root = document.getElementById('app') // HTMLElement | null
  assertIsDefined(root, '找不到 #app')
  root.innerHTML = '' // 断言之后是 HTMLElement，不用再判断 null
}
```

还有不带类型的写法 `asserts condition`，表示调用之后 condition 一定为真。用 const 加箭头函数定义断言函数时，变量本身必须有显式的类型注解，否则调用处会报错，所以一般直接用 function 声明。

### 收窄在回调里失效

```ts
interface Form { email?: string }

function submit(form: Form) {
  if (form.email) {
    setTimeout(() => {
      // @ts-expect-error 报错：form.email 可能为 undefined
      console.log(form.email.trim())
    })

    const email = form.email // 先存到 const 局部变量
    setTimeout(() => console.log(email.trim())) // const 不会被重新赋值，收窄一直有效
  }
}
```

回调是稍后执行的，到那时 `form.email` 可能已经被改成 undefined，所以 TS 不把外面的收窄带进回调。属性访问、之后还会被重新赋值的 `let` 变量都是这样。const 变量不可能被重新赋值，收窄在回调里依然有效；TS 5.4 起，之后不再被赋值的 `let` 变量和参数也会保留收窄。

## 面试官可能追问

::: details 类型守卫 `x is T` 和直接返回 boolean 有什么区别？
返回 boolean 的函数，调用方拿到的只是一个布尔值，TS 不知道它和参数的类型有什么关系，if 分支里不会收窄。`x is T` 告诉编译器"返回 true 时 x 就是 T"，if 和 else 两个分支都会收窄。代价是 TS 不检查函数体的逻辑，守卫写错了，类型就会"说谎"。
:::

::: details 为什么 filter 之后数组的类型没有去掉 undefined？
以前 `arr.filter((x) => x !== undefined)` 的回调只被当作返回 boolean，结果类型不变，要写成 `filter((x): x is number => x !== undefined)`。TS 5.5 起，这类简单的箭头函数会被自动推断为类型守卫，结果直接是 `number[]`。但 `filter(Boolean)` 仍然不会收窄，因为 `Boolean` 的类型声明不是类型守卫。
:::

::: details 中间调用了一个可能修改对象的函数，收窄为什么还有效？
TS 的控制流分析是"乐观"的：在 `if (box.value !== null)` 里先调用 `reset(box)`，再访问 `box.value.toUpperCase()`，即使 `reset` 把 `value` 改回了 null，TS 也不会报错。它不追踪函数调用的副作用，否则大量正常代码都要重复判断。这是易用性和严谨性之间的取舍，确实可能被修改的数据，调用之后要重新判断。
:::

## 易错点

- 真值判断会把 `0`、`''` 一起排除，数字和字符串要用 `!== undefined` 或 `!= null` 判断
- 自定义类型守卫的逻辑 TS 不做检查，写错了类型就会和运行时的值不一致
- 对属性的收窄在回调中失效，先存到 const 局部变量再在回调里使用
