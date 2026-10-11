---
difficulty: 2
tags: [高频, 实践, 场景题]
---

# Go 常见的并发模式有哪些？怎么控制并发数？

::: tip 一句话回答
常见的有 **worker pool**（固定数量的 goroutine 从任务 channel 里取活）、**pipeline**（多个阶段用 channel 串起来，每个阶段一组 goroutine）、**fan-out/fan-in**（一个输入分给多个 goroutine 处理，再把结果合并到一个 channel）。控制并发数可以用**带缓冲的 channel 当信号量**、`x/sync/semaphore` 或 `errgroup.SetLimit`；控制的是每秒请求数时用 `x/time/rate` 的令牌桶限流；同一个 key 的重复请求用 **singleflight** 合并。无论哪种模式，都要想清楚 goroutine 怎么退出、出错和取消时怎么停下来。
:::

## 详细解析

### worker pool、pipeline、fan-out/fan-in

- **worker pool**：启动 N 个 worker，`for job := range jobs` 消费任务，生产者发完后关闭 jobs，worker 全部退出后由协调者关闭 results。并发数就是 N，goroutine 数量固定，适合长期运行的消费者（如消费 MQ）。channel 的关闭规则见 [channel 的底层原理](/basics/go/02-channel)
- **pipeline**：比如"读取 → 解析 → 写库"三个阶段，每个阶段是一个函数，接收上游的 `<-chan`，返回自己的 `<-chan`，在自己的 goroutine 里处理完数据后关闭输出 channel。上游关闭会逐级传递到下游，整条流水线自然结束
- **fan-out/fan-in**：某个阶段慢，就让多个 goroutine 同时读同一个输入 channel（fan-out），再用一个 WaitGroup 等它们都结束，把各自的输出合并到一个 channel 并关闭（fan-in）。worker pool 其实就是 fan-out + fan-in

这些模式最容易出问题的地方是**退出**：下游提前返回（出错、超时）后，上游还在往 channel 里发，就会永远阻塞，形成 [goroutine 泄漏](/basics/go/09-goroutine-leak)。所以每个发送都要写成 `select { case out <- v: case <-ctx.Done(): return }`。

### 控制并发数

| 方式 | 写法 | 适合 |
| --- | --- | --- |
| 带缓冲 channel | `sem := make(chan struct{}, 10)`，开始前 `sem <- struct{}{}`，结束后 `<-sem` | 最简单，不需要第三方包 |
| `semaphore.Weighted` | `Acquire(ctx, n)` / `Release(n)` | 每个任务占用的"份额"不同（如按内存大小），或者等待时要能被 ctx 取消 |
| `errgroup` + `SetLimit` | `g.SetLimit(10)` 后 `g.Go(...)`，满了 Go 会阻塞 | 一组任务，要收集第一个错误并取消其余任务，见 [并发同步手段](/basics/go/08-sync-context) |
| worker pool | 固定 N 个 goroutine | 任务源源不断，或者 worker 需要持有连接等资源 |

### 限流：控制速率而不是并发数

并发数限制的是"同时有多少个在跑"，限流限制的是"每秒最多发多少个"。调用有 QPS 配额的第三方接口时，用 `golang.org/x/time/rate` 的令牌桶。`Wait` 拿不到令牌就等，ctx 取消或预计等待超过 deadline 时返回错误；不想等时用 `Allow()`，拿不到直接返回 false，适合服务端丢弃超额请求。它只在单个进程内生效，多实例部署时的全局限流要借助 Redis 等，见 [限流](/basics/redis/10-rate-limit)：

```go
lim := rate.NewLimiter(rate.Limit(100), 20) // 每秒补充 100 个令牌，桶容量 20（允许的突发量）
if err := lim.Wait(ctx); err != nil {
	return err
}
```

### singleflight：合并重复请求

