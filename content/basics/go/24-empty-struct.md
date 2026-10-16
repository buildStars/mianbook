---
difficulty: 2
tags: [原理]
---

# 空结构体 struct{} 有什么用？Go 的结构体内存对齐是怎么回事？

::: tip 一句话回答
`struct{}` **不占内存**，`unsafe.Sizeof` 是 0，所有大小为 0 的变量通常都指向运行时的同一个地址 `zerobase`。它常用来做 **set**（`map[string]struct{}`）、**只传信号的 channel**（`chan struct{}`）和只有方法没有数据的类型。内存对齐是指每个字段的地址必须是它对齐值的整数倍，编译器会在字段之间插入填充字节，所以**字段顺序会影响结构体大小**，把大字段放前面、小字段排在一起通常能变小。
:::

## 详细解析

### 空结构体的三种用法

| 用法 | 写法 | 好处 |
| --- | --- | --- |
| 集合 | `map[string]struct{}` | value 不占空间，语义上也明确"只关心 key" |
| 信号 channel | `chan struct{}` | 只通知不传数据，常配合 `close` 广播 |
| 方法载体 | `type handler struct{}` | 只为实现接口，不需要状态 |

`map[string]bool` 也能做 set，但每个 value 要占 1 字节，而且会出现"key 存在但值是 false"的歧义。`context.Context` 的 `Done()` 返回的就是 `<-chan struct{}`。

### zerobase

大小为 0 的对象不需要真的分配内存，运行时分配 0 字节时直接返回全局变量 `zerobase` 的地址。所以两个空结构体变量的指针可能相等，但 Go 规范明确说这**不保证**，不要依赖它们比较的结果。`[100]struct{}{}` 这样的数组大小也是 0。

### 对齐规则

1. 每种类型有对齐值，用 `unsafe.Alignof` 查看。64 位平台上 `bool`/`int8` 是 1，`int32` 是 4，`int64`、指针、`string` 是 8
2. 每个字段的偏移量必须是它对齐值的整数倍，不满足就在前面填充
3. 结构体的对齐值等于字段中最大的对齐值，总大小要向上补齐到它的整数倍，这样数组里每个元素也是对齐的

为什么要对齐：CPU 按字长读取内存，对齐的数据一次就能读完；不对齐的可能要读两次再拼起来，有些架构甚至直接不支持。另外 64 位原子操作要求地址按 8 字节对齐，在 32 位平台上尤其要注意。

### 调整字段顺序

```text
type Bad struct {        type Good struct {
    a bool  // 0           b int64 // 0~7
    // 填充 7 字节          a bool  // 8
    b int64 // 8~15        c bool  // 9
    c bool  // 16          // 尾部填充 6 字节
    // 尾部填充 7 字节    }
}                        // 大小 16
// 大小 24
```

字段多、实例多的结构体（比如缓存里几百万个对象），按对齐值从大到小排列能省下可观的内存。`golang.org/x/tools` 里的 `fieldalignment` 分析器可以检查这类问题。

### 空结构体作为最后一个字段

空结构体放在结构体**最后**时，编译器会给它补上填充。原因是对最后一个字段取地址时，如果它不占空间，指针就会指向结构体之外的下一块内存，可能让 GC 误以为另一个对象还被引用。放在前面或中间就不会有额外开销。

## 代码示例

```go
package main

import (
	"fmt"
	"unsafe"
)

type Bad struct {
	a bool
	b int64
	c bool
}

type Good struct {
	b int64
	a bool
	c bool
}

type Tail struct {
	n int32
	e struct{} // 放在末尾会被填充
}

func main() {
	fmt.Println(unsafe.Sizeof(struct{}{}))                       // 0
	fmt.Println(unsafe.Sizeof(Bad{}), unsafe.Sizeof(Good{}))     // 24 16
	fmt.Println(unsafe.Offsetof(Bad{}.b), unsafe.Alignof(Bad{}.b)) // 8 8
	fmt.Println(unsafe.Sizeof(Tail{}))                           // 8

	set := map[string]struct{}{}
	set["go"] = struct{}{}
	_, ok := set["go"]
	fmt.Println(ok) // true

	done := make(chan struct{})
	go func() { close(done) }() // close 会唤醒所有等待者
	<-done
	fmt.Println("done")
}
```

## 面试官可能追问

::: details map 的 value 用 struct{}，真的能省内存吗？
能。map 的桶里会给 value 预留空间，value 大小为 0 时这部分空间就没有了。map 底层的实现细节见 [map 的底层实现](/basics/go/04-map)。
:::

::: details 关闭 chan struct{} 和发送一个值做通知有什么区别？
发送一个值只能唤醒一个接收者，关闭 channel 会让所有接收者都立即返回零值，适合广播"停止"信号。关闭只能做一次，重复关闭会 panic，所以通常由唯一的一方负责关闭。
:::

::: details 怎么防止结构体被按值比较或被拷贝？
在结构体里放一个 `_ [0]func()` 字段，因为函数类型不可比较，这个结构体就不能用 `==` 比较，而且长度为 0 不占空间。防拷贝可以嵌入一个实现了 `Lock`/`Unlock` 的空类型（类似 `sync.noCopy`），`go vet` 的 copylocks 检查会报告值拷贝。
:::

## 易错点

- 两个空结构体变量的地址可能相等也可能不等，规范不保证，不要用它做判断
- 空结构体放在结构体末尾会产生填充，不是"任何位置都是 0 字节"
- 对齐值和平台有关，`int`、指针在 32 位平台上是 4 字节，结论不要只按 64 位记
