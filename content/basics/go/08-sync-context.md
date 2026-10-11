---
difficulty: 2
tags: [高频, 实践]
---

# Go 有哪些并发同步手段？Mutex、WaitGroup、Context 怎么用？

::: tip 一句话回答
保护共享数据用 `sync.Mutex` / `sync.RWMutex`，等待一组 goroutine 结束用 `sync.WaitGroup`，只执行一次的初始化用 `sync.Once`，简单的计数器和标志位用 `sync/atomic`；在 goroutine 之间传递数据和信号用 channel。**context** 负责在调用链上传递取消信号、超时时间和请求范围的值：上游取消或超时后，从它派生出的所有 context 都会收到 Done 信号，下游据此尽快退出。并发执行一组任务、遇到第一个错误就取消其余任务，用 **errgroup**。
:::

## 详细解析

### sync 包和原子操作

| 工具 | 用途 | 注意 |
| --- | --- | --- |
| `Mutex` | 互斥锁，保护共享数据 | 不可重入；通常 `defer mu.Unlock()` 保证解锁 |
| `RWMutex` | 读写锁，读多写少时允许多个读者同时持有 | 有写者在等待时，新的读者也会阻塞，所以不能递归加读锁 |
| `WaitGroup` | 等待一组 goroutine 结束 | `Add` 要在启动 goroutine 之前调用；Go 1.25 起可以直接用 `wg.Go(f)` |
| `Once` | 并发安全地只执行一次，如懒加载配置、单例 | f 发生 panic 也算执行过；Go 1.21 起还有 `OnceFunc`、`OnceValue` |
| `atomic` | 计数器、标志位等单个变量的原子读写 | Go 1.19 起有 `atomic.Int64`、`atomic.Bool` 等类型，比函数式的 API 更不容易用错 |

另外还有并发安全的 `sync.Map`，适用场景有限，见 [map 的底层实现](/basics/go/04-map)。下面是 Mutex、WaitGroup 和 atomic 的基本用法（省略了 package 和 import）：

```go
func main() {
	var mu sync.Mutex
	var wg sync.WaitGroup
	var total atomic.Int64 // 来自 sync/atomic
	count := map[string]int{}
	for i := range 100 {
		wg.Add(1) // 在启动 goroutine 之前 Add
		go func() {
			defer wg.Done()
			mu.Lock()
			count[fmt.Sprint(i%2)]++ // map 不是并发安全的，要加锁
			mu.Unlock()
			total.Add(1) // 单个计数器用原子操作就够了
		}()
	}
	wg.Wait()                                         // 等 100 个 goroutine 都调用了 Done
	fmt.Println(count["0"], count["1"], total.Load()) // 50 50 100
}
```

### 用 channel 还是用锁

Go 提倡"不要通过共享内存来通信，而要通过通信来共享内存"，但这不是说锁不好。channel 适合传递数据的所有权（生产者-消费者、流水线）、分发任务、通知事件（完成、退出），见 [channel 的底层原理](/basics/go/02-channel)；锁适合保护一份被多处读写的状态，比如缓存、计数器、结构体的字段。哪种写出来更简单就用哪种，只为了保护一个 map 而绕一圈 channel，代码反而更难懂。

### context：取消、超时和请求范围的值

- 根 context 用 `context.Background()`，还没想好用哪个时先写 `context.TODO()`；派生时，`WithCancel` 返回一个可以手动取消的 context，`WithTimeout` / `WithDeadline` 到时间自动取消，`WithValue` 附带一个键值对
- 取消**向下传播**：父 context 取消后，所有子 context 都会取消，子 context 取消不影响父 context。下游通过 `<-ctx.Done()` 感知取消，`ctx.Err()` 返回 `context.Canceled` 或 `context.DeadlineExceeded`
- 取消是**协作式**的：context 只负责发信号，函数要自己在 select 里监听 `ctx.Done()`，或者把 ctx 传给支持它的 API（如 `http.NewRequestWithContext`、database/sql 的 `QueryContext`）。ctx 取消后，没有检查它的代码会照常执行下去

前端可以类比 AbortController：`cancel()` 相当于 `abort()`，`WithTimeout` 相当于 `AbortSignal.timeout()`，把 ctx 一路往下传，就像把 signal 传给 fetch。区别是 context 能层层派生成一棵树，还能携带请求范围的值。使用 context 有几条约定：

