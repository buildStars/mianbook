---
difficulty: 2
tags: [实践, 性能优化, 场景题]
---

# Go 服务的性能问题怎么排查？pprof 怎么用？

::: tip 一句话回答
先用监控确认是哪类问题（CPU 高、内存涨、goroutine 涨、延迟高），再用 **pprof** 采集对应的 profile 定位到具体函数。线上服务导入 `net/http/pprof`，在**单独的内网端口**上暴露 `/debug/pprof/`；常用的有 CPU profile（哪些函数占 CPU）、heap（**inuse** 看当前占用，**alloc** 看累计分配）、goroutine（都卡在哪）、block 和 mutex（等待和锁竞争）。用 `go tool pprof` 的 top、list 找热点，`-http` 打开带火焰图的 Web 界面。调度、GC 造成的延迟用 `go tool trace` 看，优化效果用 benchmark 量化。
:::

## 详细解析

### 有哪些 profile

| profile | 内容 | 用来查 |
| --- | --- | --- |
| profile（CPU） | 采样一段时间内正在 CPU 上执行的调用栈 | CPU 高，哪个函数最耗时 |
| heap | 内存分配的采样，默认看 inuse（当前还活着的对象） | 内存占用高、内存泄漏 |
| allocs | 同样的数据，默认看 alloc（程序启动以来累计分配的） | 分配太频繁导致 GC 压力大 |
| goroutine | 所有 goroutine 当前的调用栈 | goroutine 泄漏、死锁、请求卡住 |
| block | goroutine 在 channel、锁、select 等同步原语上阻塞的位置和时长 | 延迟高但 CPU 不高 |
| mutex | 发生锁竞争的位置，记在持有锁、导致别人等待的一方 | 锁竞争严重 |
| trace | 一段时间内调度、GC、系统调用等事件的完整记录 | 调度延迟、GC 停顿，用 `go tool trace` 打开 |

block 和 mutex 默认是关闭的，要先调用 `runtime.SetBlockProfileRate` 和 `runtime.SetMutexProfileFraction` 才会有数据。heap 是**采样**的，不是每次分配都记录，所以数值是估算出来的，看相对大小即可。

### go tool pprof 常用操作

```bash
# CPU：采样 30 秒后进入交互模式
go tool pprof 'http://127.0.0.1:6060/debug/pprof/profile?seconds=30'
# 内存：默认 inuse_space，用 -sample_index 切到累计分配
go tool pprof -sample_index=alloc_space 'http://127.0.0.1:6060/debug/pprof/heap'
# Web 界面：调用图、火焰图、源码视图都在里面
go tool pprof -http=:8081 cpu.pprof
# 对比两次采集的堆，只看增长的部分，查内存泄漏很有用
go tool pprof -base heap1.pprof heap2.pprof
# goroutine 按调用栈分组计数，泄漏时常见"几千个卡在同一行"
curl 'http://127.0.0.1:6060/debug/pprof/goroutine?debug=1'
```

交互模式里的命令：

- `top`：按 **flat** 排序。flat 是函数自身消耗的，cum 是自身加上它调用的函数一共消耗的；`top -cum` 按 cum 排序，适合从上往下找是哪条调用链慢
- `list 函数名`：逐行显示这个函数的源码和每行的消耗，定位到具体哪一行
- `web`：生成调用图（需要安装 Graphviz）；`peek`、`traces` 看调用关系和完整调用栈

火焰图里宽度代表占比，层级代表调用关系（pprof 的 Web 界面把根放在最上面，越往下越是被调用的函数）。重点找很宽、下面又没有再分出子调用的块，它自身就消耗了大量时间。

### 按问题排查

1. **CPU 高**：采 30 秒 CPU profile，看 top 和火焰图。常见原因有 JSON 序列化、正则、日志格式化、大量小对象分配导致 GC 占 CPU（火焰图里 `runtime.gcBgMarkWorker`、`runtime.mallocgc` 很宽）
2. **内存涨**：隔一段时间采两次 heap，用 `-base` 对比 inuse_space，增长的部分就是嫌疑点，比如只增不减的全局缓存、被小切片引用住的大数组；alloc_space 用来找分配热点，见 [Go 的垃圾回收](/basics/go/07-gc)
3. **goroutine 涨**：看 goroutine profile，大量堆积在同一行的就是泄漏点；Go 1.27 起还可以看 `goroutineleak` profile，它直接报告不可能再被唤醒的 goroutine，见 [goroutine 泄漏](/basics/go/09-goroutine-leak)
4. **延迟高但 CPU 不高**：CPU profile 只记录在 CPU 上执行的时间，等待 I/O、等锁、等 channel 的时间不在里面。看 block、mutex profile 和 goroutine 堆栈，或者用 trace 看 goroutine 从可运行到真正被调度花了多久；还要排查下游，见 [接口请求很慢怎么排查](/basics/network/19-slow-request)

