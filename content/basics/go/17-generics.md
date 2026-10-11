---
difficulty: 2
tags: [高频, 原理, 新特性]
---

# Go 泛型怎么用？有哪些限制？

::: tip 一句话回答
Go 1.18 引入了泛型：函数和类型可以声明**类型参数**，每个类型参数要有一个**约束**，约束就是一个接口，规定了类型实参必须满足的类型集合和能用的操作，常用的有 `any`、`comparable`、`cmp.Ordered`，也可以用 `~int | ~float64` 这样的类型集自定义。调用时编译器多数情况能**自动推断**类型实参。限制主要有：不支持特化、不能通过类型参数访问结构体字段、接口方法不能有类型参数；Go 1.27 之前方法也不能声明自己的类型参数。泛型适合写与具体类型无关的**容器和算法**，需要按行为抽象时仍然用 interface。
:::

## 详细解析

### 类型参数和约束

- 类型参数写在方括号里：`func Map[T, R any](xs []T, f func(T) R) []R`，类型 `type Cache[K comparable, V any] struct{...}`
- 约束是接口，但可以包含**类型元素**：`interface{ ~int | ~int64 | ~float64 }` 表示类型集合是"底层类型为 int、int64 或 float64 的所有类型"
- `~T` 表示底层类型是 T 的所有类型，比如 `type Celsius float64` 满足 `~float64`，不满足 `float64`
- 内置约束：`any` 不限制类型，只能做赋值、传参这类操作；`comparable` 允许 `==` 和 `!=`，map 的 key 类型参数必须满足它；标准库的 `cmp.Ordered`（Go 1.21 起）允许 `<`、`>`，可以配合内置的 `min`、`max`
- 带类型元素的接口只能当约束用，不能用来声明变量，比如 `var x interface{ ~int }` 编译不过

### 类型推断

调用泛型函数时，编译器根据参数推断类型实参，`Sum([]int{1, 2})` 不用写成 `Sum[int](...)`。没有参数可以参考时要显式写，比如 `NewCache[string, int]()`。推断能力在逐步增强：Go 1.21 起可以把泛型函数直接作为参数传给另一个泛型函数，或者赋值给函数类型的变量，Go 1.27 又推广到所有涉及函数的赋值场景。旧版本推断不出来时，补上类型实参就行。

### 限制

| 限制 | 说明和替代写法 |
| --- | --- |
| 不支持特化 | 不能为某个具体类型单独写一份实现；确实需要时在函数里 `switch any(v).(type)` 分支处理 |
| 只能用约束允许的操作 | 约束是 `any` 就不能写 `a < b` 或 `a + b`；方法也只能调用约束接口里声明过的 |
| 不能访问字段 | 即使类型集合里所有类型都有字段 `Name`，也不能写 `v.Name`，要在约束里声明 `GetName()` 方法 |
| 方法的类型参数 | Go 1.27 之前，方法不能声明自己的类型参数，只能用接收者上的；Go 1.27 起支持泛型方法，但接口的方法仍然不能有类型参数，泛型方法也不能用来实现接口方法 |
| 不能嵌入类型参数 | 结构体里不能把类型参数作为匿名字段 |

### 实现方式：GC shape stenciling

编译器不是为每个类型实参都生成一份代码（C++ 模板的做法），也不是像 Java 那样擦除成 Object。标准编译器把类型按 **shape**（大小、指针布局等底层特征）分组，同一个 shape 的类型实参共用一份代码，比如所有指针类型共享一个 shape，具体的类型信息通过一个隐藏的字典参数传入。官方 FAQ 说明这是编译器的实现选择，未来版本可能调整。这也意味着泛型代码不一定比手写的具体类型代码快，热点路径要用 benchmark 验证。

### 什么时候用泛型，什么时候用 interface

- **用泛型**：代码对类型没有要求，只是"装着"或"搬运"它，比如容器（缓存、集合、队列）、切片和 map 的通用算法、并发工具；用 interface 写这些代码，要靠 any 加类型断言，丢了编译期检查
- **用 interface**：不同类型有不同的**行为**，调用方只关心行为，比如 `io.Reader`、业务里的 `Repository`。这时 interface 更直接，也不会让签名里到处是方括号
- 先写具体类型的代码，出现第二、第三份几乎一样的实现时再提取泛型，不要一开始就为了"通用"而泛型化

