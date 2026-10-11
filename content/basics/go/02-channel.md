---
difficulty: 2
tags: [高频, 原理]
---

# channel 的底层原理是什么？无缓冲和有缓冲 channel 有什么区别？

::: tip 一句话回答
channel 底层是运行时的 **hchan** 结构体：一个环形缓冲区、发送和接收两个等待队列，再加一把互斥锁，每次收发都在锁的保护下进行。**无缓冲** channel 要求发送方和接收方同时就绪，数据直接从一方交给另一方，是一次同步交接；**有缓冲** channel 只在缓冲区满时阻塞发送、空时阻塞接收。关闭后仍能读完剩余数据，之后读到零值且 `ok` 为 false；向已关闭的 channel 发送、重复关闭都会 panic，对 nil channel 收发会永久阻塞。
:::

## 详细解析

### hchan 结构

`make(chan T, n)` 在堆上创建一个 hchan，channel 变量本质上是指向它的指针，所以传参时不需要再取地址：

```go
type hchan struct { // 运行时源码 runtime/chan.go，省略了部分字段
	qcount   uint           // 缓冲区中现有的元素个数
	dataqsiz uint           // 缓冲区容量，即 make 时的 n
	buf      unsafe.Pointer // 指向环形缓冲区（长度为 n 的数组）
	closed   uint32
	sendx    uint  // 下一次发送写入的下标
	recvx    uint  // 下一次接收读取的下标
	recvq    waitq // 阻塞在接收上的 goroutine 队列，元素叫 sudog，记录 goroutine 和数据地址
	sendq    waitq // 阻塞在发送上的 goroutine 队列
	lock     mutex // 保护上面所有字段
}
```

### 发送和接收的过程

发送 `ch <- v`：

1. 加锁。channel 已关闭就解锁并 panic
2. recvq 里有等待的接收者：把数据**直接拷贝**给它，不经过缓冲区，然后唤醒它
3. 缓冲区没满：数据写入 `buf[sendx]`，sendx 后移
4. 否则把当前 goroutine 包装成 sudog 挂到 sendq，解锁后挂起，等接收方来唤醒。挂起的只是 goroutine，线程会去执行别的 goroutine（见 [GMP 调度模型](/basics/go/01-gmp)）

接收 `v, ok := <-ch` 是对称的：

1. 加锁。已关闭且缓冲区为空，直接返回零值，`ok` 为 false
2. sendq 里有等待的发送者：无缓冲时直接从发送者那里拷贝数据；有缓冲时（这时缓冲区一定是满的）先从缓冲区头部取一个，再把发送者的数据放到队尾，保持先进先出，然后唤醒发送者
3. 缓冲区有数据：从 `buf[recvx]` 读取
4. 否则挂到 recvq 等待

### 无缓冲和有缓冲

| | 无缓冲 `make(chan T)` | 有缓冲 `make(chan T, n)` |
| --- | --- | --- |
| 何时阻塞 | 发送要等接收方把数据取走，接收要等有发送方 | 缓冲区满时阻塞发送，缓冲区空时阻塞接收 |
| 特点 | 同步交接，发送返回时能确定对方已经收到 | 发送方和接收方解耦，可以削峰 |
| 常见用途 | 同步两个 goroutine、通知某件事已完成 | 生产者-消费者、当信号量限制并发数、暂存结果 |

缓冲区满时阻塞发送方，就形成了背压，作用类似 Node.js Stream 用 highWaterMark 实现的背压，只不过 Go 是直接让发送方停下来。缓冲大小只影响解耦程度和性能，不能指望用"足够大的缓冲"掩盖设计上的死锁。

### 关闭规则和各种情况对照

