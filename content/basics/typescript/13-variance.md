---
difficulty: 3
tags: [原理]
---

# 协变和逆变是什么？函数类型的兼容性是怎么判断的？

::: tip 一句话回答
变型描述的是"类型 A 和 B 的子类型关系，经过某个类型构造后会怎样"。`Dog` 是 `Animal` 的子类型，如果 `F<Dog>` 也能赋值给 `F<Animal>`，就是**协变**（方向不变）；反过来 `F<Animal>` 能赋值给 `F<Dog>`，就是**逆变**（方向反转）。函数的**返回值是协变**的，**参数是逆变**的：能处理任何 Animal 的函数，当然能顶替只处理 Dog 的函数。开启 `strictFunctionTypes` 后，函数类型的参数按逆变检查，但**方法声明的参数仍是双变**的，这是为了让 `Array<T>` 等类型保持协变。数组本身也按协变处理，这在写操作上是不安全的。
:::

## 详细解析

### 子类型和变型

```ts
interface Animal { name: string }
interface Dog extends Animal { bark(): void }
interface Cat extends Animal { meow(): void }
```

`Dog` 拥有 `Animal` 要求的所有成员，所以 `Dog` 是 `Animal` 的子类型，能出现在需要 `Animal` 的地方（结构化类型的规则见 [结构化类型](/basics/typescript/07-structural-typing)）。变型讨论的是把它们放进其他类型之后，关系是否保持：

| 变型 | 含义 | TS 中的例子 |
| --- | --- | --- |
| 协变 | `F<Dog>` 能赋值给 `F<Animal>` | 函数返回值、只读属性、`Promise<T>`、数组 |
| 逆变 | `F<Animal>` 能赋值给 `F<Dog>` | 函数类型的参数（strictFunctionTypes 下） |
| 双变 | 两个方向都允许 | 方法声明的参数 |
| 不变 | 两个方向都不允许 | 既读又写 T 的类型，如 `(x: T) => T` |

### 返回值协变，参数逆变

```ts
interface Animal { name: string }
interface Dog extends Animal { bark(): void }

// 返回值：要一个返回 Animal 的函数，给它返回 Dog 的完全没问题
let getAnimal: () => Animal = () => ({ name: 'a' })
const getDog: () => Dog = () => ({ name: 'd', bark() {} })
getAnimal = getDog // ✅ 协变

// 参数：方向反过来
let handleDog: (d: Dog) => void = (d) => d.bark()
let handleAnimal: (a: Animal) => void = (a) => console.log(a.name)
handleDog = handleAnimal // ✅ 只会收到 Dog，而处理 Animal 的函数能处理任何 Dog
// @ts-expect-error ❌ 调用方可能传入 Cat，handleDog 里会调用不存在的 bark
handleAnimal = handleDog
```

判断方法是站在**调用方**的角度：调用方按目标类型传参、用返回值。传进来的参数必须是新函数能处理的（所以新函数的参数要更宽），返回出去的值必须满足调用方的预期（所以新函数的返回值要更窄）。

### 方法声明为什么是双变

`strictFunctionTypes`（包含在 strict 中）只对**函数类型**生效，用方法语法声明的成员仍按双变检查：

```ts
interface Animal { name: string }
interface Dog extends Animal { bark(): void }

interface MethodStyle { handle(a: Animal): void } // 方法语法
interface PropStyle { handle: (a: Animal) => void } // 属性语法

const dogHandler = { handle: (d: Dog) => d.bark() }
const m: MethodStyle = dogHandler // 不报错：方法参数双变
// @ts-expect-error 报错：属性语法按逆变检查
const p: PropStyle = dogHandler
```

原因在 `Array<T>` 这样的泛型类型上：`push(...items: T[])` 让 T 出现在参数位置，如果方法也严格逆变，`Dog[]` 就不能赋值给 `Animal[]`，大量现有代码会报错。TS 选择对方法放宽，让这些类型保持"大体协变"。想严格检查回调参数，类型里要用属性语法。

### 数组协变的不安全

```ts
interface Animal { name: string }
interface Dog extends Animal { bark(): void }
interface Cat extends Animal { meow(): void }

const dogs: Dog[] = [{ name: 'd', bark() {} }]
const animals: Animal[] = dogs // 允许：数组按协变处理
const cat: Cat = { name: 'c', meow() {} }
animals.push(cat) // 编译通过，但 dogs 里混进了一只猫
dogs[1].bark() // 运行时 TypeError
```

可变对象的属性也一样：`{ pet: Dog }` 能赋值给 `{ pet: Animal }`，之后再把 `pet` 改成 Cat。严格来说既读又写的位置应该是不变的，TS 为了易用性按协变处理。函数参数如果只读不写，可以声明成 `readonly Animal[]`，表达"不会往里写"。

### 变型注解 in / out

TS 4.7 起可以显式标注类型参数的变型：`out T` 协变、`in T` 逆变、`in out T` 不变。TS 平时会自动推断变型，官方文档说几乎不需要手写，只在深度递归的类型上用来提升检查速度和准确性；标注和实际结构明显矛盾时会报错，但它不能用来"强制"改变检查规则。

## 面试官可能追问

::: details 为什么参数少的函数能赋值给参数多的函数类型？
这是另一条规则，和变型无关：调用方多传的参数会被忽略，所以少接收是安全的，`arr.map((x) => x * 2)` 能只写一个参数就靠它。详见 [结构化类型](/basics/typescript/07-structural-typing)。变型管的是对应位置上参数的类型。
:::

::: details 怎么让团队代码里的方法参数也严格检查？
用属性语法声明函数成员：`onChange: (value: string) => void`。typescript-eslint 的 `method-signature-style` 规则可以强制这种写法。宽松与否看的是**目标类型**的声明方式：接口用属性语法声明时，类即使用方法去实现，参数也按逆变检查。
:::

::: details 逆变在类型编程里有什么用？
条件类型里，同一个 infer 变量出现在多个逆变位置（函数参数）时，推断结果是这些候选的**交叉类型**。`UnionToIntersection` 就是先把联合类型的每个成员放进函数参数，再用 infer 推断，得到交叉类型，见 [手写类型体操](/basics/typescript/17-type-gymnastics)。
:::

## 易错点

- 不要把"参数逆变"记成"参数类型可以更窄"，恰好相反：替代者的参数要更宽
- strictFunctionTypes 只管函数类型，方法语法声明的成员仍是双变
- 数组和可变属性按协变处理不代表安全，往"父类型数组"里写入可能破坏原数组
