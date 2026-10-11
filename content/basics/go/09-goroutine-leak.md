---
difficulty: 2
tags: [实践, 场景题]
---

# 什么是 goroutine 泄漏？怎么排查和避免？

::: tip 一句话回答
goroutine 阻塞在 channel、锁或网络调用上，或者陷在没有退出条件的循环里，**永远无法结束**，就是 goroutine 泄漏。GC 不会回收还没结束的 goroutine，它的栈和栈上引用的对象会一直占着内存，数量越积越多，最终拖垮服务。排查时先看 `runtime.NumGoroutine()` 的趋势，再用 **pprof** 的 goroutine profile 找到大量堆积在同一行代码的调用栈；避免的关键是启动每个 goroutine 时都想清楚**它在什么条件下退出**：用 context 控制生命周期、给可能阻塞的操作加超时、让结果 channel 有足够的缓冲。
:::

## 详细解析

### 常见原因

| 原因 | 典型场景 |
| --- | --- |
| 向没人接收的 channel 发送 | 调用方超时后提前返回，后台 goroutine 还在往无缓冲 channel 里发结果 |
| 从没人发送、也不会关闭的 channel 接收 | worker 用 `for range` 读任务，生产者结束时忘了 close |
| 没有退出条件的循环 | 后台定时任务 `for { ...; time.Sleep(time.Minute) }`，服务关闭或调用方不再需要时也停不下来 |
| 忘记取消 context，或者根本没设超时 | 下游接口卡住，请求没有超时，goroutine 一直等 |
| 锁没释放、资源没关闭 | 异常分支忘了 Unlock，其他 goroutine 永远等锁；HTTP 响应的 Body 没关闭，连接相关的 goroutine 无法退出 |

这和前端忘记 `clearInterval` 很像：定时器一直被持有，回调和它引用的数据都释放不了（见 [内存泄漏](/basics/javascript/16-memory-leak)）。区别在于每个泄漏的 goroutine 至少还带着一块栈，并且可能占着连接、文件等资源。

### 泄漏和修复的代码对比

```go
package main

import (
	"context"
	"fmt"
	"runtime"
	"time"
)

func doSearch(q string) string {
	time.Sleep(time.Second) // 模拟耗时 1 秒的下游调用；实际代码中还应该把 ctx 传下去，让它也能提前结束
	return "result of " + q
}

// ❌ 调用方超时返回后，没人再接收 ch，goroutine 永远卡在发送上
func searchLeaky(ctx context.Context, q string) (string, error) {
	ch := make(chan string)
	go func() { ch <- doSearch(q) }()
	select {
	case r := <-ch:
		return r, nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

// ✅ 缓冲为 1：即使没人接收，发送也能完成，goroutine 可以正常退出
func searchFixed(ctx context.Context, q string) (string, error) {
	ch := make(chan string, 1)
	go func() { ch <- doSearch(q) }()
	select {
	case r := <-ch:
		return r, nil
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func main() {
	check := func(name string, search func(context.Context, string) (string, error)) {
		for range 100 {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
			search(ctx, "golang") // 每次都会超时
			cancel()
		}
		time.Sleep(2 * time.Second) // 留足时间让后台的 doSearch 执行完
		fmt.Println(name, runtime.NumGoroutine())
	}
	check("fixed:", searchFixed) // fixed: 1，只剩 main
	check("leaky:", searchLeaky) // leaky: 101，100 个 goroutine 永远卡在发送上
}
```

后台循环同理，要给它一个退出的途径：

```go
func startRefresher(ctx context.Context, refresh func()) {
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done(): // 服务关闭时取消 ctx，循环随之退出
				return
			case <-ticker.C:
				refresh()
			}
		}
	}()
}
```

### 排查

**看趋势**：把 `runtime.NumGoroutine()` 接入监控（Prometheus 的 Go 客户端默认就会上报 `go_goroutines` 指标）。请求量平稳时 goroutine 数量还在持续上涨，基本可以确定有泄漏。

**看堆栈**：在代码里匿名导入 `net/http/pprof`（`import _ "net/http/pprof"`），它会在 `http.DefaultServeMux` 上注册 `/debug/pprof/` 路由，再用 `http.ListenAndServe("localhost:6060", nil)` 单独起一个只监听本机的服务，不要暴露到公网：

- `/debug/pprof/goroutine?debug=1`：按调用栈分组并统计数量，泄漏的 goroutine 通常表现为"几千个卡在同一行"
- `/debug/pprof/goroutine?debug=2`：输出每个 goroutine 的完整堆栈，等待超过一分钟的还会标出阻塞了多久，如 `goroutine 1234 [chan send, 15 minutes]:`
- `go tool pprof http://localhost:6060/debug/pprof/goroutine`：进入交互模式，用 top、traces 等命令分析
- `/debug/pprof/goroutineleak`（Go 1.26 为实验特性，Go 1.27 起正式可用）：借助 GC 的可达性分析，直接报告不可能再被唤醒的 goroutine，即它等待的 channel 或锁已经没有可运行的 goroutine 能访问到，上面的 searchLeaky 就属于这种；等待的对象还能通过全局变量访问到时检测不出来

**在测试中拦截**：uber-go/goleak 可以在测试结束时检查有没有多出来的 goroutine，比如在测试函数开头写 `defer goleak.VerifyNone(t)`。

### 避免

- 启动 goroutine 前先想清楚：谁通知它退出、它在哪里检查这个信号
- 所有可能阻塞的地方都和 `<-ctx.Done()` 一起放进 select；网络调用一定要有超时（`http.Client` 的 Timeout 或带超时的 context）
- 结果 channel 的缓冲设为发送方的数量，接收方提前离开时发送方也不会阻塞
- channel 由发送方负责关闭，规则见 [channel 的底层原理](/basics/go/02-channel)；一组 goroutine 用 errgroup 统一管理并限制并发数，见 [并发同步手段](/basics/go/08-sync-context)

## 面试官可能追问

::: details 能从外部强制结束一个 goroutine 吗？
不能。Go 没有提供杀死 goroutine 的 API，也没有对外暴露 goroutine ID，只能通过 channel 或 context 通知它，由它自己检查后退出。`runtime.Goexit` 只能结束调用它的当前 goroutine。这也是为什么阻塞操作都要配合 select 和 `ctx.Done()`：一个不检查退出信号的 goroutine，外面谁也停不了它。
:::

::: details 线上服务没开 pprof，怎么看 goroutine 堆栈？
可以给进程发 SIGQUIT（`kill -QUIT <pid>`），Go 运行时会把所有 goroutine 的堆栈打印到标准错误，然后退出进程。因为进程会退出，只适合已经准备重启的实例。长期来看，还是应该在内网端口上开启 pprof，或者接入持续性能分析平台。
:::

::: details 在 for-select 循环里用 time.After 会泄漏吗？
它不会泄漏 goroutine，但在 Go 1.23 之前有内存问题：每轮循环都创建一个新的定时器，没到期之前不会被回收，循环频繁、超时时间又长时，内存会明显上涨。Go 1.23 起不再被引用的定时器可以直接被回收，这个问题没有了。在循环里还是建议复用一个 `time.Timer`，或者在循环外创建带超时的 context。
:::

## 易错点

- goroutine 多不等于泄漏，要看在请求量平稳时数量是否持续增长
- 给 channel 加缓冲只能解决"发送方等不到接收方"这一类泄漏；接收方等不到数据，要靠关闭 channel 或 context
- main 返回时所有 goroutine 都会直接终止，写小 demo 时看不出泄漏，常驻的服务才会越积越多
