---
difficulty: 2
tags: [高频, 输出题]
---

# defer、panic、recover 的执行机制是怎样的？

::: tip 一句话回答
defer 把函数调用推迟到外层函数**返回前**执行，多个 defer **后进先出**，参数在 defer 语句执行时就已经**求值**。`return` 不是原子操作：先给返回值赋值，再执行 defer，最后才真正返回，所以 defer 能修改**命名返回值**。panic 发生后会沿调用栈逐层执行 defer，只有在 defer 的函数里**直接调用** recover 才能截住它；recover 只对当前 goroutine 有效，子 goroutine 里没被截住的 panic 会让整个进程退出。
:::

## 详细解析

### defer 的规则：一道输出题

```go
package main

import "fmt"

func a() (result int) {
	defer func() { result *= 2 }()
	return 3 // 先把 3 赋给 result，再执行 defer
}

func b() int {
	x := 3
	defer func() { x *= 2 }()
	return x // 返回值没有名字，return 时已经把 x 的值复制出去了
}

func main() {
	x := 1
	defer fmt.Println("defer 1:", x)              // 参数现在就求值
	defer func() { fmt.Println("defer 2:", x) }() // 闭包，执行时才读取 x
	x = 2
	fmt.Println(a(), b())
}
```

输出：

```text
6 3
defer 2: 2
defer 1: 1
```

- **后进先出**：main 里后注册的 defer 2 先执行
- **参数立即求值**：`defer fmt.Println("defer 1:", x)` 注册时 x 是 1，之后 x 改成 2 也不影响；而闭包引用的是变量本身，执行时读到的是 2
- **可以修改命名返回值**：`return 3` 分三步执行：给返回值赋值（result = 3）→ 按后进先出执行 defer（result 变成 6）→ 带着返回值回到调用方。`b` 的返回值没有名字，第一步已经把 x 的值 3 复制到了返回值里，defer 再修改局部变量 x，也影响不到已经复制出去的值

### panic 和 recover

panic 发生后，当前函数停止执行，先运行它的 defer，再逐层返回到调用方，依次运行每一层的 defer。如果某个 defer 函数中直接调用了 recover，panic 就停止传播，recover 返回 panic 的值，这个 defer 所在的函数正常返回；一直没有被 recover，程序打印 panic 信息和调用栈后以退出码 2 退出。recover 有几个限制：

- 必须在 defer 的函数中**直接调用**才有效。在普通代码里调用，或者在 defer 函数又调用的另一个函数里调用，都只会返回 nil
- 没有发生 panic 时 recover 返回 nil；Go 1.21 起 `panic(nil)` 会被转换成 `*runtime.PanicNilError`，recover 不会再返回 nil，可以和"没有 panic"区分开

常见用法是在边界处把 panic 转换成 error：

```go
func safeDivide(a, b int) (res int, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("recovered: %v", r) // 通过命名返回值把 panic 转成 error
		}
	}()
	return a / b, nil
}

// safeDivide(1, 0) 返回 0 和 "recovered: runtime error: integer divide by zero"
```

### 子 goroutine 的 panic

recover 只能捕获**同一个 goroutine** 里的 panic。子 goroutine 中没被截住的 panic 会直接让整个进程退出，main 里写再多 recover 也没用。这和 Node.js 里未捕获的异常会让进程退出类似（见 [Node.js 服务怎么处理异常](/basics/node/07-error-handling)），但 Go 没有 `process.on('uncaughtException')` 这样的全局兜底。net/http 会 recover 请求处理函数里的 panic，但处理函数里再启动的 goroutine 不在保护范围内。所以启动 goroutine 时，要在它的入口自己 recover：

```go
func safeGo(fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				// 记录 panic 的值和堆栈，进程不会退出
				log.Printf("goroutine panic: %v\n%s", r, debug.Stack())
			}
		}()
		fn()
	}()
}
```

### 循环中的 defer

defer 在函数返回时才执行，而不是在每轮循环结束时。另外，Go 1.14 起大多数 defer 被编译器直接展开（open-coded defer），开销很小，但循环里的 defer 用不上这个优化。

```go
// ❌ 所有文件都要等外层函数返回才关闭，文件一多就会耗尽文件描述符
for _, p := range paths {
	f, err := os.Open(p)
	if err != nil {
		return err
	}
	defer f.Close()
	// 处理 f……
}

// ✅ 把每轮的逻辑放进单独的函数，在里面 Open 并 defer Close，每次调用结束文件就关闭
for _, p := range paths {
	if err := processFile(p); err != nil {
		return err
	}
}
```

### panic 和 error 的边界

- **error**：可以预料的失败，调用方应该处理，比如文件不存在、网络超时、参数校验不通过，详见 [Go 的错误处理](/basics/go/10-error-handling)
- **panic**：程序有 bug 或者处于无法继续运行的状态，比如数组越界、空指针、走到了"不可能"的分支、启动时缺少必需的配置。`regexp.MustCompile` 这类 Must 函数通常只用于常量参数（比如初始化包级变量），出错说明代码本身写错了
- 库代码不要让 panic 穿过对外的 API；内部用 panic 简化深层递归的错误传递时（比如解析器），要在入口 recover 并转换成 error

## 面试官可能追问

::: details os.Exit 和 log.Fatal 会执行 defer 吗？
不会。`os.Exit` 立即终止进程，不运行任何 defer；`log.Fatal` 打印日志后调用 `os.Exit(1)`，同样跳过 defer。所以在 main 里调用 `log.Fatal` 时，前面 defer 注册的清理逻辑（关闭连接、刷新缓冲）都不会执行。常见写法是把逻辑放进一个返回 error 的 `run()` 函数，main 根据它的返回值决定退出码。
:::

::: details 哪些错误是 recover 捕获不了的？
运行时的 fatal error 会直接终止程序，不走 panic 流程，比如并发读写 map（见 [map 的底层实现](/basics/go/04-map)）、所有 goroutine 都阻塞导致的死锁、栈溢出、内存耗尽、对未加锁的 Mutex 调用 Unlock。这些都说明程序本身有问题，只能修代码。
:::

::: details recover 之后，程序从哪里继续执行？
不会回到 panic 发生的位置继续执行。执行了 recover 的那个 defer 所在的函数会直接返回给它的调用方，返回值是命名返回值当时的值，没有命名返回值就是零值。所以想在 recover 后返回错误，函数必须使用命名返回值，并在 defer 里给它赋值，就像上面的 safeDivide。
:::

## 易错点

- `defer fmt.Println(time.Since(start))` 打印的耗时接近 0，因为 `time.Since(start)` 在注册时就算好了；要写成 `defer func() { fmt.Println(time.Since(start)) }()`
- recover 只对当前 goroutine 有效，启动 goroutine 时要考虑兜底
- `defer f.Close()` 会忽略 Close 返回的错误；写文件时 Close 可能报告数据没写成功，需要检查它的返回值
