---
difficulty: 2
tags: [高频, 实践]
---

# TypeScript 的类型在运行时还存在吗？怎么做运行时校验？

::: tip 一句话回答
不存在。TS 的类型在编译后**全部擦除**，interface、类型注解、泛型都不会留下任何运行时代码，所以它只能保证"自己写的代码之间"类型一致。接口响应、用户输入、`JSON.parse` 的结果、环境变量这些**外部数据**，类型只是你的假设，`as User` 也只是让编译器相信你，**不做任何检查**。可靠的做法是在**数据进入系统的边界**做运行时校验：用 Zod 这类库定义 schema，`parse` / `safeParse` 校验数据，再用 `z.infer` 从 schema 推导出类型，一份定义同时得到校验逻辑和类型。
:::

## 详细解析

### 类型擦除：编译后什么都不剩

```ts
interface User {
  id: number
  name: string
}

async function getUser(id: number): Promise<User> {
  const res = await fetch(`/api/users/${id}`)
  return res.json() // res.json() 返回 Promise<any>，这里不报错，也不检查
}
```

编译成 JS 后，`interface User` 和所有类型标注都消失了。如果后端把 `name` 改成了 `userName`，或者某次返回了 `null`，编译期不会发现，错误会在之后某个使用 `user.name` 的地方才暴露，离真正的问题源头很远。

| 数据来源 | 为什么不可信 |
| --- | --- |
| 接口响应 | 后端改字段、返回错误结构、网关返回 HTML 错误页 |
| 用户输入、URL 参数 | 任意字符串，格式和范围都不确定 |
| `JSON.parse`、`localStorage` | 返回 any，存进去的可能是旧版本的数据 |
| 环境变量 | 都是 `string \| undefined`，可能没配、拼错、格式不对 |
| `postMessage`、WebSocket 消息 | 来源和格式都不受自己控制 |

### as 断言和手写守卫的局限

`res.json() as User` 和上面一样，只是把 any 换成了"看起来有类型"，运行时没有任何检查（见 [satisfies 和类型断言](/basics/typescript/12-satisfies-as-const)）。手写类型守卫能真正检查，但问题也很明显：

- 字段多、有嵌套时代码很长，每个字段都要写 `typeof` 判断
- 类型定义和守卫是两份代码，改了 interface 忘了改守卫，守卫就会"说谎"，TS 不会发现
- 只返回 true / false，不知道是哪个字段、为什么失败

手写守卫的写法见 [类型收窄](/basics/typescript/06-narrowing)，适合一两个字段的简单判断。

### 用 schema 库：一份定义，两种用途

```ts
import * as z from 'zod'

// 运行时的校验规则
const UserSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  email: z.email(),
  role: z.enum(['admin', 'member']),
})

// 从 schema 推导出静态类型，不用再手写 interface
type User = z.infer<typeof UserSchema> // { id: number; name: string; email: string; role: 'admin' | 'member' }

// parse：校验失败时抛出 ZodError，成功时返回带类型的数据
const user: User = UserSchema.parse({ id: 1, name: 'Tom', email: 'tom@example.com', role: 'admin' })

// safeParse：不抛错，返回可辨识联合
const result = UserSchema.safeParse({ id: '1', name: '' })
if (!result.success) {
  // 每个 issue 带有 path 和 message，能定位到具体字段
  console.log(result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`))
} else {
  console.log(result.data.name) // 这里 result.data 是 User
}
```

- 校验规则只写一次，类型由它推导，两者不会不一致
- z.object 默认会**去掉未声明的字段**，校验后的数据不会带着多余的属性往下传
- `z.email()`、`z.url()` 是 Zod 4 推荐的写法；Zod 3 写成 `z.string().email()`，这种方法写法在 Zod 4 里仍能用，但已标记为废弃
- 同类的库还有 Valibot、ArkType 等，思路相同：先定义 schema，再推导类型

### 在哪里校验

只在**边界**校验，校验通过后，内部代码就可以完全信任类型，不用到处判断：

```text
接口响应 ──┐
表单提交 ──┤
URL 参数 ──┼──> [ schema 校验 ] ──> 内部代码：类型可信，不再重复检查
环境变量 ──┤         │
消息事件 ──┘         └──> 失败：记录日志、提示用户、使用默认值或直接终止启动
```

服务端更要校验：前端的校验只是为了体验，请求可以绕过前端直接发送。前后端都用 TS 时，可以把 schema 放在共享包里，两边用同一套规则。

## 代码示例：启动时校验环境变量

```ts
import * as z from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000), // 字符串转数字后再校验
  DATABASE_URL: z.url(),
})

// 配置错了就在启动时失败，而不是等到第一次查数据库才报错
const parsed = EnvSchema.safeParse(process.env)
if (!parsed.success) {
  console.error('环境变量配置错误：', parsed.error.issues)
  process.exit(1)
}

export const env = parsed.data // { NODE_ENV: ...; PORT: number; DATABASE_URL: string }
```

## 面试官可能追问

::: details z.infer、z.input、z.output 有什么区别？
schema 里有转换时，输入和输出的类型不同。上例的 `PORT` 用了 `z.coerce`，输入类型是 unknown（什么都先接下来再转换），输出一定是 number；带 `.default()` 的字段输入可以缺省，输出一定有值。`z.input` 是校验前能接受的类型，`z.output` 是校验后得到的类型，`z.infer` 等同于 `z.output`。给表单库传类型时，经常要区分这两者。
:::

::: details 每个接口都校验，会不会影响性能？
校验本身是遍历一遍数据，普通接口的响应体量下开销很小，和网络请求比可以忽略。数据量很大的列表可以只校验关键字段，或者只在开发环境做完整校验。真正的成本在于维护 schema，所以优先校验对系统影响大的数据：外部接口、用户提交、配置。
:::

::: details 能不能反过来，从 TS 类型自动生成校验代码？
TS 编译器本身不提供这个能力，类型在运行时不存在。有一些工具通过编译插件或代码生成，从类型生成校验函数，也有工具从 OpenAPI 文档同时生成类型和校验代码。主流做法还是"schema 为主、类型从 schema 推导"，因为 schema 能表达长度、格式、范围这类类型系统表达不了的规则。
:::

## 易错点

- `as` 断言和泛型返回值（如 `request<User>()`）都不做任何运行时检查
- 只在前端校验不够，服务端必须自己校验
- 校验应该放在边界，进入系统后不要层层重复校验
- 用 schema 推导类型后就不要再手写一份 interface，否则又回到两份定义不一致的问题
