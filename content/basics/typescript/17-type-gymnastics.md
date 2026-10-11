---
difficulty: 3
tags: [手写题, 原理]
---

# 手写常见的类型体操：DeepPartial、DeepReadonly、UnionToIntersection

::: tip 一句话回答
DeepPartial、DeepReadonly 的核心是**递归的映射类型**：对象属性继续递归，原始类型原样返回。要注意两类特殊值：**函数**和 Date、Map 这类内置对象也属于 object，必须提前排除，否则会被映射成不能用的结构；**数组和元组**交给同态映射类型处理，会自动保持数组或元组的形态。UnionToIntersection 利用的是**函数参数的逆变**：先把联合类型的每个成员分发到函数参数位置，再用 infer 从这个位置推断，多个逆变候选会被合并成**交叉类型**。这些写法面试常考，但业务代码里要适度，能用内置工具类型就别自己造。
:::

## 详细解析

### DeepPartial 和 DeepReadonly

[工具类型](/basics/typescript/04-utility-types) 里的 Partial、Readonly 都只处理第一层。深层版本要递归，并处理好边界：

```ts
// 不应该被递归展开的类型
type Builtin = Date | RegExp | Map<unknown, unknown> | Set<unknown> | ((...args: any[]) => unknown)

type DeepPartial<T> = T extends Builtin
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T

type DeepReadonly<T> = T extends Builtin
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T

interface Config {
  db: { host: string; port: number }
  tags: string[]
  createdAt: Date
  onReady: () => void
}

const patch: DeepPartial<Config> = { db: { port: 3307 } } // 只改深层的一个字段

declare const config: DeepReadonly<Config>
// @ts-expect-error 深层属性也是只读的
config.db.port = 1
// @ts-expect-error tags 变成了 readonly string[]，没有 push
config.tags.push('x')
config.createdAt.getTime() // Date 保持原样，方法可以正常调用
config.onReady() // 函数保持原样
```

逐个解释：

1. `T extends Builtin ? T`：函数、Date、Map 也是 object，不排除的话，函数会被映射成一个没有调用签名的对象，Date 的方法会全部变成可选
2. `T extends object ? {...} : T`：对象递归，原始类型直接返回，递归到叶子时终止
3. 数组不用单独处理：`{ [K in keyof T]: ... }` 作用在泛型参数 T 上时是**同态映射类型**，T 是数组或元组时结果仍是数组或元组，`string[]` 经过 DeepReadonly 得到 `readonly string[]`，`[number, string]` 得到 `readonly [number, string]`

### UnionToIntersection：利用逆变

```ts
type UnionToIntersection<U> =
  (U extends unknown ? (arg: U) => void : never) extends (arg: infer I) => void ? I : never

type A = UnionToIntersection<{ a: 1 } | { b: 2 }> // { a: 1 } & { b: 2 }
```

分三步看：

```text
1. U extends unknown ? (arg: U) => void : never
   U 是裸类型参数，分发：((arg: { a: 1 }) => void) | ((arg: { b: 2 }) => void)

2. ... extends (arg: infer I) => void
   外层的 extends 左边不是裸类型参数，不分发，整个联合一起匹配
   I 在两个函数的参数位置各有一个候选：{ a: 1 } 和 { b: 2 }

3. 参数是逆变位置，多个候选取交叉：I = { a: 1 } & { b: 2 }
```

为什么是交叉：要找一个参数类型 I，使 `(arg: I) => void` 能同时作为这两个函数的"公共父类型"，按逆变规则 I 必须同时满足 `{ a: 1 }` 和 `{ b: 2 }`。协变位置（返回值、属性）的多个候选则取联合，见 [条件类型和 infer](/basics/typescript/05-conditional-infer)，变型的原理见 [协变和逆变](/basics/typescript/13-variance)。

### IsEqual 和 TupleToUnion

```ts
// 判断两个类型是否完全相同
type IsEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

// 互相 extends 的写法分不清 any 和只读修饰符
type NaiveEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

type E1 = NaiveEqual<any, 1> // true ❌
type E2 = IsEqual<any, 1> // false ✅
type E3 = NaiveEqual<{ a: 1 }, { readonly a: 1 }> // true ❌
type E4 = IsEqual<{ a: 1 }, { readonly a: 1 }> // false ✅

// 元组转联合：直接用 number 索引
type TupleToUnion<T extends readonly unknown[]> = T[number]
type U = TupleToUnion<['a', 1, true]> // 'a' | 1 | true
```

IsEqual 的思路：T 未确定时，两个条件类型无法求值，编译器只能比较它们的结构，要求 A 和 B 是"同一个类型"才认为相等，这比可赋值性严格得多。这是依赖编译器内部实现的技巧，类型测试库常用，但官方并未把它当作正式特性说明。

### 递归深度限制

递归类型有深度上限，超过时报 TS2589"类型实例化过深，且可能无限"。TS 4.5 起，**尾递归**的条件类型（递归调用直接作为分支结果）允许的深度大得多，上限在 1000 层左右；非尾递归的写法几十层就可能报错。处理长字符串、长元组时要写成尾递归，用累加器参数保存中间结果。

## 面试官可能追问

::: details 工作中应该写多复杂的类型？
以"读代码的人能看懂、报错信息能定位问题"为限。复杂类型会拖慢编辑器和编译，出错时的提示也很难读。常见的做法：工具类型集中放在一个文件并写测试；能用内置的 Partial、Pick 组合解决就不手写；库的对外 API 可以复杂一些，换来使用方的好体验，业务代码保持简单。
:::

::: details 类型怎么写测试？
用 IsEqual 加一个只接受 true 的工具：`type Expect<T extends true> = T`，然后写 `type cases = [Expect<IsEqual<DeepReadonly<X>, Y>>]`，不相等时编译报错。也可以用 Vitest 的 `expectTypeOf`，或者在代码里用 `// @ts-expect-error` 断言某一行必须报错。
:::

::: details `UnionToIntersection<string | number>` 得到什么？
`string & number`，也就是 never。没有值能同时是字符串和数字。boolean 也一样：`true & false` 是 never。所以它适合对象类型的联合，比如把多个插件的配置合并成一个类型。
:::

## 易错点

- 递归映射前不排除函数，函数属性会变成不能调用的对象类型
- UnionToIntersection 的外层 extends 不能是裸类型参数，否则又会被分发，得不到交叉
- 互相 extends 判断相等会把 any、readonly 差异当成相等
- 递归类型没写终止条件或写成非尾递归，很容易触发深度限制