1. 作为函数的**第一个参数**，命名为 ctx：`func GetUser(ctx context.Context, id int64) (*User, error)`
2. **不要存进结构体**，每次调用时显式传入，让它的生命周期跟着请求走，而不是跟着对象走
3. 派生出的 **cancel 一定要调用**，通常紧跟着写 `defer cancel()`，否则在父 context 结束前，子 context 占用的资源（如计时器）不会释放；`go vet` 会检查漏掉的 cancel
4. 不要传 nil；WithValue 只放请求范围的数据（如 trace ID、当前用户），不要用它传可选参数，key 用自定义的未导出类型，避免和其他包冲突

## 代码示例

用 errgroup（`golang.org/x/sync/errgroup`，需要 `go get`）并发执行几个任务，第一个错误会取消其余任务。fetch 模拟一次耗时 cost 的调用，要么完成，要么在 ctx 取消时提前返回：

```go
package main

import (
	"context"
	"fmt"
	"time"

	"golang.org/x/sync/errgroup"
)

func fetch(ctx context.Context, id int, cost time.Duration) error {
	select {
	case <-time.After(cost):
		if id == 1 {
			return fmt.Errorf("fetch %d: upstream error", id)
		}
		fmt.Println("fetch", id, "done")
		return nil
	case <-ctx.Done():
		fmt.Println("fetch", id, "canceled:", ctx.Err())
		return ctx.Err()
	}
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second) // 整体最多 3 秒
	defer cancel()
	g, ctx := errgroup.WithContext(ctx) // 任意一个任务返回错误，这个 ctx 就会被取消
	g.SetLimit(3)                       // 最多同时运行 3 个任务
	costs := []time.Duration{100 * time.Millisecond, 200 * time.Millisecond, 2 * time.Second}
	for i, cost := range costs {
		g.Go(func() error { // Go 1.22 起每轮循环都是新变量，闭包里可以直接用 i 和 cost
			return fetch(ctx, i, cost)
		})
	}
	if err := g.Wait(); err != nil { // 等所有任务结束，返回第一个错误
		fmt.Println("error:", err)
	}
}
```

输出：

```text
fetch 0 done
fetch 2 canceled: context canceled
error: fetch 1: upstream error
```

任务 1 在 200ms 时出错，errgroup 取消了 ctx，原本要跑 2 秒的任务 2 立刻收到信号退出。这和 `Promise.all` 遇到第一个失败就 reject 很像，但 `Promise.all` 不会停止其他请求，errgroup 配合 context 可以真正让它们停下来。

## 面试官可能追问

::: details Mutex 是公平锁吗？
不完全是。Go 1.9 起 Mutex 有两种模式：正常模式下，被唤醒的等待者要和新来的 goroutine 竞争，新来的正在 CPU 上运行，更容易抢到锁，吞吐量更高；某个等待者等了超过 1ms，Mutex 切换到饥饿模式，锁直接按排队顺序交给等待者，新来的不再参与竞争。拿到锁的等待者发现自己是队列里的最后一个，或者自己等待的时间不到 1ms，就切回正常模式。
:::

::: details WaitGroup 的 Add 为什么不能放在 goroutine 里面？
goroutine 可能还没开始运行，主 goroutine 就已经执行到 `Wait`，此时计数还是 0，Wait 直接返回，后面的任务就没等到。所以要在 `go` 语句之前调用 `Add`。另外 Done 的次数比 Add 多会导致计数变成负数，直接 panic。
:::

::: details context.WithValue 是怎么查找值的？
每次 WithValue 都会创建一个新节点，指向父 context，形成一条链。`ctx.Value(key)` 从当前节点开始逐级向上比较 key，找到就返回，到根节点还没找到就返回 nil。所以查找是线性的，层级越深越慢；值也是只读的，不能修改。它只适合放少量请求范围的数据，业务参数应该写在函数签名里。
:::

## 易错点

- 包含 Mutex、WaitGroup 的结构体不能被复制，方法要用指针接收者，否则复制出来的是另一把锁；`go vet` 会检查这类问题
- 持有读锁时不能再加写锁，RWMutex 不支持锁升级，这样写会死锁
- Go 1.22 之前，循环变量在所有迭代中共享，goroutine 里直接使用会读到同一个值，要先写 `i := i` 复制一份；Go 1.22 起每轮都是新变量，类似 JS 中 `for (let ...)` 的效果（见 [闭包](/basics/javascript/02-closure)）