### benchmark、trace 和 PGO

- **benchmark**：`go test -bench=Encode -benchmem -cpuprofile cpu.out -memprofile mem.out`，跑基准测试的同时生成 profile，适合在本地针对单个函数优化。`-benchmem` 会输出每次操作的分配次数和字节数，优化前后用 benchstat 对比多次运行的结果
- **trace**：`curl -o trace.out 'http://127.0.0.1:6060/debug/pprof/trace?seconds=5'`，再 `go tool trace trace.out`。它能看到每个 P 上 goroutine 的执行时间线、GC 的各个阶段和 STW、系统调用和网络阻塞，适合查"偶发的长尾延迟"。trace 的开销比 profile 大，采集时间要短
- **PGO**：把线上采集的 CPU profile 命名为 `default.pgo` 放在 main 包目录下，Go 1.21 起 `go build` 默认会自动使用它，按热点做更积极的内联等优化。收益因程序而异，不改代码就能拿到，适合热点稳定的服务

## 代码示例

单独起一个只监听本机的调试端口，业务用自己的 mux：

```go
package main

import (
	"log"
	"net/http"
	"net/http/pprof"
	"runtime"
	"time"
)

func startDebugServer() {
	runtime.SetBlockProfileRate(10000)   // 平均每累计阻塞 10µs 采样一个事件，设为 1 会记录全部
	runtime.SetMutexProfileFraction(100) // 平均每 100 次锁竞争记录 1 次

	mux := http.NewServeMux()
	mux.HandleFunc("/debug/pprof/", pprof.Index) // 也负责 heap、goroutine、allocs 等
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
	go func() {
		// 只监听本机或内网地址，不要暴露到公网
		if err := http.ListenAndServe("127.0.0.1:6060", mux); err != nil {
			log.Println("debug server:", err)
		}
	}()
}

func main() {
	startDebugServer()

	// 导入 net/http/pprof 会自动在 DefaultServeMux 上注册路由，所以业务不要用 DefaultServeMux
	app := http.NewServeMux()
	app.HandleFunc("GET /hello", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte("hello\n"))
	})
	srv := &http.Server{Addr: ":8080", Handler: app, ReadHeaderTimeout: 5 * time.Second}
	log.Fatal(srv.ListenAndServe())
}
```

## 面试官可能追问

::: details 线上开着 pprof 会影响性能吗？
只是注册了路由时几乎没有开销，采集时才有。CPU profile 是定时采样，采集期间有少量额外开销；heap 本来就一直按采样记录分配，读取时只是导出数据。block、mutex 的采样率设得太高（比如 1）会明显拖慢锁和 channel 操作，所以要设一个合适的值。trace 记录的事件最多，开销也最大。很多团队会接入持续性能分析平台（例如 Pyroscope、Parca），定期低频采集，出问题时直接看历史数据。
:::

::: details 进程内存一直涨，heap profile 里却没多少，可能是什么原因？
heap profile 只统计 Go 堆上的分配。其他可能：大量 goroutine 的栈（看 goroutine 数量）；GC 后的空闲内存还没归还给操作系统，RSS 下降有延迟；cgo 或者通过 mmap 分配的内存，Go 运行时看不到。可以用 `runtime.ReadMemStats` 或 `runtime/metrics` 对比堆、栈和运行时总共向系统申请的内存，判断涨的是哪一块。
:::

::: details inuse 和 alloc 什么时候用哪个？
查"内存为什么占这么多"、内存泄漏，用 inuse_space，它反映的是采集时刻还活着的对象。查"GC 为什么这么频繁、CPU 为什么耗在分配上"，用 alloc_space 或 alloc_objects，它们累计了启动以来的全部分配，哪怕对象早就被回收了。减少分配的方法见 [逃逸分析和减少内存分配](/basics/go/16-escape-analysis)。
:::

## 易错点

- 匿名导入 `net/http/pprof` 后业务也用 DefaultServeMux，调试接口和业务一起暴露在公网，泄露内部信息还能被拿来消耗 CPU
- 没设置采样率就去看 block、mutex profile，结果是空的
- 用 CPU profile 查"请求慢"，只能看到在 CPU 上的时间，等 I/O、等锁的时间要看 block、mutex 和 trace
- 只采一次 heap 就下结论，内存泄漏要看两次采集之间的增长