热点 key 的缓存过期时，大量请求同时发现缓存未命中，一起去查数据库，这就是缓存击穿（见 [缓存穿透、击穿、雪崩](/basics/redis/01-cache-problems)）。`golang.org/x/sync/singleflight` 保证同一个 key 同一时刻只有一个函数调用在执行，其他调用方等待并共享它的结果。它只在单个进程内合并，多个实例之间仍然各查一次。

## 代码示例

```go
// 带取消的 worker pool：生产者和 worker 都监听 ctx，任何一方提前退出都不会让别人永远阻塞
package main

import (
	"context"
	"fmt"
	"sync"
	"time"
)

func workerPool(ctx context.Context, jobs <-chan int, workers int) <-chan int {
	results := make(chan int)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := range jobs { // jobs 关闭后退出
				select {
				case results <- n * n:
				case <-ctx.Done():
					return // 消费方不再接收，及时退出
				}
			}
		}()
	}
	go func() {
		wg.Wait()
		close(results) // 所有 worker 都退出后关闭，消费方的 range 才能结束
	}()
	return results
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	jobs := make(chan int)
	go func() {
		defer close(jobs) // 唯一的发送方负责关闭
		for i := 1; i <= 10; i++ {
			select {
			case jobs <- i:
			case <-ctx.Done():
				return
			}
		}
	}()
	sum := 0
	for r := range workerPool(ctx, jobs, 3) {
		sum += r
	}
	fmt.Println("sum:", sum) // sum: 385
}
```

```go
// 用 singleflight 包装缓存未命中后的查库，queryDB 是实际查数据库的函数
var group singleflight.Group // 来自 golang.org/x/sync/singleflight，零值可用

func getUser(ctx context.Context, id string) (string, error) {
	// 同一个 key 同一时刻只有一个调用真正执行 queryDB，其余调用方等待并共享结果
	v, err, _ := group.Do("user:"+id, func() (any, error) {
		return queryDB(ctx, id)
	})
	if err != nil {
		return "", err
	}
	return v.(string), nil
}
```

100 个 goroutine 同时调用 `getUser(ctx, "42")`，queryDB 通常只执行一次，Do 的第三个返回值 shared 表示结果是否同时给了多个调用方。注意闭包用的是第一个调用方的 ctx，它被取消时，共享结果的其他调用方也会拿到取消错误。

## 面试官可能追问

::: details singleflight 有什么坑？
第一，共享的是同一个结果，第一个调用出错，等待的调用方全部拿到这个错误；查询卡住，所有人一起卡住。可以用 `DoChan` 配合 select 给调用方加超时，必要时用 `Forget(key)` 让后续请求重新发起。第二，返回的值被多个调用方共享，如果是指针或 slice，任何一方修改都会影响其他人，要当成只读。
:::

::: details pipeline 中某个阶段出错，怎么让整条流水线停下来？
用 `errgroup.WithContext` 启动各个阶段，每个阶段的收发都 select 监听这个 ctx。任何一个阶段返回错误，errgroup 取消 ctx，其他阶段随之退出，最外层的 `g.Wait()` 拿到第一个错误。不要只靠关闭 channel 传递"结束"，那只能表达正常结束，表达不了出错和取消。
:::

::: details 并发数设多少合适？
看瓶颈在哪里。CPU 密集的任务，设成 `runtime.GOMAXPROCS(0)` 左右，再多也只是增加调度开销；I/O 密集的任务（调接口、查库），上限通常取决于下游能承受的并发，比如数据库连接池大小、第三方接口的配额。最终靠压测确定，并且做成可配置的。
:::

## 易错点

- 只给 worker 加了 ctx 退出，生产者却还在无条件 `jobs <- i`：worker 退出后生产者永远阻塞，同样是泄漏
- 信号量的 `sem <- struct{}{}` 写在 goroutine 里面：goroutine 照样全部创建出来，只是卡在里面，限制不了 goroutine 的数量
- 把限流和限并发混为一谈：`rate.Limiter` 控制每秒的请求数，单个请求很慢时，同时在跑的请求数仍可能很大，两者经常要一起用
