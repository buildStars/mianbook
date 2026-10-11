---
difficulty: 2
tags: [高频, 对比]
---

# any、unknown、never 有什么区别？

::: tip 一句话回答
`any` 和 `unknown` 都是**顶层类型**，任何值都能赋给它们。区别在于 `any` 会**关闭类型检查**，可以随意读属性、调用，还会"传染"给用到它的表达式；`unknown` 必须先**收窄**（typeof、instanceof、类型守卫）才能使用，是接收外部输入的安全选择。`never` 是**底层类型**，表示不可能存在的值，来自总是抛错的函数、被穷尽后的分支等，常用来做**穷尽检查**。
:::

## 详细解析

### 在类型层级中的位置

```text
              unknown（顶层：所有类型都能赋给它）
     ┌─────────┬─────────┼─────────┬─────────┐
   string    number    object   boolean    ...
     └─────────┴─────────┼─────────┴─────────┘
              never（底层：能赋给所有类型，没有值属于它）

any 不遵守这套规则：能接收任何值，也能赋给除 never 以外的任何类型
```

| | any | unknown | never |
| --- | --- | --- | --- |
| 什么值能赋给它 | 任何值 | 任何值 | 没有（只有 never 本身） |
| 它能赋给谁 | 除 never 外的任何类型 | 只能赋给 unknown 和 any | 任何类型 |
| 直接读属性、调用 | 可以，不做检查 | 不行，要先收窄 | 没有值，代码走不到这里 |
| 常见来源 | `JSON.parse`、没有类型的旧代码、显式标注 | 外部输入、`catch` 的错误 | 抛错的函数、穷尽后的分支、不可能的交叉 |

### any：关闭检查，还会传染

```ts
const data: any = JSON.parse('{"user": null}')
const userName = data.user.name // 不报错，运行时才抛 TypeError
const upper = userName.toUpperCase() // userName 是 any，upper 也是 any

function getId(obj: any) {
  return obj.id // 返回值也被推断为 any
}
const id = getId({}) // any
```

一个 any 会沿着属性访问、函数返回值、赋值一路扩散，相关代码全都失去检查，编辑器也不会提示。`JSON.parse` 的返回值、`await response.json()` 的结果都是 any，是最常见的源头。

### unknown：先收窄再使用

```ts
interface User {
  name: string
}

function isUser(value: unknown): value is User {
  return typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string'
}

const raw: unknown = JSON.parse('{"name": "Tom"}') // 用 unknown 接住，不让 any 扩散
// @ts-expect-error raw 是 unknown，不能直接访问属性
raw.name
if (isUser(raw)) {
  console.log(raw.name) // 收窄后是 User
}

try {
  JSON.parse('{')
} catch (err) {
  // err 是 unknown：throw 可以抛出任何值，不一定是 Error
  const message = err instanceof Error ? err.message : String(err)
  console.error(message)
}
```

- `catch` 的变量在 strict 模式下（其中的 `useUnknownInCatchVariables` 选项）是 unknown，否则是 any
- 字段多时手写守卫很繁琐，实际项目常用 zod 这类校验库，校验通过后得到带类型的数据。各种收窄方式见 [类型收窄](/basics/typescript/06-narrowing)

### never：不可能存在的值

- 总是抛错或死循环、永远不会正常返回的函数，返回类型是 never
- 联合类型的成员被逐个排除完之后，剩下的就是 never
- 不可能同时满足的类型，如 `string & number`
- 在联合类型中会被吸收：`string | never` 就是 `string`。`Exclude` 等工具类型正是靠这一点过滤成员，见 [条件类型](/basics/typescript/05-conditional-infer)

## 代码示例：穷尽检查

只有 never 能赋值给 never，利用这一点可以让编译器检查 switch 是否处理了所有情况：

```ts
type Shape =
  | { kind: 'circle'; radius: number }
  | { kind: 'square'; size: number }

// 显式标注 never：调用它之后的代码会被当作不可达
function assertNever(value: never): never {
  throw new Error(`未处理的情况：${JSON.stringify(value)}`)
}

function area(shape: Shape): number {
  switch (shape.kind) {
    case 'circle':
      return Math.PI * shape.radius ** 2
    case 'square':
      return shape.size ** 2
    default:
      // 所有成员都处理过了，这里 shape 是 never
      return assertNever(shape)
  }
}
```

以后给 `Shape` 加上 `{ kind: 'triangle'; ... }` 却忘了在 `area` 里处理，`default` 分支中的 `shape` 就不再是 never，`assertNever(shape)` 会在编译时报错。运行时如果真的走到这里（比如后端返回了新类型），也会抛出明确的错误，而不是悄悄返回 `undefined`。

## 面试官可能追问

::: details 都能接收任何值，为什么推荐用 unknown 代替 any？
any 是"关掉检查"，unknown 是"先检查再用"。用 unknown 接住外部数据，编译器会强制你在使用前做类型判断，错误在编译时就能发现；any 把问题推迟到运行时，还会扩散到相关代码。确实需要临时绕过检查时，也要把 any 限制在尽量小的范围内，并注释原因。
:::

::: details never 和 void 有什么区别？
`void` 表示函数正常返回了，只是没有有意义的返回值（实际返回 `undefined`）；`never` 表示函数根本不会正常返回，要么抛错，要么死循环。另外，返回值是 void 的函数类型可以接收有返回值的函数，`const f: () => void = () => 1` 是合法的，返回值会被忽略，所以 `arr.forEach((x) => list.push(x))` 不会报错。
:::

::: details 怎么避免 any 在项目里扩散？
- 开启 `strict`，其中的 `noImplicitAny` 会禁止隐式的 any，比如没写类型的函数参数
- 用 typescript-eslint 的 `no-explicit-any` 和 `no-unsafe-*` 系列规则，限制显式 any 和对 any 值的使用
- `JSON.parse` 和接口返回的数据先当作 unknown，校验后再用
- 第三方库缺少类型时补上声明文件，而不是到处写 any，见 [声明文件怎么写](/basics/typescript/10-declaration-files)
:::

## 易错点

- 函数声明即使总是抛错，也会被推断为返回 `void`，只有箭头函数和函数表达式会被推断为 `never`。而且只有显式标注 `: never` 的函数，调用之后的代码才会被当作不可达
- `as` 断言不是收窄：`raw as User` 只是让编译器相信你，运行时没有任何校验
- 用 `typeof value === 'object'` 收窄 unknown 时要排除 `null`，因为 `typeof null` 也是 "object"
