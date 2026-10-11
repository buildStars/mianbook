---
difficulty: 2
tags: [高频, 手写题]
---

# 常用的工具类型有哪些？手写 Partial、Pick、Omit

::: tip 一句话回答
工具类型是 TS 内置的泛型类型，用来从已有类型派生出新类型，避免重复定义。按用途分四类：**改修饰符**的 Partial、Required、Readonly；**挑选和构造属性**的 Pick、Omit、Record；**过滤联合类型**的 Exclude、Extract、NonNullable；**从函数提取类型**的 ReturnType、Parameters、Awaited。前两类基于**映射类型** `{ [K in keyof T]: ... }` 实现，后两类大多基于**条件类型**。手写 Omit 的关键是先用 Exclude 算出要保留的键，再交给 Pick。
:::

## 详细解析

### 常用工具类型一览

以 `interface User { id: number; name: string; email?: string }` 为例：

| 工具类型 | 作用 | 示例 → 结果 |
| --- | --- | --- |
| `Partial<T>` | 所有属性变为可选 | `Partial<User>` → 三个属性都可选 |
| `Required<T>` | 所有属性变为必填 | `Required<User>` → `email` 也必填 |
| `Readonly<T>` | 所有属性变为只读 | 常用于配置、不希望被修改的状态 |
| `Pick<T, K>` | 挑出部分属性 | `Pick<User, 'id' \| 'name'>` → 只有 id 和 name |
| `Omit<T, K>` | 去掉部分属性 | `Omit<User, 'id'>` → 只有 name 和 email |
| `Record<K, V>` | 键为 K、值为 V 的对象类型 | `Record<'zh' \| 'en', string>` → `{ zh: string; en: string }` |
| `Exclude<T, U>` | 从联合类型 T 中去掉能赋给 U 的成员 | `Exclude<'a' \| 'b' \| 'c', 'a'>` → `'b' \| 'c'` |
| `Extract<T, U>` | 从 T 中保留能赋给 U 的成员 | `Extract<string \| number, number>` → `number` |
| `NonNullable<T>` | 去掉 null 和 undefined | `NonNullable<string \| null>` → `string` |
| `ReturnType<F>` | 函数的返回值类型 | `ReturnType<() => number>` → `number` |
| `Parameters<F>` | 函数的参数类型，结果是元组 | `Parameters<(a: string) => void>` → `[a: string]` |
| `Awaited<T>` | 递归解开 Promise，得到最终结果的类型 | `Awaited<Promise<Promise<number>>>` → `number` |

实际项目中常组合使用：

```ts
interface User {
  id: number
  name: string
  email?: string
}

type CreateUserInput = Omit<User, 'id'> // 创建时 id 由后端生成
type UpdateUserInput = Partial<Omit<User, 'id'>> // 更新时字段都可选，但不能改 id

async function fetchUser(id: number) {
  return { id, name: 'Tom', roles: ['admin'] }
}
type FetchedUser = Awaited<ReturnType<typeof fetchUser>> // { id: number; name: string; roles: string[] }
```

### 映射类型的修饰符

映射类型 `{ [K in keyof T]: T[K] }` 遍历 T 的每个键，生成一个新的对象类型。遍历时可以增减两种修饰符：

- `?` 和 `readonly`：加上可选、只读
- `-?` 和 `-readonly`：去掉可选、只读（`+?`、`+readonly` 等同于不带加号的写法）

`[K in keyof T]` 这种形式会**保留**原属性的修饰符：原来只读的属性映射后仍然只读，Pick 也一样。`-?` 在去掉可选的同时，还会去掉因为可选而带上的 `undefined`。

`keyof` 和映射类型的更多用法（如用 `as` 重命名键）见 [keyof 和映射类型](/basics/typescript/09-keyof-mapped)。

## 代码示例：手写实现

```ts
type MyPartial<T> = { [K in keyof T]?: T[K] }
type MyRequired<T> = { [K in keyof T]-?: T[K] }
type MyReadonly<T> = { readonly [K in keyof T]: T[K] }
type Mutable<T> = { -readonly [K in keyof T]: T[K] } // 内置没有，去掉只读

// K 必须是 T 的键；P 遍历 K 中的每个键
type MyPick<T, K extends keyof T> = { [P in K]: T[P] }
// keyof any 就是 string | number | symbol，即所有能作为键的类型
type MyRecord<K extends keyof any, V> = { [P in K]: V }

// 条件类型对联合类型逐个判断：能赋给 U 的变成 never，被联合类型吸收
type MyExclude<T, U> = T extends U ? never : T
// 先算出要保留的键，再交给 Pick
type MyOmit<T, K extends keyof any> = MyPick<T, MyExclude<keyof T, K>>

interface User {
  id: number
  name: string
  email?: string
}
type A = MyRequired<User> // { id: number; name: string; email: string }
type B = MyOmit<User, 'id'> // { name: string; email?: string }
```

`MyOmit<User, 'id'>` 的计算过程：

```text
1. keyof User              → 'id' | 'name' | 'email'
2. MyExclude<上一步, 'id'>  → never | 'name' | 'email'，never 被吸收 → 'name' | 'email'
3. MyPick<User, 上一步>     → { name: string; email?: string }
```

Exclude 为什么能逐个判断联合类型的成员，见 [分布式条件类型](/basics/typescript/05-conditional-infer)。

## 面试官可能追问

::: details Omit 拼错键名为什么不报错？
内置 Omit 的约束是 `K extends keyof any`，不是 `K extends keyof T`，所以 `Omit<User, 'nmae'>` 不会报错，只是什么都没去掉，拼写错误就这样被放过了。需要严格检查时可以自己包一层：`type StrictOmit<T, K extends keyof T> = Omit<T, K>`。Pick 的约束是 `keyof T`，拼错会报错。
:::

::: details Partial 是深层的吗？怎么实现 DeepPartial？
不是，只把第一层属性变为可选。深层版本要递归：

```ts
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}
```

函数也属于 object，这个简化版会把函数类型的属性也递归映射成对象类型，结果就不能调用了，实际使用时要先把函数类型单独判断出来。Readonly 同理，深层只读要自己递归实现。
:::

::: details Omit 用在联合类型上有什么问题？
`keyof (A | B)` 只包含 A 和 B 共有的键，Omit 处理联合类型时，非共有的属性会全部丢失，联合类型也被"压扁"成一个对象：

```ts
type Shape =
  | { kind: 'circle'; id: string; radius: number }
  | { kind: 'square'; id: string; size: number }

type Bad = Omit<Shape, 'id'> // { kind: 'circle' | 'square' }，radius 和 size 都没了
// 让条件类型逐个成员分发，分别 Omit 后再联合起来
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never
type Good = DistributiveOmit<Shape, 'id'> // 两个成员各自去掉 id，仍是联合类型
```
:::

## 易错点

- Partial、Required、Readonly 都只作用于第一层属性
- Readonly 只在编译期生效，运行时照样能改；需要运行时冻结用 `Object.freeze`，它的返回值类型也是 `Readonly<T>`，同样是浅冻结
- ReturnType、Parameters 接收的是函数**类型**，要写 `ReturnType<typeof fn>`，直接写 `ReturnType<fn>` 会报错
