---
difficulty: 2
tags: [高频, 对比]
---

# satisfies 和 as const 有什么用？和类型断言、类型注解有什么区别？

::: tip 一句话回答
四者都在影响"一个值是什么类型"，方向不同。**类型注解** `const x: T = ...` 检查值并把变量的类型**定为 T**，更具体的信息就丢了；**类型断言** `x as T` 是让编译器相信你，基本**不检查**，容易掩盖错误；**as const** 让字面量保持最窄的类型并变成**只读**；**satisfies**（TS 4.9 起）**检查**值符合 T，但变量**保留推断出的具体类型**。配置对象常用 `as const satisfies T`：既保留字面量，又校验结构。
:::

## 详细解析

### 类型注解：检查，但会拓宽

```ts
type Theme = Record<string, string | number>

const theme: Theme = { primary: '#1677ff', radius: 4 }
// 变量的类型就是 Theme：键变成任意 string，值是 string | number
// @ts-expect-error primary 的类型是 string | number，不能直接调用字符串方法
theme.primary.toUpperCase()
theme.typo // 不报错：Record<string, ...> 允许任意键
```

注解把变量的类型"钉死"为 T。好处是对象字面量会做多余属性检查、后续赋值也受约束；代价是推断出的具体信息（有哪些键、每个值的具体类型）全部丢失。

### 类型断言：几乎不检查

```ts
interface User {
  id: number
  name: string
}

const u = {} as User // 不报错：缺少 id 和 name，运行时 u.name 是 undefined
const v = { id: 1, name: 'Tom', nmae: 'x' } as User // 不报错：多余属性不检查，拼写错误被放过

// @ts-expect-error 只有两个类型完全没有重叠时才拦截
const n = 'x' as number
const m = 'x' as unknown as number // 先转 unknown 就能绕过，这是危险信号
```

断言只要求两个类型"可比较"，大致是其中一方能赋值给另一方：`User` 能赋值给 `{}`，所以缺少必填属性也能通过；它也不做多余属性检查。它适合你确实比编译器知道得多的场景（比如 DOM 查询结果），不适合用来"让报错消失"。

### as const：最窄的字面量 + 只读

```ts
const a = { method: 'GET', retry: [1, 2] } // { method: string; retry: number[] }
const b = { method: 'GET', retry: [1, 2] } as const // { readonly method: 'GET'; readonly retry: readonly [1, 2] }
```

as const 不做任何检查，只改变推断方式：字符串、数字保持字面量类型，数组变成只读元组，属性全部 readonly。它常用来替代 enum，见 [enum 的问题和替代写法](/basics/typescript/08-enum)。

### satisfies：检查，但保留推断类型

```ts
type Theme = Record<string, string | number>

const theme = { primary: '#1677ff', radius: 4 } satisfies Theme
theme.primary.toUpperCase() // primary 仍是 string
theme.radius.toFixed(1) // radius 仍是 number
// @ts-expect-error 推断类型里没有 typo，访问时就会报错
theme.typo

// @ts-expect-error 结构不符合时照样报错：true 不是 string | number
const bad = { primary: true } satisfies Theme
```

satisfies 和注解一样会做多余属性检查，也会给字面量提供上下文类型，但表达式最终的类型是它自己推断出来的那个。

### 四者对比

| 写法 | 是否检查结构 | 变量最终的类型 | 典型用途 |
| --- | --- | --- | --- |
| `const x: T = v` | 检查，含多余属性检查 | T | 函数参数、对外暴露的变量 |
| `v as T` | 基本不检查 | T | 你比编译器更清楚的场景 |
| `v as const` | 不检查 | v 的最窄只读类型 | 常量表、替代 enum |
| `v satisfies T` | 检查，含多余属性检查 | v 的推断类型 | 配置对象、映射表 |
| `v as const satisfies T` | 检查 | v 的最窄只读类型 | 既要字面量又要校验的常量 |

## 代码示例：as const satisfies 写路由表

```ts
interface RouteConfig {
  path: `/${string}`
  auth: boolean
}

const routes = {
  home: { path: '/', auth: false },
  profile: { path: '/profile', auth: true },
  // 写成 path: 'settings' 会报错：不符合 `/${string}`
} as const satisfies Record<string, RouteConfig>

type RouteName = keyof typeof routes // 'home' | 'profile'，注解成 Record 就只剩 string
type ProfilePath = (typeof routes)['profile']['path'] // '/profile'

function navigate(name: RouteName) {
  return routes[name].path
}
navigate('profile')
// @ts-expect-error 'setting' 不是已有的路由名
navigate('setting')
```

写法顺序是 `as const satisfies T`：先由 as const 得到最窄的类型，再交给 satisfies 校验。

## 面试官可能追问

::: details 有了 satisfies，还需要类型注解吗？
需要。两者解决的问题不同：注解约束的是变量，以后的赋值、函数参数和返回值都按 T 检查，适合对外的契约；satisfies 只在这一处做检查，不约束之后的使用。`let` 变量之后还会被重新赋值，用注解更合适；只定义一次的常量配置，用 satisfies 能保留更多信息。
:::

::: details 函数参数也想推断出字面量类型，怎么办？
TS 5.0 起可以给类型参数加 `const` 修饰符，调用时传入的字面量会像加了 as const 一样推断：

```ts
function defineRoles<const T extends readonly string[]>(roles: T) {
  return roles
}
const roles = defineRoles(['admin', 'user']) // readonly ['admin', 'user']，不用调用方写 as const
```
:::

::: details 什么时候用 as 断言是合理的？
你掌握了编译器不知道的信息时，比如 `document.querySelector('#app') as HTMLDivElement`，你知道这个元素一定是 div。但它不做运行时检查，判断错了就是运行时错误。对外部数据（接口响应、`JSON.parse` 的结果）用 as 是最常见的误用，应该做运行时校验，见 [运行时校验](/basics/typescript/18-runtime-validation)。
:::

## 易错点

- as const 只影响类型，不会冻结对象，运行时仍能修改
- satisfies 不改变变量的类型，`const x = v satisfies T` 之后 x 不能当作 T 去接收其他赋值
- `as unknown as T` 能把任何类型转成任何类型，出现在代码里基本说明类型设计有问题
- 断言不做多余属性检查，`{ id: 1, name: 'Tom', nmae: 'x' } as User` 里的拼写错误会被放过
