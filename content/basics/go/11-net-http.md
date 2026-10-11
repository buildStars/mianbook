---
difficulty: 2
tags: [高频, 实践]
---

# Go 的 net/http 服务是怎么处理请求的？中间件怎么写？

::: tip 一句话回答
net/http 的核心是 **Handler 接口**：只有一个 `ServeHTTP(w, r)` 方法，路由器 ServeMux 本身也是一个 Handler。`http.Server` 每接受一个连接就**启动一个 goroutine**，在里面读请求、调用 Handler，所以处理函数可以放心写同步代码。Go 1.22 起 ServeMux 支持在路由里写**方法和路径参数**（如 `GET /users/{id}`，用 `r.PathValue("id")` 取值）。中间件就是 `func(http.Handler) http.Handler`，一层层包装起来形成调用链。上线前一定要给 Server 设置**超时**，给 http.Client 设超时并复用同一个实例。
:::

## 详细解析

### Handler、HandlerFunc 和 ServeMux

- **Handler**：`interface { ServeHTTP(ResponseWriter, *Request) }`，路由器、中间件、业务处理函数都是它
- **HandlerFunc**：`type HandlerFunc func(ResponseWriter, *Request)`，它实现了 ServeHTTP（内部直接调用自己），是把普通函数转成 Handler 的适配器。`mux.HandleFunc(p, f)` 就是 `mux.Handle(p, HandlerFunc(f))`
- **ServeMux**：按 pattern 找到对应的 Handler 再调用，它自己也实现了 ServeHTTP。Server 的 Handler 为 nil 时用全局的 `http.DefaultServeMux`

### 一个请求是怎么被处理的

`ListenAndServe` 在循环里 Accept 新连接，每个连接 `go c.serve(conn)` 交给一个新 goroutine，它循环地解析请求、调用 `handler.ServeHTTP(w, r)`、写回响应，keep-alive 时同一连接上的请求依次处理。goroutine 遇到网络 I/O 会被运行时挂起，线程去执行别的 goroutine（见 [GMP 调度模型](/basics/go/01-gmp)），所以"一个连接一个 goroutine"能撑住大量并发，不需要像 Node.js 那样写回调。代价是 Handler 会被**并发调用**，读写共享数据要加锁。处理函数 panic 时，Server 会 recover、打印堆栈并关闭这个连接，进程不会退出，但处理函数里另起的 goroutine 不在保护范围内（见 [defer、panic、recover](/basics/go/06-defer-panic-recover)）。

### Go 1.22 起的路由写法

- `"GET /users/{id}"`：限定方法，GET 同时匹配 HEAD；路径匹配但方法不对时返回 405
- `{id}` 匹配一段路径，用 `r.PathValue("id")` 取值；`/files/{path...}` 匹配剩余的所有段，只能放在末尾
- 以 `/` 结尾的 pattern 仍然是前缀匹配，只想精确匹配 `/` 要写 `/{$}`
- 多个 pattern 都能匹配时**更具体的优先**，和注册顺序无关；分不出谁更具体就是冲突，注册时直接 panic
- 以前要用 gorilla/mux、chi 才能做到的事，现在标准库就够用了；需要参数绑定、校验时可以用 [Gin](/basics/go/13-gin)

### 中间件就是包装 Handler

中间件接收下一个 Handler，返回一个新的 Handler，在调用 `next.ServeHTTP` 的前后做事，不调用 next 就是拦截请求。最外层的最先执行、最后返回，和 Koa 的洋葱模型一样（见 [Express 和 Koa 的中间件](/basics/node/05-middleware)）。当前用户、trace ID 这类请求范围的数据，用 `context.WithValue` 放进 `r.WithContext(ctx)` 往下传。

### Server 和 Client 的超时

| 字段 | 含义 | 不设的后果 |
| --- | --- | --- |
| `ReadHeaderTimeout` | 读完请求头的时间 | 慢速攻击（Slowloris）一点点发请求头，长期占住连接和 goroutine |
| `ReadTimeout` | 读完整个请求（含 body）的时间 | 慢速上传占住连接；大文件上传接口要单独考虑 |
| `WriteTimeout` | 写完响应的时间（大致从读完请求头开始算） | 客户端不读响应时一直卡着；设了它，长轮询、SSE 也会被截断 |
| `IdleTimeout` | keep-alive 连接空闲多久后关闭 | 为 0 时沿用 ReadTimeout，两者都为 0 时空闲连接不会因超时关闭 |

