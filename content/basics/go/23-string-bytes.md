---
difficulty: 2
tags: [原理, 性能优化]
---

# Go 的 string 底层是什么？string 和 []byte 转换有什么开销？

::: tip 一句话回答
`string` 底层是一个**指向字节数组的指针加长度**，共 16 字节（64 位平台），内容**只读**。`[]byte` 多一个容量字段，内容可写。两者互相转换时，为了保证 string 不被修改，一般都要**分配内存并拷贝**；编译器在能确定不会出问题的场景（比如 `m[string(b)]` 查 map、`string(b) == "x"` 比较）会省掉拷贝。确实需要零拷贝时可以用 `unsafe.String` 和 `unsafe.StringData`，但要自己保证之后不再修改数据。
:::

## 详细解析

### 底层结构

```go
// 运行时里的结构，示意
type stringStruct struct {
	str unsafe.Pointer // 指向底层字节
	len int
}

type slice struct {
	array unsafe.Pointer
	len   int
	cap   int
}
```

string 的字节可能在只读数据段（字面量）或堆上，Go 不允许通过 string 修改它们，`s[0] = 'a'` 编译不过。所以 string 可以安全地共享：赋值、传参、切片 `s[1:3]` 都只复制 16 字节的头部，不复制内容。

### 转换为什么要拷贝

`[]byte(s)` 得到的切片是可写的，如果和 s 共用底层数组，改切片就会改掉"不可变"的字符串；`string(b)` 之后 b 还可能被修改，同样会破坏 string。所以默认两个方向都分配新内存再拷贝，数据大或在热路径上频繁转换时，会产生明显的分配和 GC 压力。新分配的内存在堆上还是栈上由逃逸分析决定，见 [逃逸分析](/basics/go/16-escape-analysis)。

### 编译器免拷贝的场景

编译器能证明转换结果只是临时用一下、不会被保存或修改时，会直接复用原来的字节。常见的有下面几种（不止这些，具体以编译器实现为准）：

- 用 `[]byte` 查 map：`m[string(b)]`
- 比较：`string(b) == "ok"`
- 拼接时的临时转换：`"a" + string(b) + "c"`（只省中间那一步）
- `for i, c := range []byte(s)`

### 零拷贝转换

`unsafe` 包提供了 `unsafe.String(ptr, len)`、`unsafe.StringData(s)`、`unsafe.Slice(ptr, len)`、`unsafe.SliceData(b)` 这几个函数。`strings.Builder` 的 `String()` 方法就是用这种方式避免最后一次拷贝的。代价是失去编译器保护：转换后再修改 `[]byte`，string 的内容也跟着变；把字面量转出来的 `[]byte` 写一下，可能直接崩溃。只在性能热点、且能确保数据不再修改时使用。

### rune 和 UTF-8

string 存的是 UTF-8 字节，不是字符：

- `len(s)` 返回字节数，`utf8.RuneCountInString(s)` 返回字符数
- `s[i]` 取到的是一个 `byte`，`s[i:j]` 按字节切，可能把一个汉字切断
- `for i, r := range s` 按 rune 解码遍历，`i` 是该字符起始的字节下标
- 要按字符下标操作，转成 `[]rune`（同样会分配和拷贝）

## 代码示例

```go
package main

import (
	"fmt"
	"unicode/utf8"
	"unsafe"
)

func main() {
	s := "Go语言"
	fmt.Println(len(s), utf8.RuneCountInString(s)) // 8 4

	for i, r := range s {
		fmt.Print(i, ":", string(r), " ") // 0:G 1:o 2:语 5:言
	}
	fmt.Println()
	fmt.Println(s[2], s[2:5]) // 232 语

	b := []byte(s) // 拷贝了一份，改 b 不影响 s
	b[0] = 'g'
	fmt.Println(s, string(b)) // Go语言 go语言

	// 零拷贝：之后不能再修改 b2
	b2 := []byte("hello")
	s2 := unsafe.String(unsafe.SliceData(b2), len(b2))
	fmt.Println(s2, unsafe.Sizeof(s2)) // hello 16
}
```

## 面试官可能追问

::: details 大量拼接字符串用什么？
用 `strings.Builder`，内部是一个 `[]byte`，按需扩容，最后 `String()` 零拷贝返回；能预估长度时先 `Grow(n)`。循环里用 `+=` 每次都会分配新字符串并拷贝全部内容，总体是 O(n²)。少量拼接用 `+` 或 `fmt.Sprintf` 就行。
:::

::: details 对大字符串取一小段子串，会有什么问题？
`s[a:b]` 和原字符串共用底层字节，只要子串还活着，整个大字符串就不能被回收。从一个很大的响应里截一小段长期保存时，可以用 `strings.Clone(sub)` 复制出独立的一份。`[]byte` 切片也有同样的问题，见 [slice 的底层结构](/basics/go/03-slice)。
:::

::: details 非法的 UTF-8 字节用 for range 遍历会怎样？
不会 panic。遇到无法解码的字节，range 返回 `utf8.RuneError`（U+FFFD），并且只前进 1 个字节。需要校验时用 `utf8.ValidString`。
:::

## 易错点

- `len("语")` 是 3 不是 1；按 `s[i]` 遍历中文字符串取到的是字节
- `string(65)` 得到的是 `"A"`，不是 `"65"`，数字转字符串用 `strconv.Itoa`；`go vet` 会对这种写法给出警告
- 用 unsafe 零拷贝转换后又修改了 `[]byte`，会让本该不可变的 string 内容变化，map 的 key 也可能因此错乱
