---
difficulty: 2
tags: [高频, 原理]
---

# 泛型是什么？泛型约束和默认类型怎么用？

::: tip 一句话回答
泛型就是**类型参数**：定义函数、接口或类时不写死类型，使用时再确定，既能复用代码，又能保留输入和输出之间的类型关系。调用泛型函数时，类型参数一般能从实参**自动推断**。`T extends X` 是**约束**，要求 T 至少满足 X，函数内部才能使用 X 上的属性，最常见的是 `K extends keyof T`；`T = X` 是**默认类型**，在没有传入、也推断不出来时使用。
:::

## 详细解析

### 为什么需要泛型

```ts
// 参数写死成 number[]，只能处理一种数组；改成 any，什么都能处理，但返回值的类型丢了
function firstAny(arr: any[]): any {
  return arr[0]
}
// 用泛型：T 在调用时确定，返回值和数组元素的类型保持一致
function first<T>(arr: T[]): T | undefined {
  return arr[0]
}

const n = first([1, 2, 3]) // number | undefined
const s = first(['a', 'b']) // string | undefined
```

可以把泛型理解为"类型层面的函数参数"：`first` 接收一个类型 T，参数和返回值都用到 T，它们之间的关系就表达出来了。

### 接口、类和类型别名中的泛型

```ts
// 接口：接口返回值的统一结构
interface ApiResponse<T> {
  code: number
  data: T
}
type UserResponse = ApiResponse<{ id: number; name: string }>
type Nullable<T> = T | null // 类型别名

// 类：类型安全的栈
class Stack<T> {
  private items: T[] = []
  push(item: T) {
    this.items.push(item)
  }
  pop(): T | undefined {
    return this.items.pop()
  }
}
const stack = new Stack<number>() // 构造时没有参数可供推断，手动指定
stack.push(1)
```

大多数时候不用手写类型参数，TS 会根据实参推断。需要手动指定的情况：参数里没有 T 的信息，如上面的 `new Stack<number>()`、`new Map<string, number>()`；或者推断结果不是想要的，如 React 中 `useState<User | null>(null)`，只看初始值 null 推断不出 User。

### 泛型约束：extends

函数内部只能使用 T 确定具备的能力。不加约束时 T 可以是任何类型，访问 `.length` 会报错，加上约束就可以了：

```ts
function getLength<T extends { length: number }>(value: T): number {
  return value.length // T 一定有 length 属性
}
getLength('hello')
getLength([1, 2, 3])
// @ts-expect-error number 没有 length 属性
getLength(123)
```

最常见的约束是 `K extends keyof T`，保证传入的键一定存在于对象上：

```ts
function getProp<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key]
}

const user = { name: 'Tom', age: 18 }
const userName = getProp(user, 'name') // string
const age = getProp(user, 'age') // number
// @ts-expect-error 'email' 不是 user 上的键
getProp(user, 'email')
```

返回值类型 `T[K]` 是索引访问类型，会随传入的键变化。`keyof` 和索引访问的更多用法见 [keyof 和映射类型](/basics/typescript/09-keyof-mapped)。

### 默认类型参数

```ts
// 不传类型参数时，data 是 unknown，使用前要先收窄
interface Result<T = unknown, E = Error> {
  ok: boolean
  data?: T
  error?: E
}

const r1: Result = { ok: false, error: new Error('超时') } // Result<unknown, Error>
const r2: Result<string[]> = { ok: true, data: ['a'] } // E 仍然是默认的 Error
```

- 有默认值的类型参数要放在没有默认值的后面，和函数的默认参数一样
- 调用泛型函数时，能从实参推断出来就用推断结果，推断不出来才用默认类型
- 默认类型必须满足约束，如 `<T extends string = 'zh'>`

### 常见误用

- **类型参数只出现一次**：`function log<T>(value: T): void` 里的 T 没有和任何位置建立关系，等同于 `value: unknown`。类型参数至少要出现两次，才是在表达"输入之间"或"输入和输出之间"的关系
- **只出现在返回值里**：`function parse<T>(json: string): T` 看起来类型安全，实际上 T 完全由调用方指定，函数内部没做任何检查，等于一次隐蔽的 `as` 断言。更诚实的写法是返回 unknown，或者传入校验函数
- **能写具体类型就别用泛型**：`function sum<T extends number[]>(arr: T)` 写成 `function sum(arr: number[])` 就够了，多余的类型参数只会让签名更难读

## 面试官可能追问

::: details 泛型约束的 extends 和类继承的 extends 有什么区别？
约束里的 `T extends X` 意思是"T 必须能赋值给 X"，按结构判断，不要求有继承关系：`T extends { length: number }` 时，字符串、数组、任何带 `length` 属性的对象都满足。类的 `extends` 是真正的继承，子类会继承父类的实现。
:::

::: details 在 .tsx 文件里，箭头函数的泛型怎么写？
`const identity = <T>(value: T) => value` 在 .tsx 中会被当成 JSX 标签解析而报错。可以写成 `<T,>(value: T) => value`（多加一个逗号），或者 `<T extends unknown>(value: T) => value`，也可以改用 function 声明。
:::

::: details 泛型在运行时还存在吗？
不存在。类型参数在编译后全部擦除，所以不能写 `new T()`、`value instanceof T`。需要在运行时用到类型时，要传入真实的值，比如构造函数：

```ts
function create<T>(Ctor: new () => T): T {
  return new Ctor()
}
const now = create(Date) // Date
```
:::

## 易错点

- 约束只规定了 T 的上限，T 可能是更窄的类型：`<T extends string>(value?: T): T` 里写 `return value ?? 'default'` 会报错，因为 T 可能是 `'a' | 'b'`，`'default'` 不一定属于 T
- `function get<T>(): T` 这类只在返回值里出现的泛型，本质是类型断言，不提供任何保证
- 默认类型不是约束：`<T = string>` 时照样可以传入 number，要限制取值范围得用 `extends`