这些字段为 0 都表示不超时，`http.ListenAndServe(addr, h)` 用的就是全 0 的 Server，只适合写 demo。客户端这边：

- `http.Client` 的 Timeout 为 0 表示**不超时**，`http.Get` 用的默认 Client 就是这样，下游卡住时会一直等。要自己创建 Client 并设置 Timeout，或者用 `http.NewRequestWithContext` 传入带超时的 ctx
- Client 内部的 Transport 维护连接池，要**全局复用**一个 Client，不要每次请求都 new
- 拿到响应后一定要 `defer resp.Body.Close()`，否则会泄漏连接和相关的 goroutine。Body **读完**再关闭，连接才能放回池里复用，不需要的内容可以用 `io.Copy(io.Discard, resp.Body)` 丢弃；Go 1.27 起 HTTP/1 的 Close 会自动读掉不太多的剩余内容，但剩余内容很大时仍然无法复用

## 代码示例

日志、恢复 panic、鉴权三个中间件，加上设置了超时的 Server（正式服务还要做[优雅退出](/basics/go/12-graceful-shutdown)）：

```go
package main

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"time"
)

type userKey struct{} // context 的 key 用未导出类型，避免冲突

func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r) // 之前是请求进来时，之后是响应返回时
		slog.Info("request", "method", r.Method, "path", r.URL.Path, "cost", time.Since(start))
	})
}

func recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				slog.Error("panic", "value", v, "path", r.URL.Path)
				http.Error(w, "internal server error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "" { // 示例只判断非空，实际要校验 JWT 或查会话
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return // 不调用 next，请求在这里被拦截
		}
		ctx := context.WithValue(r.Context(), userKey{}, "alice")
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func getUser(w http.ResponseWriter, r *http.Request) {
	caller, _ := r.Context().Value(userKey{}).(string)
	fmt.Fprintf(w, "user %s, caller %s\n", r.PathValue("id"), caller)
}

func main() {
	mux := http.NewServeMux()
	mux.Handle("GET /users/{id}", auth(http.HandlerFunc(getUser))) // 只有这个路由需要鉴权
	srv := &http.Server{
		Addr:              ":8080",
		Handler:           logging(recoverer(mux)), // 执行顺序：logging → recoverer → mux
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Fatal(srv.ListenAndServe())
}
```

## 面试官可能追问

::: details net/http 已经会 recover panic 了，为什么还要写恢复中间件？
Server 自带的 recover 只是打印堆栈并关闭连接，客户端看到的是连接被断开，而不是一个正常的 500 响应。自己写的中间件可以返回统一格式的错误、记录请求路径和 trace ID、上报监控。两者都管不到处理函数里另起的 goroutine，那里要自己 recover。
:::

::: details WriteTimeout 到了，处理函数会停下来吗？
不会。WriteTimeout 到期后写响应会失败，但处理函数会继续执行完，查询数据库这类工作照样占着资源。要让处理函数及时停下，可以用 `http.TimeoutHandler(h, dt, msg)` 包装，超时后它给客户端返回 503 并取消请求的 context；或者在处理函数里用 `context.WithTimeout(r.Context(), ...)` 派生 ctx 传给下游。客户端断开连接时 `r.Context()` 也会被取消。
:::

::: details 包装 ResponseWriter 有什么坑？
嵌入接口之后，只有 ResponseWriter 的三个方法被转发，底层对象实现的 `http.Flusher`、`http.Hijacker` 等接口会被"藏起来"，SSE 和 WebSocket 升级就可能失败。可以给包装类型加一个 `Unwrap() http.ResponseWriter` 方法，再用 `http.NewResponseController(w)` 调用 Flush、Hijack，它会沿着 Unwrap 找到底层实现。
:::

## 易错点

- 生产环境直接用 `http.ListenAndServe` 或 `http.Get`，Server 和 Client 都没有超时
- 每次请求都 new 一个 http.Client 或 Transport，连接无法复用；Body 没 Close 导致连接泄漏
- 在 `WriteHeader` 或写入 body 之后再调用 `w.Header().Set(...)`，设置不会生效；状态码也只能写一次
- 导入 `net/http/pprof` 会在 DefaultServeMux 上注册调试接口，业务也用 DefaultServeMux 时会被一起暴露，见 [pprof 怎么用](/basics/go/15-pprof)
