---
difficulty: 3
tags: [原理, 性能优化]
---

# 什么是逃逸分析？Go 程序怎么减少内存分配？

::: tip 一句话回答
逃逸分析是**编译器**在编译期判断一个变量能不能放在栈上：如果函数返回后它不会再被引用，就分配在**栈**上，函数返回时自动释放；否则"逃逸"到**堆**上，由 GC 回收。常见的逃逸原因有返回局部变量的指针、赋值给 interface、被闭包捕获、对象太大或大小在运行时才确定。用 `go build -gcflags=-m` 可以看到分析结果。减少分配的手段有**预分配容量**、`strings.Builder`、`sync.Pool` 复用对象、避免不必要的指针，但要先用 `-benchmem` 和 pprof **量化**，确认分配真的是瓶颈再优化。
:::

## 详细解析

### 栈分配和堆分配

| | 栈 | 堆 |
| --- | --- | --- |
| 分配 | 移动一下栈指针，几乎没有成本 | 要走内存分配器，找合适大小的空闲块 |
| 释放 | 函数返回时整块回收 | 由 GC 标记、清扫，占用 CPU |
| 归属 | 每个 goroutine 一个栈，不需要加锁 | 所有 goroutine 共享 |

堆分配本身不算慢，真正的代价在后面：分配越多，GC 越频繁，标记和清扫占的 CPU 越多，分配太快时 goroutine 还要被拉去帮忙标记（见 [Go 的垃圾回收](/basics/go/07-gc)）。所以"减少分配"本质上是在减轻 GC 的负担。

变量分配在哪里由编译器决定，和写法无关：`new(T)`、`&T{}` 不逃逸时也在栈上，普通的局部变量逃逸了也在堆上。Go 不允许堆上的对象指向栈，因为 goroutine 的栈会扩容、整体搬迁，只有栈上的指针会在搬迁时被更新。所以一旦某个指针可能被存到堆上或者在函数返回后被使用，它指向的对象就必须分配在堆上。

### 常见的逃逸场景

```go
// 每个函数演示一种情况，省略了 package 和 import
type Point struct{ X, Y int }

func newPoint() *Point {
	p := Point{1, 2}
	return &p // 1. 返回局部变量的地址：p 逃逸
}

func counter() func() int {
	n := 0
	return func() int { n++; return n } // 2. 闭包捕获了 n，且闭包被返回，n 逃逸
}

func show(p Point) {
	fmt.Println(p.X) // 3. 转成 interface 传给 fmt，编译器无法确定它会被怎么用，通常会逃逸
}

func buffer(n int) []byte {
	return make([]byte, n) // 4. 切片被返回，底层数组逃逸，分配在堆上
}
```

另外，指针被存进全局变量、堆上的对象或者发送到 channel 时，指向的对象会逃逸；对象太大时即使不逃逸也会放到堆上；大小在运行时才确定的 `make` 以前总在堆上，Go 1.25 起不逃逸时会先尝试栈上的一小块缓冲区；通过接口调用方法时，编译器不知道具体实现会不会保存参数，传进去的指针往往也会逃逸。

### 用 -gcflags=-m 看分析结果

`go build -gcflags=-m ./...` 输出每个分配点的结论，`-gcflags='-m -m'` 会给出详细的推理过程。常见的几种说法：

| 输出 | 含义 |
| --- | --- |
| `moved to heap: p` | 变量 p 分配在堆上 |
| `... escapes to heap` | 这个值要在堆上分配，常见于转成 interface、取地址的表达式 |
| `... does not escape` | 没有逃逸，可以留在栈上 |
| `leaking param: p` | 参数 p 被带出了函数（返回或存起来），调用方传进来的对象可能因此逃逸 |
| `inlining call to f` | f 被内联到调用方，之后在调用方的上下文里重新分析，结果可能和单独分析 f 时不同：返回指针的小函数被内联后，对象可能留在调用方的栈上 |

### 减少分配的常用手段

