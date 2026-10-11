---
difficulty: 2
tags: [原理, 对比]
---

# TypeScript 装饰器是什么？新旧两套装饰器有什么区别？

::: tip 一句话回答
装饰器本质上是一个**函数**，写成 `@xxx` 放在类、方法、访问器、字段前面，在**类定义时**被调用，拿到被装饰的目标，可以返回一个替换品来增强它。TS 里有两套互不兼容的实现：开启 `experimentalDecorators` 的**旧版装饰器**，签名是 `(target, key, descriptor)`，支持**参数装饰器**，配合 `emitDecoratorMetadata` 能输出类型元数据，NestJS、TypeORM 等框架依赖这一套；TS 5.0 起默认支持的 **ECMAScript 标准装饰器**，签名是 `(value, context)`，没有参数装饰器，也不支持 `emitDecoratorMetadata`。新项目不依赖这类框架时用标准装饰器。
:::

## 详细解析

### 装饰器在什么时候执行

```text
class 定义被求值
  → 按顺序求值各个 @ 后面的表达式（如 @log、@retry(3)）
  → 调用装饰器函数，传入被装饰的方法、字段或类
  → 用返回值替换原来的成员（如果有返回值）
之后每次调用方法，执行的是替换后的函数
```

装饰器函数本身只在类定义时执行一次，不是每次调用方法都执行。`@retry(3)` 这种带参数的写法，是先调用 `retry(3)` 得到真正的装饰器，也叫装饰器工厂。多个装饰器叠加时，从下往上应用，离成员最近的最先包装，顺序的细节见 [装饰器模式](/basics/design-pattern/06-decorator)。

### 两套装饰器的区别

| | 旧版（`experimentalDecorators`） | 标准装饰器（TS 5.0 起） |
| --- | --- | --- |
| 怎么启用 | tsconfig 开启 `experimentalDecorators` | 不开启该选项时默认使用 |
| 方法装饰器的参数 | `(target, propertyKey, descriptor)` | `(value, context)`，value 就是方法本身 |
| 修改方式 | 改写 `descriptor.value` 或返回新的描述符 | 返回一个新函数替换原方法 |
| 参数装饰器 | 支持，如 `constructor(@Inject(TOKEN) x)` | 不支持 |
| 类型元数据 | 配合 `emitDecoratorMetadata` 输出参数类型等 | 不支持 `emitDecoratorMetadata` |
| 字段装饰器 | 拿不到初始值 | 可以返回函数，加工字段的初始值 |
| 来源 | 早期的装饰器提案，TS 自己的实现 | 新版 TC39 装饰器提案 |

两套的类型检查和编译产物都不同，写给旧版的装饰器函数基本不能直接用在新版上，同一个项目只能选一套。

### 为什么框架还在用旧版

NestJS 的依赖注入靠的是旧版的两个能力：

- **参数装饰器**：`constructor(@Inject('CONFIG') config)` 给构造函数参数打标记
- **emitDecoratorMetadata**：编译时把构造函数参数的类型写成 `design:paramtypes` 元数据，框架运行时用 `reflect-metadata` 读出来，知道该注入哪个类

标准装饰器暂时没有这两样能力，所以这类框架的项目要开启 `experimentalDecorators` 和 `emitDecoratorMetadata`。NestJS 的依赖注入怎么用见 [NestJS 的依赖注入](/basics/node/14-nestjs)。

### 运行时支持

装饰器会被编译成真实的运行时代码（上面的替换过程），实际项目里一般由 TS 或 Babel 编译后再运行，不要假定目标环境能直接执行 `@` 语法。Node.js 内置的类型剥离只删除类型，它的文档明确说明遇到装饰器会报语法错误。

## 代码示例：日志装饰器的两种写法

标准装饰器：

```ts
function log<This, Args extends unknown[], Return>(
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) {
  const name = String(context.name)
  // 返回的新函数会替换原方法
  return function (this: This, ...args: Args): Return {
    console.log(`调用 ${name}`, args)
    return target.call(this, ...args)
  }
}

class OrderService {
  @log
  create(id: number) {
    return { id }
  }
}

new OrderService().create(1) // 输出：调用 create [ 1 ]
```

旧版装饰器（tsconfig 需开启 `experimentalDecorators`）：

```ts
function log(target: object, propertyKey: string, descriptor: PropertyDescriptor) {
  const original = descriptor.value
  // 改写描述符的 value，替换原方法
  descriptor.value = function (this: unknown, ...args: unknown[]) {
    console.log(`调用 ${propertyKey}`, args)
    return original.apply(this, args)
  }
}

class OrderService {
  @log
  create(id: number) {
    return { id }
  }
}

new OrderService().create(1) // 输出同上
```

## 面试官可能追问

::: details 标准装饰器的 context 里有什么？
包括 `kind`（`'method'`、`'field'`、`'class'` 等）、`name`、`static`、`private`、`access`（读写该成员的方法），以及 `addInitializer`。`addInitializer` 注册的函数会在构造实例时执行（静态成员则在类初始化时），常用来做自动绑定 this：在里面执行 `this[context.name] = this[context.name].bind(this)`。TS 5.2 起还有 `context.metadata`，用来在装饰器之间共享元数据。
:::

::: details 旧版的 emitDecoratorMetadata 到底输出了什么？
对被装饰的成员，编译器额外生成 `design:type`、`design:paramtypes`、`design:returntype` 这几项元数据，值是运行时的构造函数，比如 `[UserRepository, ConfigService]`。只有 class 这类在运行时存在的值能被记录，interface 编译后不存在，会退化成 `Object`，所以 NestJS 里注入接口要用字符串或 symbol 作为 token。
:::

::: details 装饰器和高阶函数有什么区别？
思想一样，都是在不改原函数的前提下包一层。高阶函数作用于独立的函数，随时可以调用；装饰器是语法，只能用在类和类成员上，在类定义时自动应用。函数式的写法见 [装饰器模式](/basics/design-pattern/06-decorator)。
:::

## 易错点

- 装饰器函数在类定义时执行，不是每次调用方法时执行；每次调用执行的是它返回的新函数
- 开不开 `experimentalDecorators` 决定了整个项目用哪一套，两套的装饰器函数不能混用
- 标准装饰器没有参数装饰器，依赖参数注入的框架不能直接切换
- 装饰器不是纯类型语法，会生成运行时代码，只做类型剥离的工具不支持