标准库已经提供了常用的泛型函数，能直接用就不要自己写：`slices` 包（`Contains`、`Index`、`Sort`、`Max`、`BinarySearch` 等）和 `maps` 包从 Go 1.21 进入标准库；Go 1.23 起配合迭代器，`slices.Sorted(maps.Keys(m))` 一行就能得到排好序的 key。

## 代码示例

```go
package main

import (
	"cmp"
	"fmt"
	"slices"
	"sync"
)

type Number interface { // 自定义约束：底层类型是这几种之一的类型都满足
	~int | ~int64 | ~float64
}

func Sum[T Number](xs []T) T {
	var total T // T 的零值
	for _, x := range xs {
		total += x // 约束里的类型都支持 +，所以可以用
	}
	return total
}

func Map[T, R any](xs []T, f func(T) R) []R {
	out := make([]R, 0, len(xs))
	for _, x := range xs {
		out = append(out, f(x))
	}
	return out
}

func Clamp[T cmp.Ordered](v, lo, hi T) T {
	return min(max(v, lo), hi) // cmp.Ordered 支持比较，可以用内置的 min、max
}

// Cache 是泛型类型：K 要能做 map 的 key，V 不限
type Cache[K comparable, V any] struct {
	mu sync.RWMutex
	m  map[K]V
}

func NewCache[K comparable, V any]() *Cache[K, V] {
	return &Cache[K, V]{m: make(map[K]V)}
}

func (c *Cache[K, V]) Get(key K) (V, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	v, ok := c.m[key]
	return v, ok
}

func (c *Cache[K, V]) Set(key K, val V) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.m[key] = val
}

type Celsius float64

func main() {
	fmt.Println(Sum([]int{1, 2, 3}))        // 6：T 推断为 int
	fmt.Println(Sum([]Celsius{36.5, 37.5})) // 74：~float64 允许自定义类型
	strs := Map([]int{1, 2, 3}, func(n int) string { return fmt.Sprint(n * 10) })
	fmt.Println(strs, slices.Contains(strs, "20")) // [10 20 30] true
	fmt.Println(Clamp(15, 0, 10))                  // 10

	c := NewCache[string, int]() // 没有参数可供推断，要显式写类型实参
	c.Set("a", 1)
	fmt.Println(c.Get("a")) // 1 true
}
```

## 面试官可能追问

::: details 为什么 Go 很长时间不支持方法上的类型参数？
难点在接口。Go 运行时要能判断一个值是否实现了某个接口，如果方法可以有类型参数，`Nop[T any]` 这样的方法理论上有无数种实例，编译期无法全部生成，运行时动态生成又代价很大。Go 1.27 加入的泛型方法绕开了这个问题：接口方法不能有类型参数，泛型方法也不参与接口实现，它只是让泛型函数可以挂在类型的命名空间下。
:::

::: details comparable 和 cmp.Ordered 有什么区别？
`comparable` 只保证能用 `==` 和 `!=`，结构体、数组、指针、接口都可以满足，用来做 map 的 key 或去重；`cmp.Ordered` 要求能用 `<` 等排序比较，只包含整数、浮点数和字符串这些有序类型（以及底层类型是它们的类型）。注意接口类型也能满足 comparable，但如果接口里装的是 slice 这类不可比较的值，比较时会在运行时 panic。
:::

::: details 和 TypeScript 的泛型有什么不同？
TS 的泛型只存在于编译期，编译成 JS 后被完全擦除，类型系统是结构化的，还有条件类型、infer 这类类型层面的运算（见 [TS 泛型](/basics/typescript/03-generics)）。Go 的泛型会影响生成的代码，约束用类型集合描述，功能刻意做得很少，不支持类型层面的编程。
:::

## 易错点

- `[T int]` 和 `[T ~int]` 不一样：前者只接受 int 本身，自定义的 `type ID int` 传不进去，写通用库时一般用 `~`
- 泛型类型的零值要用 `var zero T` 得到，不能写 `return nil`（T 可能是 int）
- 不要把能用接口表达的行为抽象改写成泛型，比如参数是 `io.Reader` 就够了，写成 `[R io.Reader]` 只会让签名更复杂