- **预分配容量**：已知大致数量时 `make([]T, 0, n)`、`make(map[K]V, n)`，避免扩容时反复分配和拷贝（扩容规则见 [slice 的扩容机制](/basics/go/03-slice)）
- **拼接字符串用 strings.Builder**，能估算长度时先 `Grow`；数字转字符串写进已有的 `[]byte` 可以用 `strconv.AppendInt` 这类 Append 函数
- **避免不必要的指针**：小结构体直接按值传递、按值返回，往往比返回指针更快；大量小对象用 `[]T` 而不是 `[]*T`，对象数量和 GC 要扫描的指针都更少
- **sync.Pool 复用临时对象**：比如序列化用的 buffer。池里的对象随时可能被 GC 清掉，只能当缓存用；取出后先 Reset，放回后不再使用；示例见 [Go 的垃圾回收](/basics/go/07-gc)
- **减少 string 和 []byte 互转**：每次转换通常都要拷贝。`m[string(b)]` 这种查 map 的写法编译器做了优化，不会分配
- **热点路径少用 fmt**：`fmt.Sprintf` 的参数都要转成 interface，可以改成 strconv 或直接拼接

## 代码示例

用 benchmark 量化两种拼接方式的分配（放在 `join_test.go` 里，`go test -bench=. -benchmem`）：

```go
package join

import (
	"strings"
	"testing"
)

var parts = []string{"go", "escape", "analysis", "heap", "stack"}

func joinPlus(ss []string) string {
	s := ""
	for _, p := range ss {
		s += p + "," // 每次拼接都会生成一个新字符串
	}
	return s
}

func joinBuilder(ss []string) string {
	var b strings.Builder
	b.Grow(64) // 能估算长度时预先分配，避免中途扩容
	for _, p := range ss {
		b.WriteString(p)
		b.WriteByte(',')
	}
	return b.String() // 直接复用内部的字节，不再拷贝
}

func BenchmarkJoinPlus(b *testing.B) {
	for b.Loop() { // Go 1.24 起的写法，旧版本用 for i := 0; i < b.N; i++
		joinPlus(parts)
	}
}

func BenchmarkJoinBuilder(b *testing.B) {
	for b.Loop() {
		joinBuilder(parts)
	}
}
```

结果里的 `allocs/op` 和 `B/op` 是每次操作的分配次数和字节数，joinBuilder 的分配次数会明显少于 joinPlus。具体数值和机器、Go 版本有关，以自己跑出来的为准；对比优化前后时多跑几次，用 benchstat 判断差异是否显著。线上服务要先用 pprof 的 alloc_space 找到真正的分配热点，见 [pprof 怎么用](/basics/go/15-pprof)。

## 面试官可能追问

::: details 返回指针一定比返回值更省吗？
不一定。返回指针往往意味着对象逃逸到堆上，多一次堆分配，还增加了 GC 的工作；返回值只是一次拷贝，小结构体的拷贝非常便宜。只有结构体很大、或者需要共享和修改同一个对象时，指针才更合适。拿不准就写 benchmark 比较。
:::

::: details goroutine 的栈不够用了怎么办？
goroutine 的栈初始只有 2KB 左右，函数调用时会检查剩余空间，不够就分配一块两倍大的新栈，把旧栈的内容整体拷贝过去，并更新栈上的指针。这也是堆上不能有指向栈的指针的原因：搬迁时只会更新栈内部的指针。栈的上限在 64 位系统上默认是 1GB，无限递归会触发 `stack overflow`，这是 fatal error，recover 捕获不了。
:::

::: details sync.Pool 有什么使用限制？
池里的对象可能在任何一次 GC 后被清理，不能用来做连接池或者保存状态。放进池里的最好是指针类型，放值类型会在转成 interface 时又产生一次分配。大小差异很大的对象（比如偶尔用到的超大 buffer）放回去之前要判断一下，超过阈值就丢弃，否则池子会一直占着大块内存。
:::

## 易错点

- 以为 `new` 或 `&T{}` 就一定在堆上、局部变量一定在栈上，实际由逃逸分析决定
- 不看数据就改写代码，为了消除一次逃逸把代码改得难以维护，收益却测不出来
- 用 `go build -gcflags=-m` 只看被调用函数本身，忽略了内联后调用点的结果
- 从 sync.Pool 取出对象不 Reset，或者放回池里之后还在使用它
