---
difficulty: 2
tags: [实践, 对比]
---

# 函数重载怎么写？和联合类型、泛型怎么选？

::: tip 一句话回答
TS 的重载是**多个重载签名 + 一个实现签名**：重载签名描述对外的几种调用方式，实现签名写真正的函数体，**实现签名对调用方不可见**。调用时按声明顺序**从上到下匹配第一个**符合的签名，所以更具体的签名要放在前面。官方建议**能用联合类型或泛型表达时，优先用它们**；重载适合"参数个数或组合不同"、"返回类型随参数类型变化"这类联合类型说不清的情况。
:::

## 详细解析

### 基本写法

```ts
// 重载签名：只有声明，没有函数体
function formatTime(date: Date): string
function formatTime(timestamp: number, unit: 'ms' | 's'): string
// 实现签名：要能兼容上面所有重载
function formatTime(value: Date | number, unit: 'ms' | 's' = 'ms'): string {
  const date = value instanceof Date ? value : new Date(unit === 's' ? value * 1000 : value)
  return date.toISOString()
}

formatTime(new Date())
formatTime(1700000000, 's')
// @ts-expect-error 没有"只传 number"的重载，实现签名对外不可见
formatTime(1700000000)
```

- 实现签名不算作一个可调用的重载。上例的实现允许只传 number，但调用方看不到它
- 每个重载签名都必须能被实现签名兼容，否则报"此重载签名与其实现签名不兼容"
- 函数体里只能按实现签名的类型写代码，要自己收窄、自己保证各个重载的返回值正确，TS 不会逐个重载检查

### 匹配顺序：具体的放前面

```ts
function describe(value: unknown): string
function describe(value: string): 'text'
function describe(value: unknown): string {
  return typeof value === 'string' ? 'text' : 'other'
}

const r = describe('hi') // string：第一个签名就匹配上了，第二个永远用不到
```

把 `(value: string): 'text'` 移到前面，`describe('hi')` 才会得到 `'text'`。宽泛的签名（unknown、any、可选参数多的）放在最后。

### 能用联合类型就别用重载

```ts
function len(s: string): number
function len(arr: unknown[]): number
function len(x: string | unknown[]): number {
  return x.length
}

declare const input: string | number[]
// @ts-expect-error 联合类型的实参匹配不上任何一个重载
len(input)

// 改成联合类型参数：更短，还能接收联合类型的实参
const len2 = (x: string | unknown[]): number => x.length
len2(input)
```

重载按单个签名逐一匹配，不会把联合类型拆开分别匹配。返回类型相同、只是参数类型不同时，联合类型参数更简单。

### 返回类型依赖参数时：重载或泛型

```ts
// 写法一：重载，每种输入对应一种输出
function parse(input: string): number
function parse(input: string[]): number[]
function parse(input: string | string[]): number | number[] {
  return Array.isArray(input) ? input.map(Number) : Number(input)
}
const a = parse('1') // number
const b = parse(['1', '2']) // number[]

// 写法二：泛型 + 映射表，适合"键 → 类型"的对应关系
interface EventMap { click: MouseEvent; keydown: KeyboardEvent }
function on<K extends keyof EventMap>(type: K, handler: (e: EventMap[K]) => void) {
  window.addEventListener(type, handler as (e: Event) => void)
}
on('keydown', (e) => console.log(e.key)) // e 是 KeyboardEvent
```

对应关系只有两三种时用重载最直观；对应关系是一张表、或者会继续扩展时，用泛型加索引访问更好维护，DOM 的 `addEventListener`、`createElement` 的类型就是这样写的。也可以用条件类型 `T extends string ? number : number[]` 表达返回值，但函数体里返回时通常要断言。

### 方法重载和构造函数重载

```ts
class Color {
  private rgb: [number, number, number]
  constructor(hex: string)
  constructor(r: number, g: number, b: number)
  constructor(a: string | number, g = 0, b = 0) {
    const n = typeof a === 'string' ? parseInt(a.slice(1), 16) : 0
    this.rgb = typeof a === 'string' ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [a, g, b]
  }

  get(format: 'rgb'): [number, number, number]
  get(format: 'css'): string
  get(format: 'rgb' | 'css') {
    return format === 'rgb' ? this.rgb : `rgb(${this.rgb.join(', ')})`
  }
}

const c = new Color('#ff8800')
const rgb = c.get('rgb') // [number, number, number]
const css = c.get('css') // string
```

写法和函数一样。`get` 的返回类型随参数变化，用联合类型参数表达不了，正适合重载。接口和类型别名里可以写多个调用签名来表达重载，比如 `interface Fn { (x: string): number; (x: number): string }`。

## 面试官可能追问

::: details 对重载函数用 ReturnType、Parameters 会得到什么？
对有多个签名的函数做条件类型推断时，TS 只取**最后一个**签名。`ReturnType<typeof parse>` 得到的是 `number[]`，不是 `number | number[]`。需要所有签名时，只能自己写工具类型逐个匹配，或者把重载改成泛型。
:::

::: details 箭头函数能重载吗？
箭头函数不能写多个签名，但可以先定义一个带多个调用签名的类型，再把箭头函数赋给它。函数实现要同时兼容所有签名，通常写不出来，最后往往要加断言，所以需要重载时一般直接用 function 声明。
:::

::: details 重载会影响运行时吗？
不会。重载签名在编译后全部删除，只剩实现函数。运行时根据参数做分支是实现自己的事，重载只是告诉调用方"可以这样调用，会得到这样的结果"。
:::

## 易错点

- 实现签名不对外暴露，不要以为它是最后一个"兜底"重载
- 宽泛的签名放在前面会把后面的具体签名"吃掉"
- 重载不会把联合类型的实参拆开匹配，需要时再加一个接收联合类型的重载，或者干脆改成联合类型参数
