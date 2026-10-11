---
difficulty: 2
tags: [高频, 实践]
---

# keyof、typeof、索引访问和映射类型怎么用？

::: tip 一句话回答
这几个是"从已有的类型或值推导新类型"的基本工具：`keyof T` 取对象类型所有键组成的联合类型；写在类型位置的 `typeof x` 取一个**值**的类型；索引访问 `T[K]` 取属性的类型，`T[number]` 取数组元素的类型；映射类型 `{ [K in keyof T]: ... }` 遍历键生成新的对象类型，配合 `as` 子句可以重命名或过滤键，再结合**模板字面量类型**能生成 `onClick` 这样的键名。实际项目中常用它们从一份配置推导出所有相关类型，改配置时类型自动跟着变。
:::

## 详细解析

### keyof：取所有键

```ts
interface User { id: number; name: string }
type UserKey = keyof User // 'id' | 'name'

type Dict = { [key: string]: number }
type DictKey = keyof Dict // string | number
```

带字符串索引签名时，`keyof` 得到 `string | number`：JS 中数字键会被转成字符串，`obj[1]` 和 `obj['1']` 访问的是同一个属性。只想要字符串键时，可以写 `string & keyof T`。

### typeof：取值的类型

JS 的 `typeof` 在运行时返回 "string" 这样的字符串；写在**类型位置**时，它是 TS 的类型查询，在编译时得到变量或属性的类型：

```ts
const config = { baseURL: '/api', timeout: 5000 }
type Config = typeof config // { baseURL: string; timeout: number }

function createUser(name: string) {
  return { id: Date.now(), name }
}
type NewUser = ReturnType<typeof createUser> // { id: number; name: string }
```

类型位置的 `typeof` 后面只能跟变量名或属性访问，不能跟函数调用这样的表达式，`typeof createUser('a')` 是不合法的。

### 索引访问：T[K] 和 T[number]

```ts
interface Article { id: number; title: string; tags: ('vue' | 'react')[] }
type Id = Article['id'] // number
type IdOrTitle = Article['id' | 'title'] // string | number
type Tag = Article['tags'][number] // 'vue' | 'react'

// 从常量数组得到联合类型：先 as const 保留字面量，再用 [number] 取元素类型
const SIZES = ['small', 'medium', 'large'] as const
type Size = (typeof SIZES)[number] // 'small' | 'medium' | 'large'
```

`T[K]` 里的 K 必须是类型。`Article[key]`（key 是一个变量）不合法，要写 `Article[typeof key]`。

### 映射类型和 as 子句

映射类型遍历一个联合类型（通常是 `keyof T`）生成新的对象类型，Partial、Readonly 等工具类型都是这样实现的，见 [常用的工具类型](/basics/typescript/04-utility-types)。`as` 子句可以对键重新映射：

```ts
interface User { id: number; name: string; save(): void }

// 改键名：为每个属性生成 getter
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K]
}
type UserGetters = Getters<Pick<User, 'id' | 'name'>> // { getId: () => number; getName: () => string }

// 过滤键：映射成 never 的键会被去掉，这里去掉所有方法
type DataOnly<T> = {
  [K in keyof T as T[K] extends (...args: any[]) => any ? never : K]: T[K]
}
type UserData = DataOnly<User> // { id: number; name: string }
```

写 `string & K` 是因为 keyof 的结果可能包含 number 和 symbol，而 `Capitalize` 只接受字符串类型。

### 模板字面量类型

写法和 JS 的模板字符串一样，只是作用在类型上。插入联合类型时，会展开成所有组合：

```ts
type EventName = `on${Capitalize<'click' | 'focus'>}` // 'onClick' | 'onFocus'
type Position = `${'top' | 'bottom'}-${'left' | 'right'}` // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
```

内置的 `Uppercase`、`Lowercase`、`Capitalize`、`Uncapitalize` 用来转换字符串字面量类型的大小写。

## 代码示例：从配置对象推导类型

表单字段只在一个配置对象里定义，表单值和事件回调的类型都从它推导：

```ts
const fields = {
  name: { label: '姓名', default: '' },
  age: { label: '年龄', default: 0 },
  subscribed: { label: '订阅邮件', default: false },
}

type Fields = typeof fields
type FieldName = keyof Fields // 'name' | 'age' | 'subscribed'

// 每个字段的值类型取自它的 default：{ name: string; age: number; subscribed: boolean }
type FormValues = { [K in FieldName]: Fields[K]['default'] }

// 为每个字段生成 onXxxChange 回调
type FormHandlers = {
  [K in FieldName as `on${Capitalize<K>}Change`]: (value: Fields[K]['default']) => void
}

const handlers: FormHandlers = {
  onNameChange: (value) => console.log(value.trim()), // value 被推导为 string
  onAgeChange: (value) => console.log(value.toFixed(0)), // number
  onSubscribedChange: (value) => console.log(value ? '已订阅' : '未订阅'), // boolean
}
```

给 `fields` 加一个字段，`FormValues` 和 `FormHandlers` 会自动多出对应的属性，`handlers` 漏写回调会直接报错。这里故意没加 `as const`：需要的是 `default` 的宽类型 string、number，而不是字面量类型 `''`、`0`。

## 面试官可能追问

::: details 类型位置的 typeof 和 JS 的 typeof 有什么区别？
写在表达式里时，就是 JS 的 typeof 运算符，运行时返回 "string"、"object" 这样的字符串，TS 也会据此做类型收窄。写在类型位置（类型别名、类型注解里）时，是 TS 的类型查询，编译时得到某个值的类型，编译后被擦除。同一个关键字，含义由出现的位置决定。
:::

::: details 映射类型和索引签名有什么区别？
索引签名 `{ [key: string]: number }` 描述"任意多个字符串键"，具体有哪些键是未知的；映射类型 `{ [K in 'a' | 'b']: number }` 遍历一个确定的联合类型，生成具体的属性 `a` 和 `b`。如果遍历的是 string 这样的非字面量类型，`{ [K in string]: number }` 的结果就等同于索引签名，`Record<string, number>` 就是这种情况。
:::

::: details 模板字面量类型能做什么实际的事？
除了生成事件名、CSS 类名这样的键，还能配合 infer 解析字符串。比如从路由 `'/user/:id/post/:postId'` 中提取出参数名 `'id' | 'postId'`，让 `navigate('/user/:id', { id: '1' })` 这类函数检查参数是否传全。一些路由库和 i18n 库就是这样做类型推导的，原理见 [条件类型和 infer](/basics/typescript/05-conditional-infer)。
:::

## 易错点

- `keyof obj` 不合法（obj 是值），要写 `keyof typeof obj`
- 想从数组得到字面量联合类型，数组要加 `as const`，否则 `(typeof arr)[number]` 只是 string
- 映射类型只能写在 type 里，interface 中不能使用 `[K in ...]` 语法
