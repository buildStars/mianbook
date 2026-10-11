---
difficulty: 2
tags: [对比, 原理]
---

# TypeScript 的 class 有哪些特性？private 和 #private 有什么区别？

::: tip 一句话回答
TS 在 JS 的 class 上加了访问修饰符 `public` / `protected` / `private`、`readonly`、参数属性、`abstract`、`implements` 和 `override`，它们**大多只在编译期检查**，编译后被擦除。`private` 就是这样：只是编译器不让你访问，运行时仍是普通属性，`Object.keys`、`JSON.stringify` 都能看到，用 `obj['x']` 还能绕过检查。`#private` 是 **JS 原生的私有字段**，在运行时真正不可访问。另外要注意 `useDefineForClassFields`：target 为 ES2022 及以上时默认开启，类字段按标准语义初始化，可能覆盖父类构造函数里设置的值。
:::

## 详细解析

### private 和 #private

```ts
class Account {
  private token = 'secret'
  #password = '123456'

  checkPassword(input: string) { return input === this.#password }
}

const acc = new Account()
// @ts-expect-error 编译期报错：token 是私有属性
acc.token
console.log(acc['token']) // 不报错：方括号访问可以绕过 private 检查
console.log(JSON.stringify(acc)) // {"token":"secret"}：运行时就是普通属性
// acc.#password 是语法错误，在类外部写不出来；运行时也拿不到
```

| | `private` | `#private` |
| --- | --- | --- |
| 检查时机 | 只在编译期 | 运行时由 JS 引擎保证 |
| 方括号访问 | `obj['x']` 能绕过 | 不可能访问 |
| `Object.keys`、`JSON.stringify` | 能看到 | 看不到 |
| 子类同名属性 | 冲突，报错 | 互不影响，各是各的 |
| 编译输出 | 普通属性 | target 低于 ES2022 时用 WeakMap 模拟，有额外开销 |

需要真正封装（比如库对外暴露的类，不希望用户依赖内部状态）用 `#`；只是团队内部约定"别从外面访问"，`private` 就够了，调试时也更方便查看。

### readonly 和参数属性

```ts
interface UserRepo { find(id: number): { id: number; name: string } | undefined }

class UserService {
  // 参数属性：在构造函数参数前加修饰符，自动声明并赋值同名属性
  constructor(
    private readonly repo: UserRepo,
    public readonly name = 'user-service',
  ) {}
}
```

参数属性写起来简洁，依赖注入框架里很常见。但它会生成 `this.repo = repo` 这样的运行时代码，不是纯类型语法，Node.js 的类型剥离和 `erasableSyntaxOnly` 选项都不支持它。`readonly` 只在编译期禁止重新赋值，不会冻结对象。

### 抽象类和接口

```ts
abstract class Shape {
  abstract area(): number // 子类必须实现
  describe() { return `面积是 ${this.area().toFixed(2)}` } // 可以有实现，调用抽象方法
}

class Circle extends Shape {
  constructor(private r: number) { super() }
  area() { return Math.PI * this.r ** 2 }
}

// @ts-expect-error 抽象类不能直接实例化
new Shape()
new Circle(1).describe()
```

| | 抽象类 | 接口 |
| --- | --- | --- |
| 运行时 | 是真实的类，存在于编译产物中 | 完全擦除 |
| 能否包含实现 | 能，可以有字段、构造函数、普通方法 | 不能，只描述结构 |
| 使用方式 | `extends`，只能继承一个 | `implements`，可以实现多个 |
| 适用场景 | 子类共享部分实现（模板方法） | 只约定能力，不关心实现 |

### implements 只是检查

`implements` 只检查类是否满足接口，**不会把接口的类型带进类里**，方法参数仍要自己写类型；编译后它也直接消失：

```ts
interface Checkable { check(name: string): boolean }

class NameChecker implements Checkable {
  // @ts-expect-error 参数 s 没有从接口获得类型，隐式 any 报错
  check(s) {
    return s.length > 0
  }
}
```

### override 和 useDefineForClassFields

开启 `noImplicitOverride` 后，重写父类方法必须写 `override`；父类方法改名或删除时，带 `override` 的子类方法会报错，不会悄悄变成一个新方法。

`useDefineForClassFields` 影响类字段的初始化方式。开启后（target 为 ES2022 及以上的默认值）按 JS 标准语义用 `Object.defineProperty` 定义字段，只声明不赋值的字段也会被初始化为 undefined：

```ts
class Base {
  constructor() { this.init() }
  init() {}
}

class Child extends Base {
  value?: string // 标准语义下：父类构造函数执行完后，这里把 value 重新定义为 undefined
  override init() { this.value = 'ready' }
}

console.log(new Child().value) // 开启时是 undefined，关闭时是 'ready'
```

只想声明类型、不产生字段定义时，写成 `declare value?: string`。这个差异常在升级 target 后出现，表现为某些属性"莫名其妙变成了 undefined"。

## 面试官可能追问

::: details private 构造函数有什么用？
外部不能 `new`，只能通过类自己提供的静态方法创建实例，常用于单例和工厂方法，比如 `static create()` 里先做参数校验再调用构造函数。和 private 属性一样，这只是编译期限制。
:::

::: details protected 和 private 的区别？
private 只能在声明它的类内部访问；protected 还允许子类内部访问，但在类外部都不能访问。两者都只是编译期检查。`#private` 没有 protected 的对应物，子类也访问不到父类的 `#` 字段。
:::

::: details 怎么判断一个对象是不是某个类创建的？
常用 `instanceof`，但它看的是原型链，原型可以被改写，跨 iframe 或同一个库被打包了两份时也会误判。有 `#` 字段时可以用 `#field in obj`（ES2022 的私有字段检查，TS 4.5 起支持）：只有经过这个类构造函数的对象才有该字段，结果可靠，TS 也会据此收窄类型。另外，含 private 或 `#` 成员的类在类型兼容上带有名义类型的特征，见 [结构化类型](/basics/typescript/07-structural-typing)。
:::

## 易错点

- `private` 不是安全手段，运行时完全可见，敏感数据要用 `#` 或者根本不放在对象上
- `implements` 不会给方法参数提供类型，参数要自己标注
- 升级 target 到 ES2022 后，只声明不赋值的字段可能覆盖父类构造函数设置的值，用 `declare` 声明