| 操作 | nil channel | 已关闭的 channel | 正常的 channel |
| --- | --- | --- | --- |
| 发送 | 永久阻塞 | panic | 有接收者或缓冲区未满时成功，否则阻塞 |
| 接收 | 永久阻塞 | 先读完缓冲区剩余的数据，之后立即返回零值，`ok` 为 false | 有数据就读，否则阻塞 |
| 关闭 | panic | panic | 成功，唤醒所有等待者：接收者拿到零值，发送者 panic |
| `for range` | 永久阻塞 | 读完剩余数据后退出循环 | 一直读，直到 channel 被关闭 |

**谁来关闭**：

- 由发送方关闭，接收方不要关闭：接收方关了以后，发送方再发送就会 panic
- 有多个发送方时，哪一个都不能擅自关闭。可以等所有发送方结束后由一个协调者关闭（见下面的代码），或者干脆不关闭数据 channel，用单独的退出信号（如 context）通知所有发送方停止
- 关闭是为了告诉接收方"不会再有数据了"，不是为了释放资源。不再被引用的 channel 会被 GC 回收，不需要像文件那样必须关闭

### select

- 同时等待多个 channel 操作，哪个就绪执行哪个；多个同时就绪时**随机**选一个，避免某个 case 饿死
- 有 `default` 时，没有 case 就绪就执行 default，不阻塞，可以实现非阻塞的发送和接收
- 加一个 `case <-time.After(d):` 或 `case <-ctx.Done():` 就能实现超时和取消
- nil channel 的 case 永远不会被选中，可以把变量置为 nil 来动态关掉某个 case；空的 `select {}` 会永久阻塞

## 代码示例

```go
package main

import (
	"fmt"
	"sync"
)

func main() {
	jobs := make(chan int, 10)
	results := make(chan int, 10)
	var wg sync.WaitGroup
	for range 3 { // 3 个 worker，它们都是 results 的发送方
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs { // jobs 关闭并读完后，循环结束
				results <- j * j
			}
		}()
	}

	for i := 1; i <= 5; i++ {
		jobs <- i
	}
	close(jobs) // main 是 jobs 唯一的发送方，发完由它关闭
	go func() { // results 有多个发送方：等它们都结束，再由一个协调者关闭
		wg.Wait()
		close(results)
	}()

	sum := 0
	for r := range results { // results 关闭并读完后，循环结束
		sum += r
	}
	fmt.Println("sum:", sum) // sum: 55
}
```

## 面试官可能追问

::: details 有了 channel，为什么还需要 Mutex？
channel 内部本身就有锁，收发时还可能涉及 goroutine 的挂起和唤醒，开销比单纯加锁大。它擅长在 goroutine 之间传递数据和信号；如果只是保护一个计数器或缓存这样的共享状态，用 Mutex 更简单也更快。怎么选见 [并发同步手段](/basics/go/08-sync-context)。
:::

::: details 怎么判断一个 channel 是否已经关闭？
没有直接的 API。`v, ok := <-ch` 可以通过 ok 判断，但如果 channel 里还有数据，会读走一个值。而且"先检查再发送"本身就有竞态：检查完到发送之间，别的 goroutine 可能已经把它关了。正确的做法是在设计上约定谁来关闭、什么时候关闭，而不是在运行时去探测。
:::

::: details select 中多个 case 同时就绪，能指定优先级吗？
select 本身是随机选择的，不支持优先级。需要优先处理某个 channel（比如退出信号）时，可以先用一个带 default 的 select 单独检查它，没有数据再进入同时监听所有 channel 的 select。
:::

## 易错点

- 关闭后读到的零值和真正发送的零值无法区分，要用 `v, ok := <-ch` 或 `for range` 判断
- 所有 goroutine 都阻塞时运行时会报 `fatal error: all goroutines are asleep - deadlock!`；只要还有 goroutine 在运行，或者在等待网络 I/O、定时器（比如 HTTP 服务），就不会报错，阻塞的 goroutine 会一直卡着，变成 [goroutine 泄漏](/basics/go/09-goroutine-leak)
- 在 `for` 里套 `select` 时，`break` 只会跳出 select，跳不出 for 循环，要用 return 或带标签的 break
