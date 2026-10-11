---
difficulty: 2
tags: [实践, 对比]
---

# enum 有什么问题？有哪些替代写法？

::: tip 一句话回答
enum 是 TS 中少数**会生成运行时代码**的语法，不是单纯的类型标注。主要问题有：**数字枚举**带反向映射，遍历时键会多出一倍，而且仍然能接收任意 `number` 类型的值；**const enum** 要靠跨文件的类型信息才能内联，在 Babel、esbuild 这类单文件转译工具和 `isolatedModules` 下容易出问题；**只做类型擦除的工具**（如 Node.js 直接运行 .ts 文件）不支持 enum。常用的替代是**字符串字面量联合类型**，需要运行时的值时用 **`as const` 对象**，再用 `keyof typeof` 推导出类型。
:::

## 详细解析

### enum 会生成运行时代码

```ts
enum Direction {
  Up,
  Down,
}
```

tsc 编译后：

```js
var Direction;
(function (Direction) {
    Direction[Direction["Up"] = 0] = "Up";
    Direction[Direction["Down"] = 1] = "Down";
})(Direction || (Direction = {}));
// 运行时得到的对象：{ '0': 'Up', '1': 'Down', Up: 0, Down: 1 }
```

数字枚举同时生成了"名字 → 值"和"值 → 名字"两个方向的映射（反向映射），所以 `Direction[0]` 是 `'Up'`。带来的问题：

- `Object.keys(Direction)` 得到 `['0', '1', 'Up', 'Down']`，遍历时要过滤掉数字键
- 大多数 TS 语法编译后会被直接删掉，enum 却会生成对象和函数调用，和"TS 就是 JS 加类型"的直觉不一致

### 类型约束比想象中弱

```ts
enum Status {
  Active = 1,
  Disabled = 2,
}

function parseStatus(code: number) {
  const status: Status = code // 不报错：任何 number 类型的值都能赋给数字枚举
  return status
}
// @ts-expect-error 直接写超出范围的字面量会报错（TS 5.0 起）
const s: Status = 3

enum Theme {
  Light = 'light',
  Dark = 'dark',
}
// @ts-expect-error 字符串枚举只接受枚举成员，不接受同值的字符串
const t: Theme = 'light'
```

字符串枚举没有反向映射，但接口返回的 `'light'` 不能直接当作 `Theme` 使用，要先转换或断言。

### const enum 的问题

`const enum` 不生成对象，编译时把用到它的地方直接替换成值（内联）。问题在于内联需要知道枚举的定义，而定义可能在别的文件里：

- Babel、esbuild、swc 这类工具通常一次只转译一个文件，拿不到其他文件中的类型信息，无法可靠地内联从别处导入的 const enum
- 开启 `isolatedModules`（Vite 等工具链推荐开启）后，TS 会对这类依赖跨文件信息的写法报错，比如引用声明文件中的 const enum
- 库在声明文件里导出 const enum，使用方的编译方式不同，结果可能不一致，TS 官方文档也建议避免

### 只做类型擦除的工具

有些工具只做"类型擦除"：删掉类型标注，不做任何代码转换。Node.js 内置的类型剥离（直接运行 .ts 文件）遇到 enum 会报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。TS 也提供了 `erasableSyntaxOnly` 编译选项，禁止 enum、带运行时代码的 namespace、构造函数的参数属性这类不能直接擦除的语法。

### 替代写法

**字符串字面量联合类型**：只需要类型时首选，编译后什么都不剩：

```ts
type Direction = 'up' | 'down' | 'left' | 'right'

function move(direction: Direction) {}
move('up') // 直接传字符串，有自动补全和检查
```

**as const 对象**：需要在运行时遍历所有值，或者想用有名字的成员时使用：

```ts
const Status = {
  Active: 'active',
  Disabled: 'disabled',
} as const

type Status = (typeof Status)[keyof typeof Status] // 'active' | 'disabled'
type StatusKey = keyof typeof Status // 'Active' | 'Disabled'

function setStatus(status: Status) {}
setStatus(Status.Active) // 可以用"成员"
setStatus('disabled') // 也可以直接用字面量
const all = Object.values(Status) // ('active' | 'disabled')[]，没有反向映射的干扰
```

值和类型可以同名，`Status` 既是对象也是类型，用起来和 enum 很像。`as const` 让属性变成只读并保留字面量类型，不加的话 `Status.Active` 的类型只是 string。`keyof typeof` 的用法见 [keyof 和映射类型](/basics/typescript/09-keyof-mapped)。

### 什么时候 enum 仍然可以用

- 项目一直在用，工具链是 tsc、Babel、esbuild 这类会做代码转换的编译器，普通 enum 没有大问题，不必为了替换而替换
- 位标志：`enum Permission { Read = 1 << 0, Write = 1 << 1 }`，用位运算组合权限
- 确实需要反向映射，比如把协议里的数字码转换成可读的名字打印日志

## 面试官可能追问

::: details 为什么 Object.keys 一个数字枚举会得到双倍的键？
数字枚举编译后会同时写入 `Direction['Up'] = 0` 和 `Direction[0] = 'Up'`，对象上既有名字键，又有数字键。遍历时要过滤：`Object.keys(Direction).filter((k) => isNaN(Number(k)))`。字符串枚举没有反向映射，不存在这个问题。
:::

::: details as const 做了什么？
它是"常量断言"：对象和数组的属性都变成 readonly，字面量不再被拓宽，`'active'` 保持字面量类型而不是 string，数组变成只读元组。它只影响类型，不会冻结对象，运行时仍然可以修改，需要时再配合 `Object.freeze`。
:::

::: details 联合类型和 as const 对象怎么选？
只在类型层面约束取值时用联合类型，最简单，没有运行时代码。需要在运行时拿到所有可选值（比如渲染下拉框、校验输入），或者希望用 `Status.Active` 这种有名字的写法、方便统一修改值时，用 as const 对象。只需要一个值列表时，也可以写 `const ROLES = ['admin', 'user'] as const`，再用 `(typeof ROLES)[number]` 得到类型。
:::

## 易错点

- 字符串枚举不能用同值的字符串字面量赋值，接口数据要先转换
- 数字枚举仍然能接收任意 number 类型的值，类型保护比想象中弱
- `keyof typeof Obj` 得到的是键的联合，`(typeof Obj)[keyof typeof Obj]` 才是值的联合
