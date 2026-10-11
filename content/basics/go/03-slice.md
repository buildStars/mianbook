---
difficulty: 2
tags: [高频, 原理, 输出题]
---

# slice 的底层结构是什么？扩容机制是怎样的？

::: tip 一句话回答
slice 是一个只有三个字段的结构体：指向底层数组的**指针**、长度 **len** 和容量 **cap**。多个 slice 可以共享同一个底层数组，修改元素会互相影响；append 时容量够用就原地写入，不够就**扩容**：分配更大的新数组、把数据复制过去，之后新旧 slice 不再共享。扩容时小切片容量**翻倍**，超过阈值后增长逐渐**放缓**，最后还要按内存分配的规格**向上取整**。
:::

## 详细解析

### 底层结构

```go
// 运行时源码 runtime/slice.go
type slice struct {
	array unsafe.Pointer // 指向底层数组
	len   int            // 当前元素个数
	cap   int            // 从 array 开始到底层数组末尾能容纳的元素个数
}
```

- `s[i:j]` 不复制数据，新 slice 指向原数组的第 i 个元素，len 是 j - i，cap 是原 cap - i
- slice 赋值和传参只复制这三个字段（64 位系统上是 24 字节），不复制底层数组；数组才是值类型，`[3]int` 和 `[4]int` 是不同的类型，赋值时会复制整个数组
- 类比 JS：`s[1:3]` 像 TypedArray 的 `subarray()`，和原数组共享内存，而不是像 `Array.prototype.slice()` 那样复制一份

### 共享底层数组：一道输出题

```go
package main

import "fmt"

func main() {
	a := []int{1, 2, 3, 4, 5}
	b := a[1:3]       // [2 3]，len 2，cap 4
	b[0] = 20         // 改的是共享数组，a[1] 也变了
	b = append(b, 30) // cap 够用，原地写入，覆盖了 a[3]
	fmt.Println(a, len(b), cap(b))

	b = append(b, 40, 50) // 需要 len 5，超过了 cap 4，扩容
	b[0] = 99             // b 已经指向新数组，不再影响 a
	fmt.Println(a, b)
}
```

输出：

```text
[1 20 3 30 5] 3 4
[1 20 3 30 5] [99 3 30 40 50]
```

- `b` 和 `a` 共享底层数组，`b[0]` 就是 `a[1]`。第一次 append 时 len 为 2、cap 为 4，不需要扩容，30 直接写到了 `a[3]` 的位置。这是最容易踩的坑：对子切片 append 会**悄悄覆盖**原切片后面的元素
- 第二次 append 后长度超过容量，分配了新数组，之后再改 `b` 就影响不到 `a` 了

### 扩容策略

append 发现 `len + 新增个数 > cap` 时，调用运行时的 growslice：

1. **算新容量**：需要的长度超过旧容量的 2 倍，就直接用需要的长度；否则旧容量小于阈值时翻倍，达到阈值后按逐渐减小的比例增长
2. **按内存规格取整**：新容量乘以元素大小得到字节数，向上取整到内存分配器的规格（size class），再反推出最终的 cap
3. **分配并复制**：分配新数组，把旧数据复制过去，返回指向新数组的 slice

阈值和系数随版本调整过：Go 1.18 之前以 1024 为界，之前翻倍、之后每次增长 1.25 倍；Go 1.18 起阈值改为 256，超过后的增长比例从 2 倍平滑过渡到约 1.25 倍。这些是实现细节，面试时讲清"先翻倍、再放缓、最后取整"的思路就够了。取整的例子：向空的 `[]int` 一次 append 5 个元素，需要 40 字节，内存规格里没有 40 字节这一档，实际分配 48 字节，所以 cap 是 6 而不是 5。正因为有取整，cap 很难精确预测；能预估数量时，直接用 `make([]T, 0, n)` 预分配，避免反复扩容。

### make 和 new

