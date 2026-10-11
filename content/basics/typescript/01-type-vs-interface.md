---
difficulty: 2
tags: [高频, 对比]
---

# `type` 和 `interface` 有什么区别？该用哪个？

::: tip 一句话回答
描述对象结构时，两者大多数情况下可以互换。区别主要有三点：**interface 支持声明合并**，同名接口会自动合并，适合扩充第三方库和全局类型；**扩展时处理冲突的方式不同**，`interface extends` 遇到不兼容的同名属性会直接报错，交叉类型 `&` 不报错，冲突的属性会变成 `never`；**type 能表达的类型更多**，联合类型、元组、映射类型、条件类型都只能用 type 写。常见的约定是对象结构用 interface，其他用 type，关键是团队统一。
:::

## 详细解析

### 相同点

两者都能描述对象和函数，都能被扩展，也都能被类 `implements`：

```ts
interface Animal { name: string }
interface Dog extends Animal { bark(): void }

type Point = { x: number; y: number }
type Point3D = Point & { z: number }

// interface 可以继承对象类型的 type，type 也可以和 interface 交叉
interface LabeledPoint extends Point { label: string }

class Corgi implements Dog {
  name = 'corgi'
  bark() {}
}
```

### 声明合并：只有 interface 可以

同名的 interface 会合并成一个，type 重复声明会报"标识符重复"：

```ts
interface User {
  name: string
}
interface User {
  age: number
}
const u: User = { name: 'Tom', age: 18 } // 合并后两个属性都必须有
```

这个特性主要用来扩充已有的类型，比如给 `window` 加全局属性、给 Vue 组件实例加属性，详见 [声明文件和模块扩充](/basics/typescript/10-declaration-files)。

### 扩展时，冲突属性的处理不同

```ts
interface A {
  id: string
}
// @ts-expect-error 报错：接口 B 错误地扩展了接口 A，id 的类型不兼容
interface B extends A {
  id: number
}

type C = { id: string } & { id: number }
type CId = C['id'] // never：声明时不报错，用到时才发现问题
```

- `extends` 要求子接口的同名属性能赋值给父接口的属性。可以收窄（比如把 `string` 改成 `'a' | 'b'`），不兼容就在声明处报错
- 交叉类型会把同名属性的类型也做交叉，`string & number` 没有任何值能满足，结果是 `never`。如果冲突的是字面量类型（比如一边 `kind: 'a'`、一边 `kind: 'b'`），整个交叉类型都会变成 `never`

所以 `extends` 能更早暴露问题。

### 只有 type 能表达的

```ts
type Status = 'idle' | 'loading' | 'success' | 'error' // 联合类型
type Entry = [key: string, value: number] // 元组
type ID = string | number // 给任意类型起别名，包括原始类型
type Nullable<T> = { [K in keyof T]: T[K] | null } // 映射类型
type ElementOf<T> = T extends readonly (infer E)[] ? E : never // 条件类型
type EventName = `on${Capitalize<'click' | 'focus'>}` // 'onClick' | 'onFocus'
```

interface 只能描述对象结构（包括函数的调用签名和索引签名），上面这些都要用 type。

### 报错信息和性能

- interface 是有名字的类型，悬停提示和报错信息里直接显示名字；层层交叉、映射得到的类型，提示里有时会被展开成一长串结构，不好读
- TypeScript 官方的性能建议提到：interface 之间的类型关系可以被缓存，而检查交叉类型时要逐个检查组成它的每个类型。普通项目感受不到差别，类型规模很大时才需要关注

### 怎么选

- 对象结构，特别是组件 props、接口返回值、库对外暴露的类型，用 interface：报错清晰，使用方还能通过声明合并扩充
- 联合类型、元组、工具类型的组合、条件类型，只能用 type
- 两者混用没有问题，关键是团队统一。可以用 typescript-eslint 的 `consistent-type-definitions` 规则约束定义对象类型时用哪一种

## 面试官可能追问

::: details satisfies 是什么？和类型注解有什么区别？
`satisfies` 检查一个值是否符合某个类型，但**不改变**这个值被推导出的类型；类型注解则把变量的类型直接设为注解的类型，更具体的信息就丢了：

```ts
type Color = 'red' | 'green' | 'blue'

const annotated: Record<Color, string | number[]> = { red: [255, 0, 0], green: '#00ff00', blue: '#0000ff' }
// annotated.green 的类型是 string | number[]，调用字符串方法前要先收窄

const palette = {
  red: [255, 0, 0],
  green: '#00ff00',
  blue: '#0000ff',
} satisfies Record<Color, string | number[]>
const hex = palette.green.toUpperCase() // green 被推导为 string，可以直接用
```

少写一个颜色或拼错键名，两种写法都会报错。适合配置对象这类"既要检查格式，又要保留具体类型"的场景。
:::

::: details 为什么 interface 不能赋值给 `Record<string, string>`，type 却可以？
```ts
interface IUser { name: string }
type TUser = { name: string }

const a: IUser = { name: 'a' }
const b: TUser = { name: 'b' }
const r1: Record<string, string> = b // 可以
// @ts-expect-error 报错：类型 IUser 中缺少类型 string 的索引签名
const r2: Record<string, string> = a
```

type 定义的对象字面量类型有"隐式索引签名"：它的属性是确定的，TS 可以检查每个属性都符合索引签名。interface 可能在别处被声明合并加上其他属性，TS 不做这个假设。遇到这种情况，可以改用 type，或者给 interface 显式加上索引签名。
:::

::: details 同名 interface 合并时，属性类型冲突会怎样？
普通属性必须类型完全相同，否则报错（"后续属性声明必须属于同一类型"）。同名的方法不会报错，而是合并成函数重载，后声明的 interface 里的重载排在前面，优先匹配。
:::

## 易错点

- 不要说"type 不能扩展"：交叉类型就是 type 的扩展方式，interface 也可以 `extends` 一个对象类型的 type
- 交叉类型的属性冲突不会在声明处报错，而是得到 `never`，问题要到使用时才暴露
- 声明合并只发生在同一作用域里：模块文件中声明的 `interface Window` 是一个新的局部接口，不会和全局的 `Window` 合并，要写在 `declare global` 里
