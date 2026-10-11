---
difficulty: 2
tags: [原理, 对比]
---

# 什么是结构化类型？多余属性检查是怎么回事？

::: tip 一句话回答
TS 采用**结构化类型**：判断两个类型是否兼容只看结构，A 具备 B 要求的所有成员，A 就能赋值给 B，和类型叫什么名字、有没有声明继承关系无关，也就是"鸭子类型"。Java、C# 是**名义类型**，必须显式继承或实现才兼容。结构化类型允许多出属性，但把**对象字面量直接**赋值或传参时，TS 会额外做**多余属性检查**，把多出的属性当作拼写错误报出来。需要名义类型的效果时，可以用**品牌类型**（branded type）模拟。
:::

## 详细解析

### 按结构判断兼容

```ts
interface Point {
  x: number
  y: number
}

class Vector3 {
  x = 0
  y = 0
  z = 0
}
const p: Point = new Vector3() // 可以：Vector3 有 x 和 y，多出的 z 不影响

class Cat {
  name = ''
}
class Dog {
  name = ''
}
const pet: Cat = new Dog() // 可以：结构完全相同，在 Java 中这里会编译报错
```

| | 结构化类型（TS） | 名义类型（Java、C#） |
| --- | --- | --- |
| 兼容的依据 | 成员的结构 | 类型名，以及显式声明的继承、实现关系 |
| 结构相同、名字不同 | 兼容 | 不兼容 |
| 优点 | 灵活，贴合 JS 中大量匿名对象的写法 | 能区分结构相同但含义不同的类型 |

TS 这样设计，是因为 JS 代码里到处是对象字面量、匿名对象和鸭子类型的写法（比如只要有 `then` 方法，`await` 就把它当 Promise 处理），结构化类型能直接描述这些已有的写法。

### 多余属性检查

```ts
interface Options {
  color?: string
  width?: number
}

function draw(options: Options) {}

// @ts-expect-error 报错：对象字面量只能指定已知属性，Options 中不存在 colour
draw({ colour: 'red', width: 100 })

const opts = { colour: 'red', width: 100 }
draw(opts) // 不报错：opts 不是直接写在这里的对象字面量
```

**新鲜的**对象字面量直接赋值给变量、作为参数或返回值时，不能有目标类型中不存在的属性。目的是捕获拼写错误：`color` 是可选的，按结构化规则 `{ colour: 'red', width: 100 }` 完全合法（有 width，多出的 colour 不影响），但这几乎一定是 bug。对象字面量一旦赋给中间变量，就不再"新鲜"，回到普通的结构化兼容规则。

确实需要多余属性时，可以：

- 先赋值给中间变量，再传入
- 用类型断言：`draw({ colour: 'red' } as Options)`，不推荐，会把真正的拼写错误也一起放过
- 在类型里加上索引签名 `[key: string]: unknown`，明确表示允许任意额外属性

### 函数的兼容性

参数少的函数可以赋值给参数多的函数类型，反过来不行：

```ts
type Handler = (event: MouseEvent, index: number) => void

const h1: Handler = (event) => console.log(event.clientX) // 可以：用不到的参数不写
// @ts-expect-error 不行：调用方只会传两个参数，第三个参数永远拿不到
const h2: Handler = (event: MouseEvent, index: number, extra: string) => {}

const nums = [1, 2, 3]
nums.forEach((n) => console.log(n)) // forEach 会传 3 个参数，回调只用第 1 个
```

JS 调用函数时多传的参数会被忽略，所以"少接收"是安全的；而函数需要的参数调用方不传，就会出错。数组的 `forEach`、`map` 回调能只写一个参数，靠的就是这条规则。返回值则要求能赋值给目标的返回值类型。

### 品牌类型：模拟名义类型

用户 ID 和订单 ID 都是 string，结构化类型分不清，传错了也不报错。可以给它们加一个只存在于类型层面的"品牌"属性：

```ts
type Brand<T, Name extends string> = T & { readonly __brand: Name }

type UserId = Brand<string, 'UserId'>
type OrderId = Brand<string, 'OrderId'>

// 只通过这类函数创建，可以顺便在这里做格式校验
function toUserId(raw: string): UserId {
  return raw as UserId
}

function getUser(id: UserId) {}

const userId = toUserId('u_1')
const orderId = 'o_1' as OrderId

getUser(userId) // 可以
// @ts-expect-error OrderId 不能赋值给 UserId
getUser(orderId)
// @ts-expect-error 普通字符串也不行
getUser('u_1')
```

`__brand` 属性在运行时并不存在，只是让两个类型的结构不同，没有运行时开销。金额的单位（分和元）、校验过和未校验的数据，都可以用这种方式区分。

## 面试官可能追问

::: details 为什么赋值给中间变量后就不检查多余属性了？
多余属性检查是为了捕获"写字面量时的拼写错误"。直接写的对象字面量只在这一处使用，多出的属性没有任何代码能访问到，基本可以断定是写错了。而一个已有的变量可能在别处被当作更完整的类型使用，多出的属性是有用的，按结构化规则只要求它具备目标需要的成员。
:::

::: details 函数参数的类型是怎么检查的？方法为什么特殊？
开启 `strictFunctionTypes`（包含在 strict 中）后，函数类型的参数是**逆变**检查的：`(e: MouseEvent) => void` 不能赋值给 `(e: Event) => void`，因为调用方可能传入键盘事件。但用方法语法声明的成员（`handle(e: Event): void`）仍按**双变**处理，上面的赋值不会报错，这是为了兼容数组等大量内置类型的方法。想严格检查回调参数，类型里要用属性语法 `handle: (e: Event) => void`。
:::

::: details 类的 private 成员会影响兼容性吗？
会。类里有 private、protected 或 `#` 私有字段时，只有来自同一个声明的成员才算兼容：两个类即使结构完全相同，只要各自声明了私有成员，就不能互相赋值。这让类具备了一定的名义类型特征，也是模拟名义类型的另一种方式。
:::

## 易错点

- 多余属性检查只针对直接使用的对象字面量，不代表"不允许多出属性"
- 属性全部可选的类型（弱类型）比较特殊：赋值的对象至少要有一个同名属性，比如 `const o = { colour: 'red' }` 再 `draw(o)` 也会报错
- `{}` 类型不是"空对象"，而是除 null 和 undefined 以外的任何值，`const x: {} = 1` 是合法的；要表示"任意对象"用 `object`
