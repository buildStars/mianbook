---
difficulty: 2
tags: [高频, 原理, 输出题]
---

# interface 的底层是怎样的？为什么值为 nil 的接口不等于 nil？

::: tip 一句话回答
接口值在运行时由两部分组成：**动态类型**和**指向实际数据的指针**。空接口 `any` 用 eface 表示（类型 + 数据），带方法的接口用 iface 表示（itab + 数据），itab 里存着具体类型和方法表，调用接口方法时查表跳转。接口只有在类型和数据**都为空**时才等于 nil：把一个值为 nil 的指针（比如 `*MyError` 类型的 nil）赋给 error，类型部分已经有值了，和 nil 比较的结果就是 false，这是返回 error 时最常见的坑。
:::

## 详细解析

### 隐式实现

- Go 没有 `implements` 关键字，一个类型只要拥有接口要求的全部方法，就自动实现了这个接口
- 接口可以由**使用方**定义：需要什么能力，就声明一个只包含这些方法的小接口，不用改动被使用的类型。标准库的 `io.Reader`、`io.Writer` 都只有一个方法，再组合成 `io.ReadWriter`
- 想在编译期确认某个类型实现了接口，可以写 `var _ io.Writer = (*MyWriter)(nil)`
- 和 TypeScript 的[结构化类型](/basics/typescript/07-structural-typing)很像，都是"有这些方法就算"。区别是 TS 的类型在编译后被擦除，Go 的接口值在运行时还带着类型信息，可以做类型断言

### 底层结构

```go
// 运行时中的定义（简化），较新的版本中类型名和字段名有调整
type eface struct { // 空接口 any
	_type *_type         // 动态类型
	data  unsafe.Pointer // 指向实际的值
}

type iface struct { // 带方法的接口
	tab  *itab
	data unsafe.Pointer
}

type itab struct {
	inter *interfacetype // 接口类型
	_type *_type         // 具体类型
	hash  uint32         // 具体类型的哈希，type switch 时用来快速比较
	fun   [1]uintptr     // 方法表：具体类型实现的方法地址，实际长度可变
}
```

- 调用接口方法时，从 itab 的方法表里找到函数地址再调用；同一对"接口类型 + 具体类型"的 itab 只生成一次，之后从全局缓存中取
- 把一个非指针的值赋给接口时，通常会复制一份，data 指向这份副本，所以接口里存的是副本
- 空接口 `any`（Go 1.18 引入的 `interface{}` 的别名）能装任何值，但用它就放弃了编译期的类型检查，取值时要断言；能用具体接口或泛型表达的地方尽量不用 any

### 为什么值为 nil 的接口不等于 nil

```go
package main

import "fmt"

type MyError struct{ Msg string }

func (e *MyError) Error() string { return e.Msg }

func validate(ok bool) error {
	var err *MyError // *MyError 类型的 nil 指针
	if !ok {
		err = &MyError{Msg: "invalid"}
	}
	return err // ❌ 转成 error 接口后：类型是 *MyError，数据指针是 nil
}

func main() {
	err := validate(true)
	fmt.Println(err == nil) // false
	fmt.Printf("%T\n", err) // *main.MyError
	fmt.Println(err)        // <nil>
}
```

接口和 nil 比较时，要求类型和数据都为空。`validate` 返回时，`*MyError` 类型的 nil 被装进了 error 接口，类型部分不再为空，所以 `err == nil` 是 false，调用方会把成功当成失败。打印出来却是 `<nil>`：fmt 调用 `Error()` 时对 nil 指针取字段触发了 panic，fmt 捕获后输出 `<nil>`，排查时非常迷惑。正确写法是成功时直接返回 nil 字面量，返回类型也声明为 error 而不是具体类型：

```go
func validate(ok bool) error {
	if !ok {
		return &MyError{Msg: "invalid"}
	}
	return nil // ✅ 类型和数据都为空的接口
}
```

### 类型断言和 type switch

类型断言 `v, ok := x.(T)` 检查接口里的动态类型是不是 T，失败时 v 是零值、ok 为 false；不带 ok 的 `x.(T)` 失败会直接 panic，报 `interface conversion: interface {} is string, not int` 这样的错误。要按多种类型分别处理时用 type switch：

```go
func describe(x any) string {
	switch v := x.(type) {
	case nil:
		return "nil"
	case int, int64:
		return fmt.Sprintf("整数 %v", v) // 列出多个类型时，v 仍然是 any
	case string:
		return fmt.Sprintf("字符串，长度 %d", len(v)) // 只有一个类型时，v 就是 string
	case error:
		return "错误：" + v.Error()
	default:
		return fmt.Sprintf("其他类型 %T", v)
	}
}
```

### 值接收者和指针接收者

```go
type Speaker interface{ Speak() string }

type Dog struct{ Name string }

func (d *Dog) Speak() string { return d.Name + ": woof" } // 指针接收者

var _ Speaker = &Dog{Name: "Lucky"} // ✅
// var _ Speaker = Dog{Name: "Lucky"} // ❌ 编译错误：Dog does not implement Speaker (method Speak has pointer receiver)
```

规则是：方法用值接收者时，`Dog` 和 `*Dog` 都实现了接口；用指针接收者时，只有 `*Dog` 实现了接口。原因是接口里存的是值的副本，这个副本不可寻址，编译器没法取它的地址去调用指针方法；就算能取，方法修改的也只是副本，和调用者的预期不一致。普通变量能直接写 `d.Speak()` 调用指针方法，是因为变量可寻址，编译器自动改写成了 `(&d).Speak()`，这只是语法糖，不影响接口实现的判断。

## 面试官可能追问

::: details 怎么判断接口里装的是不是 nil 指针？
可以用反射：先确认 `reflect.ValueOf(x).Kind()` 是指针、map、slice 等可以为 nil 的种类，再调用 `IsNil()`，对其他种类调用 `IsNil()` 会 panic。但这只是补救手段，更好的做法是从源头避免：返回接口类型的函数，不要把具体类型的 nil 指针作为返回值。
:::

::: details 类型断言和类型转换有什么区别？
类型转换 `T(x)` 在编译期检查是否合法，要求两种类型可以互相转换，比如 `float64(n)`、`[]byte(s)`。类型断言 `x.(T)` 只能用在接口值上，在运行时检查接口里的动态类型是不是 T（T 是接口时检查是否实现了 T），失败时返回 false 或者 panic。
:::

::: details 接口调用有性能开销吗？
有一点：方法通过 itab 间接调用，编译器通常无法内联；把值装进接口时，值可能逃逸到堆上，产生额外的内存分配。大多数业务代码可以忽略，只有在调用极其频繁的热点路径上才值得优化，比如改用具体类型或泛型。
:::

## 易错点

- 返回 error 的函数，不要用具体类型的变量承接错误再返回，否则成功时也会返回一个非 nil 的接口
- 比较两个接口值时，如果动态类型相同但不可比较（如 slice、map），运行时会 panic
- 接口里存的是副本：把结构体赋给接口后再修改原变量，接口里的值不会跟着变
