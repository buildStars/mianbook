---
difficulty: 3
tags: [原理, 手写题]
---

# 条件类型和 infer 是什么？什么是分布式条件类型？

::: tip 一句话回答
条件类型 `T extends U ? X : Y` 是类型层面的三元表达式：T 能赋值给 U 就得到 X，否则得到 Y。`infer` 只能用在条件类型的 `extends` 子句里，相当于在类型上做**模式匹配**：声明一个待推断的类型变量，用来提取函数返回值、Promise 的结果、数组元素等。当被检查的是**裸类型参数**、传入的又是联合类型时，条件类型会对每个成员**分别计算再联合**，这就是分布式条件类型；不想分发时用 `[T] extends [U]` 包一层。
:::

## 详细解析

### 条件类型

```ts
type IsString<T> = T extends string ? true : false

type A = IsString<'hello'> // true
type B = IsString<number> // false
```

这里的 `extends` 表示"能否赋值给"，和泛型约束里的含义相同。条件类型一般配合泛型使用，类型参数确定后才计算出结果。

### infer：从类型中提取一部分

`infer R` 的意思是"这个位置的类型先不写死，让 TS 推断出来并命名为 R"，匹配成功时 R 可以在 true 分支里使用：

```ts
// 函数的返回值
type MyReturnType<T> = T extends (...args: any[]) => infer R ? R : never
// Promise 内部的类型
type UnwrapPromise<T> = T extends Promise<infer V> ? V : T
// 数组元素的类型
type ElementOf<T> = T extends readonly (infer E)[] ? E : never
// 函数的第一个参数
type FirstArg<T> = T extends (first: infer A, ...rest: any[]) => any ? A : never
// 模板字面量类型：取路径的第一段
type FirstSegment<S> = S extends `${infer Head}/${string}` ? Head : S

type R1 = MyReturnType<() => number> // number
type R2 = UnwrapPromise<Promise<string>> // string
type R3 = ElementOf<boolean[]> // boolean
type R4 = FirstArg<(id: number, name: string) => void> // number
type R5 = FirstSegment<'user/profile/edit'> // 'user'
```

### 分布式条件类型

被检查的类型是**裸类型参数**（单独的 T，没有被包进数组、元组、Promise 等结构），并且实例化时传入联合类型，条件类型会拆开每个成员分别计算，再把结果联合起来：

```ts
type ToArray<T> = T extends any ? T[] : never
type C = ToArray<string | number> // string[] | number[]，即 ToArray<string> | ToArray<number>

// 内置的 Exclude 就依赖分发：'a' → never，'b' → 'b'，'c' → 'c'，never 在联合类型中被吸收
type MyExclude<T, U> = T extends U ? never : T
type D = MyExclude<'a' | 'b' | 'c', 'a'> // 'b' | 'c'
```

### 阻止分发

把两边都包进元组，T 就不再是裸类型参数，联合类型会被当作一个整体判断：

```ts
type ToArrayNoDist<T> = [T] extends [any] ? T[] : never
type E = ToArrayNoDist<string | number> // (string | number)[]
```

两个容易忽略的情况都和分发有关：

- `boolean` 就是 `true | false`，所以 `ToArray<boolean>` 得到 `false[] | true[]`
- never 相当于没有成员的联合类型，分发时没有成员可以计算，结果直接是 never。所以判断一个类型是不是 never，必须阻止分发：

```ts
type IsNeverWrong<T> = T extends never ? true : false
type IsNever<T> = [T] extends [never] ? true : false

type F = IsNeverWrong<never> // never，而不是 true
type G = IsNever<never> // true
```

## 代码示例：手写 ReturnType 和 Awaited

```ts
// 和内置的 ReturnType 一样，用约束保证传入的是函数类型
type MyReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any

// Awaited 简化版：递归解开嵌套的 Promise
type MyAwaited<T> = T extends Promise<infer V> ? MyAwaited<V> : T

async function fetchUser() {
  return { id: 1, name: 'Tom' }
}

type H = MyReturnType<typeof fetchUser> // Promise<{ id: number; name: string }>
type I = MyAwaited<H> // { id: number; name: string }
type J = MyAwaited<Promise<Promise<number>>> // number
```

内置的 Awaited 更完整：它匹配的不只是 Promise，而是任何带有 `then` 方法的对象（thenable），这和运行时 `await` 的行为一致。

## 面试官可能追问

::: details 只有泛型参数才会分发吗？
是的。分发只发生在"被检查的类型是裸类型参数，并且实例化时传入了联合类型"的情况下。直接写 `string | number extends string ? 1 : 2` 不会分发，联合类型作为整体判断，结果是 2。`T[] extends ...`、`Promise<T> extends ...` 中的 T 被包了起来，也不会分发。
:::

::: details 同一个 infer 变量出现在多个位置时，推断出什么？
出现在多个协变位置（如对象属性、返回值）时，结果是这些候选类型的**联合**；出现在多个逆变位置（如函数参数）时，结果是**交叉**：

```ts
type PropUnion<T> = T extends { a: infer U; b: infer U } ? U : never
type K = PropUnion<{ a: string; b: number }> // string | number

type ParamCross<T> = T extends { a: (x: infer U) => void; b: (x: infer U) => void } ? U : never
type L = ParamCross<{ a: (x: { id: number }) => void; b: (x: { name: string }) => void }> // { id: number } & { name: string }
```

把联合类型转成交叉类型的 `UnionToIntersection`，利用的就是逆变位置的这条规则。
:::

::: details 条件类型可以递归吗？有什么限制？
可以，上面的 MyAwaited 就是递归的。但递归深度有上限，太深会报"类型实例化过深，且可能无限"。递归处理很长的字符串或元组时，尽量写成尾递归的形式（递归调用直接作为分支的结果，外面不再包其他类型），TS 对这种形式做了优化，允许的深度更大。
:::

## 易错点

- 只有裸类型参数才会分发，`T[]`、`[T]`、`Promise<T>` 中的 T 都不会
- 传入 never 时，分布式条件类型直接得到 never，不会进入任何分支
- `boolean` 是 `true | false`，传给分布式条件类型时也会被拆开
- infer 只能写在条件类型的 `extends` 子句中，不能单独使用
