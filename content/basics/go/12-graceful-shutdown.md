---
difficulty: 2
tags: [高频, 实践]
---

# Go 服务怎么实现优雅退出？

::: tip 一句话回答
优雅退出就是收到退出信号后**不再接新请求、处理完手上的请求、停掉后台任务、释放资源**，然后再退出。Go 里用 `signal.NotifyContext` 监听 **SIGINT / SIGTERM**，收到后调用 `http.Server.Shutdown(ctx)`：它先关闭监听端口和空闲连接，再等进行中的请求处理完。后台 goroutine 用 **context 取消 + WaitGroup** 通知并等待它们退出，最后关闭数据库等连接。整个过程要有**超时兜底**，在 Kubernetes 中还要和 readiness 探针、preStop 配合。
:::

## 详细解析

### 信号和 Shutdown

进程被直接杀掉时，正在处理的请求会被中断，写到一半的数据、还没发出去的消息也可能丢失。Kubernetes、systemd、`docker stop` 停止进程时都会先发 **SIGTERM**，等一段时间还没退出再发 SIGKILL；终端按 Ctrl+C 发的是 **SIGINT**。SIGKILL 无法捕获，所以优雅退出只能在收到 SIGTERM 之后、被强杀之前完成。收到信号后调用的 `srv.Shutdown(ctx)` 会：

1. 关闭所有监听的端口，不再接受新连接
2. 关闭空闲的 keep-alive 连接
3. 轮询等待活动连接上的请求处理完、变成空闲后关闭
4. 全部完成返回 nil；传入的 ctx 先到期则返回 ctx 的错误，剩下的连接不再等待

- 调用 Shutdown 的那一刻，阻塞中的 `ListenAndServe` 会**立刻返回** `http.ErrServerClosed`。main 不能在这时就退出，要等 Shutdown 返回
- Shutdown **不会关闭也不会等待被劫持（Hijack）的连接**，比如 WebSocket。可以用 `srv.RegisterOnShutdown(f)` 注册回调，在里面通知这些长连接自己关闭；回调在新的 goroutine 里执行，Shutdown 不会等它
- `srv.Close()` 立即断开所有连接，适合在 Shutdown 超时后兜底；调用过 Shutdown 的 Server 不能再复用

### 关闭顺序

```text
收到 SIGTERM → (K8s) 从 Service 端点移除，等几秒让流量切走
  → srv.Shutdown(ctx)：停止接收新请求，等进行中的请求完成
  → 取消后台任务的 context，wg.Wait() 等 goroutine 退出（MQ 消费者先停止拉取，处理完手上的消息再提交）
  → 关闭数据库、Redis、MQ 等连接，刷新日志和监控缓冲 → 进程退出
```

原则是**先停入口，再停依赖**：请求还在处理时就关了数据库，这些请求只会全部失败。整个流程放在一个总超时里，超时就强制退出，总时间要小于 K8s 的 `terminationGracePeriodSeconds`，否则会被 SIGKILL 打断。

在 Kubernetes 中，Pod 被删除时，"从 Service 端点中移除"和"给容器发 SIGTERM"是**并行**发生的。进程一收到 SIGTERM 就关闭端口，负载均衡还没更新完，仍有请求被转发过来，就会连接失败。常见做法是用 `preStop` 先 sleep 几秒，或者在代码里收到信号后先等几秒再调用 Shutdown，完整流程见 [Kubernetes 的滚动发布和健康检查](/basics/container/07-k8s-probes-rollout)。

## 代码示例

```go
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

func runWorker(ctx context.Context, wg *sync.WaitGroup) { // 后台定时任务，ctx 取消时退出
	defer wg.Done()
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			slog.Info("worker tick") // 实际业务：清理过期数据、刷新缓存等
		}
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM) // 收到信号时 ctx 被取消
	defer stop()

	workerCtx, cancelWorkers := context.WithCancel(context.Background())
	defer cancelWorkers()
	var wg sync.WaitGroup
	wg.Add(1)
	go runWorker(workerCtx, &wg)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /hello", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("hello\n")) })
	srv := &http.Server{Addr: ":8080", Handler: mux, ReadHeaderTimeout: 5 * time.Second}

	serveErr := make(chan error, 1)
	go func() { // 正常关闭时返回的 ErrServerClosed 不算错误
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
		}
	}()

	select {
	case err := <-serveErr: // 端口被占用等启动失败的情况
		return err
	case <-ctx.Done():
		slog.Info("shutting down", "cause", context.Cause(ctx))
	}
	stop() // 恢复默认信号行为：再按一次 Ctrl+C 可以直接退出

	// 用新的 context 计时，整个关闭过程最多 20 秒，要小于 terminationGracePeriodSeconds
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("http shutdown", "err", err)
		srv.Close() // 超时了，强制断开剩下的连接
	}
	cancelWorkers() // 再通知后台任务退出，并等待它们结束
	wg.Wait()
	// 最后关闭依赖，如 db.Close()、redis.Close()
	return nil
}

func main() {
	if err := run(); err != nil { // 逻辑放在 run 里，defer 都能正常执行
		slog.Error("server exited", "err", err)
		os.Exit(1)
	}
}
```

## 面试官可能追问

::: details 为什么不在 main 里直接 log.Fatal(srv.ListenAndServe())？
调用 Shutdown 后 ListenAndServe 会立刻返回 ErrServerClosed，log.Fatal 会马上调用 `os.Exit(1)`，进行中的请求还没处理完进程就退出了，defer 也都不会执行。要把 ListenAndServe 放到 goroutine 里，主流程等 Shutdown 返回之后再退出。
:::

::: details WebSocket、gRPC 这类长连接怎么优雅关闭？
Shutdown 不管被劫持的连接，要自己处理：用 RegisterOnShutdown 注册回调，或者在 Shutdown 前自己遍历连接，给客户端发关闭帧，让客户端重连到其他实例，再在超时内等这些连接结束。grpc-go 的 Server 有自己的 `GracefulStop()`，停止接收新的 RPC 并等进行中的 RPC 完成，同样要配一个超时，到时调用 `Stop()` 强制关闭。
:::

::: details 后台任务迟迟不退出怎么办？
`wg.Wait()` 没有超时参数，某个任务不检查 ctx 时会一直卡住。可以在 goroutine 里执行 Wait，完成后关闭一个 done channel，主流程用 select 同时等 done 和 `shutdownCtx.Done()`，超时就记录日志直接退出。根本的解决办法是让每个后台任务的阻塞操作都和 `ctx.Done()` 一起放进 select，见 [goroutine 泄漏](/basics/go/09-goroutine-leak)。
:::

## 易错点

- 只监听 SIGINT，没有监听 SIGTERM，在 Docker 和 K8s 中收不到停止信号，最后被 SIGKILL 强杀
- 把 `signal.NotifyContext` 返回的 ctx 传给 Shutdown，它此时已经被取消，Shutdown 会立刻返回，不等请求完成；要用一个新的带超时的 context
- Shutdown 没有超时兜底，某个请求卡住时进程永远退不出；或者超时时间比 `terminationGracePeriodSeconds` 还长
- 容器里用 shell 形式的启动命令（如 `sh -c ./app`），SIGTERM 发给了 shell，Go 进程可能收不到；Dockerfile 要用 exec 形式 `CMD ["./app"]`
