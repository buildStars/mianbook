---
difficulty: 2
tags: [实践, 原理]
---

# 模板字面量类型怎么用？

::: tip 一句话回答
模板字面量类型是**类型层面的模板字符串**，写法是 `` `on${Name}` ``，用来拼出新的字符串字面量类型。插入的是联合类型时，会**展开成所有组合**。配合内置的 `Uppercase`、`Lowercase`、`Capitalize`、`Uncapitalize` 可以转换大小写；配合 **infer** 能反过来解析字符串，比如从 `'/user/:id'` 提取出 `{ id: string }`；配合映射类型的 **as 重映射**能批量生成 `getName`、`nameChanged` 这样的键名。常见场景是事件名、路由参数、API 路径和 CSS 值。
:::

## 详细解析

### 基础语法：拼接与组合展开

```ts
type Lang = 'zh' | 'en'
type Page = 'home' | 'about'

type Greeting = `hello ${'world' | 'ts'}` // 'hello world' | 'hello ts'
type Route = `/${Lang}/${Page}` // 4 种组合：'/zh/home' | '/zh/about' | '/en/home' | '/en/about'

// 插槽里也可以放 string、number 这类宽类型，得到一个"模式"
type CssPx = `${number}px`
const width: CssPx = '12px'
// @ts-expect-error 'auto' 不符合 `${number}px` 的模式
const height: CssPx = 'auto'
```

- 插槽里能放 `string`、`number`、`bigint`、`boolean`、`null`、`undefined` 以及它们的字面量和联合
- 多个联合类型相乘时组合数增长很快，超过编译器的上限会报 TS2590"联合类型过于复杂"

### 内置的大小写工具类型

`Uppercase`、`Lowercase`、`Capitalize`（首字母大写）、`Uncapitalize`（首字母小写）是编译器内置实现的，只作用于字符串类型：

```ts
type A = Uppercase<'get'> // 'GET'
type B = Capitalize<'click' | 'focus'> // 'Click' | 'Focus'
type C = `on${Capitalize<'click' | 'focus'>}` // 'onClick' | 'onFocus'
```

`keyof T` 可能包含 number 和 symbol，传给它们之前要写 `Capitalize<string & K>`，把键过滤成字符串。

### 配合 infer 解析字符串

在条件类型里，模板字面量也能当作"模式"去匹配，用 infer 取出其中的片段：

```ts
// 'a/b/c' 匹配 `${infer Head}/${infer Rest}`：Head 取到第一个 / 之前，Rest 是剩下的全部
type Split<S extends string, Sep extends string> = S extends `${infer Head}${Sep}${infer Rest}`
  ? [Head, ...Split<Rest, Sep>]
  : [S]
type Parts = Split<'a/b/c', '/'> // ['a', 'b', 'c']

// 提取路由参数名：'/user/:id/post/:postId' → 'id' | 'postId'
type ParamNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamNames<Rest>
  : P extends `${string}:${infer Name}`
    ? Name
    : never

type RouteParams<P extends string> = { [K in ParamNames<P>]: string }
type UserParams = RouteParams<'/user/:id'> // { id: string }
type PostParams = RouteParams<'/user/:id/post/:postId'> // { id: string; postId: string }
```

匹配规则：`infer` 后面紧跟固定文本时，它取到这段文本**第一次出现**之前；最后一个 `infer` 拿走剩下的全部。解析通常要递归，条件类型的递归写法和深度限制见 [条件类型和 infer](/basics/typescript/05-conditional-infer)。

### 配合映射类型生成键名

映射类型的 `as` 子句可以把键改成模板字面量类型，生成 getter 名的写法见 [keyof 和映射类型](/basics/typescript/09-keyof-mapped)。反过来，`as` 子句里也能用 infer 解析键名，筛选并改写键：

```ts
interface User { name: string; age: number }

// 给每个属性生成"变化事件"名
type ChangeEvent<T> = `${string & keyof T}Changed`
type UserEvent = ChangeEvent<User> // 'nameChanged' | 'ageChanged'

// 只保留 data- 开头的键，并去掉前缀；映射成 never 的键会被删除
type DataAttrs<T> = { [K in keyof T as K extends `data-${infer Rest}` ? Rest : never]: T[K] }
type Attrs = DataAttrs<{ 'data-id': number; 'data-role': string; title: string }> // { id: number; role: string }
```

## 代码示例：类型安全的路由跳转

参数名从路径字符串里推导，漏传、多传、拼错都会在编译时报错：

```ts
type ParamNames<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | ParamNames<Rest>
  : P extends `${string}:${infer Name}`
    ? Name
    : never

function buildPath<P extends string>(pattern: P, params: Record<ParamNames<P>, string | number>): string {
  // 运行时照常做字符串替换，类型只负责检查参数
  return pattern.replace(/:(\w+)/g, (_, key: string) => String((params as Record<string, string | number>)[key]))
}

buildPath('/user/:id/post/:postId', { id: 1, postId: 'p9' }) // '/user/1/post/p9'
// @ts-expect-error 缺少 postId
buildPath('/user/:id/post/:postId', { id: 1 })
// @ts-expect-error 没有 :uid 这个参数
buildPath('/user/:id', { uid: 1 })
```

## 面试官可能追问

::: details `` `${string}` `` 和 string 有什么区别？
单独的 `` `${string}` `` 就等于 string。带固定文本的模式才有约束作用：`'data-id'` 能赋值给 `` `data-${string}` ``，但一个类型是 string 的变量不能，因为编译器不知道它的内容。所以模式类型适合约束字面量，来自外部的字符串要先在运行时校验。
:::

::: details 怎么从嵌套对象生成 'a.b.c' 这样的路径类型？
用映射类型遍历键，值是对象时递归，并用模板字面量把父键和子路径拼起来：

```ts
type Paths<T> = {
  [K in keyof T & string]: T[K] extends object ? K | `${K}.${Paths<T[K]>}` : K
}[keyof T & string]

type Keys = Paths<{ user: { name: string; address: { city: string } } }>
// 'user' | 'user.name' | 'user.address' | 'user.address.city'
```

i18n 库校验翻译键、表单库校验字段路径，大多是类似的思路。对象很深很大时，组合数和递归深度都可能触发编译器的限制，编辑器也会变慢。
:::

::: details 模板字面量类型能做运行时校验吗？
不能。它和其他类型一样会被擦除，只检查代码里写死的字面量。接口返回的字符串、用户输入要用正则或校验库检查，见 [运行时校验](/basics/typescript/18-runtime-validation)。
:::

## 易错点

- 联合类型插进模板会做笛卡尔积，几个大联合相乘很容易超过上限
- `Capitalize<K>` 里的 K 来自 `keyof` 时要写 `string & K`，否则报"不满足约束 string"
- infer 匹配时取的是分隔符**第一次**出现之前的部分，解析多段字符串要递归