| | `new(T)` | `make(T, ...)` |
| --- | --- | --- |
| 适用类型 | 任意类型 | 只能是 slice、map、channel |
| 返回值 | `*T`，指向一块已清零的内存 | `T` 本身，内部结构已经初始化好 |
| 例子 | `p := new(int)`，`*p` 是 0 | `make([]int, 0, 10)`、`make(map[string]int)`、`make(chan int)` |

Go 1.26 起 new 的参数也可以是表达式：`new(123)` 返回一个指向新 int 变量的指针，变量的值是 123。`new(map[string]int)` 得到的是指向 nil map 的指针，往 nil map 写入会 panic；map 和 channel 要用 make（map 也可以用字面量）初始化后才能使用，nil slice 倒是可以直接 append。另外，变量分配在栈上还是堆上，不由 new 或 make 决定，而是由编译器的逃逸分析决定，见 [Go 的垃圾回收](/basics/go/07-gc)。

### 切片作为函数参数

Go 只有值传递，传 slice 时复制的是那三个字段，底层数组是共享的；函数需要改变 slice 的长度时，要像 append 一样把新 slice 返回给调用方：

```go
func modify(s []int) {
	s[0] = 100       // 改的是共享的底层数组，调用方可见
	s = append(s, 4) // 只改变函数内这份 slice 的 len，扩容时还会换成新数组
	s[1] = 200       // 是否影响调用方，取决于上一步有没有扩容
}

func main() {
	s1 := []int{1, 2, 3} // len 3，cap 3
	modify(s1)
	fmt.Println(s1) // [100 2 3]：append 时扩容了，s[1] = 200 改的是新数组

	s2 := make([]int, 3, 10) // len 3，cap 10
	modify(s2)
	fmt.Println(s2, s2[:4]) // [100 200 0] [100 200 0 4]：没扩容，4 写进了数组，但 s2 的 len 还是 3
}
```

### 大数组上取小切片

只要还有一个小切片引用着大数组，整个大数组都无法被 GC 回收。比如读了一个几百 MB 的文件，只返回 `data[:16]`，整个文件的内容就会一直留在内存里：

```go
func readHeader(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	n := min(16, len(data))
	header := make([]byte, n)
	copy(header, data) // ✅ 复制到一个小数组，大数组之后就能被回收
	return header, nil
}
```

`slices.Clone(data[:n])`（Go 1.21 起）效果相同。从大字符串截取子串也有同样的问题，可以用 `strings.Clone`（Go 1.18 起）。

## 面试官可能追问

::: details nil 切片和空切片有什么区别？
`var s []int` 是 nil 切片，指针为 nil；`[]int{}` 和 `make([]int, 0)` 是空切片，指针不为 nil。两者的 len 和 cap 都是 0，都能直接 append 和遍历，区别在于 `s == nil` 的结果，以及用 encoding/json 序列化时 nil 切片输出 `null`、空切片输出 `[]`。判断切片是否为空应该用 `len(s) == 0`。
:::

::: details 怎样让 append 不影响原切片？
用三下标切片限制容量：`b := a[1:3:3]` 的 cap 是 3 - 1 = 2，再 append 就必须分配新数组，不会覆盖 `a` 后面的元素。也可以直接复制一份：`slices.Clone(a[1:3])`。
:::

::: details 用 for range 遍历切片时修改元素，为什么不生效？
`for i, v := range s` 中的 v 是元素的副本，修改 v 不影响切片，要写成 `s[i] = ...`；元素是结构体时也一样，要用 `s[i].Field = ...`。另外，range 在开始时就确定了遍历的次数，循环中 append 的新元素不会被遍历到。
:::

## 易错点

- `append` 的返回值必须接收：`s = append(s, x)`，不接收会编译报错
- `make([]int, 5)` 的 len 是 5，再 append 会追加到第 6 个位置，前 5 个都是 0；只想预留容量要写 `make([]int, 0, 5)`
- 子切片的 cap 一直延伸到底层数组末尾，对它 append 可能覆盖原切片的数据
- 多个 goroutine 同时 append 同一个切片会互相覆盖、丢失数据，要加锁，或者预先分配好长度、每个 goroutine 只写自己的下标
