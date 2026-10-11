---
difficulty: 2
tags: [高频, 原理, 实践]
---

# Gin 框架的路由和中间件是怎么实现的？

::: tip 一句话回答
Gin 的路由基于**基数树（radix tree）**，每个 HTTP 方法一棵树，公共前缀合并成一个节点，支持 `:id` 参数和 `*path` 通配，查找时间只和路径长度有关。中间件和处理函数都是 `gin.HandlerFunc`，注册时按顺序拼成一个切片 **HandlersChain**，`c.Next()` 推进下标执行下一个，`c.Abort()` 把下标设成一个很大的值让后面的都不再执行，形成**洋葱模型**。`gin.Context` 通过 **sync.Pool 复用**，请求结束就会被回收重置，所以不能在新的 goroutine 里直接用它，要先 `c.Copy()`。
:::

## 详细解析

### 路由：每个方法一棵基数树

Engine 里有一组路由树，每个 HTTP 方法对应一棵。请求进来时先按方法找到树的根节点，再沿着路径往下匹配。基数树会把公共前缀合并成一个节点，比如注册了 `/search`、`/static/*filepath`、`/users/:id`、`/users/:id/posts` 的 GET 树：

```text
/
├── s
│   ├── earch                → /search
│   └── tatic/
│       └── *filepath        → /static/*filepath
└── users/
    └── :id                  → /users/:id
        └── /posts           → /users/:id/posts
```

- `:id` 匹配一段路径，用 `c.Param("id")` 取值；`*filepath` 匹配剩下的全部内容，只能放在末尾，取到的值带开头的 `/`，如 `/css/app.css`
- 查找只需要沿树往下走一遍，耗时和路径长度有关，和注册了多少路由无关；参数存放在预先分配好的切片里，匹配过程基本不产生内存分配。这棵树的实现来自 httprouter，Gin 在它的基础上做了修改

### 中间件：HandlersChain 和下标

中间件和处理函数的类型都是 `type HandlerFunc func(*Context)`，`type HandlersChain []HandlerFunc`。`r.Use(...)`、`r.Group(path, ...)` 注册的中间件和路由的处理函数，在注册路由时被拼成一个 HandlersChain 存到树的节点上。请求匹配到路由后，Context 拿到这个切片，从第一个开始执行。标准库的中间件是一层层包装 Handler（见 [net/http 怎么处理请求](/basics/go/11-net-http)），Gin 则是平铺在一个切片里用下标推进，效果相同。Next 和 Abort 的核心逻辑（简化后）：

```go
func (c *Context) Next() {
	c.index++
	for c.index < int8(len(c.handlers)) {
		c.handlers[c.index](c)
		c.index++
	}
}
func (c *Context) Abort() { c.index = abortIndex } // abortIndex 是一个比处理函数数量上限更大的值
```

- 在中间件里调用 `c.Next()`，后面的处理函数会**在这里同步执行完**，再回到中间件里 Next 之后的代码，所以 Next 之前是"请求进来"，之后是"响应返回"，这就是洋葱模型，和 Koa 的 `await next()` 一样（见 [Express 和 Koa 的中间件](/basics/node/05-middleware)）
- 中间件**不调用 Next 也不会中断链**：它返回后，外层 Next 的循环会继续执行下一个。要拦截请求必须调用 `c.Abort()`，常用 `c.AbortWithStatusJSON(401, ...)`。Abort 只是阻止后续的处理函数，**不会结束当前函数**，后面要紧跟 return

### gin.Context 的复用

Engine 用 sync.Pool 缓存 Context。每个请求从池里取一个，`reset()` 清空上次的状态，执行完处理函数后放回池里，减少了每个请求的内存分配。代价是：**请求结束后，这个 Context 可能已经被下一个请求拿去用了**。在处理函数里启动的 goroutine 如果还持有原来的 c，读到的可能是别人的参数和数据。所以要传 `c.Copy()`，它复制了 Params、Keys 等数据（Request 仍指向同一个对象，只应读取），并且不能再往下执行处理链。

### 参数绑定，以及和其他框架的对比

`c.ShouldBindJSON(&req)` 把请求体解析到结构体，再按 `binding` 标签校验，校验规则来自 go-playground/validator，如 `required`、`email`、`min`、`max`、`oneof`。还有 `ShouldBindQuery`、`ShouldBindUri` 等对应不同来源。`ShouldBind` 系列只返回错误，由你决定怎么响应；`Bind`、`BindJSON` 系列失败时会自动写 400 并 Abort，之后再写响应就会冲突。实际项目里一般统一用 ShouldBind，再把校验错误转成统一的错误格式。和其他框架比：标准库 net/http 从 Go 1.22 起支持方法和路径参数，零依赖，但绑定、校验要自己写；Echo 同样是基数树路由，处理函数返回 error，统一错误处理更方便；Fiber 基于 fasthttp，API 模仿 Express，但不兼容 net/http 的 Handler 和中间件生态，要靠适配器。

## 代码示例

```go
package main

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type CreateUserReq struct {
	Name  string `json:"name" binding:"required,min=2,max=32"`
	Email string `json:"email" binding:"required,email"`
}

func timing() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next() // 后面的中间件和处理函数在这里执行完
		log.Printf("%s %s %d %v", c.Request.Method, c.FullPath(), c.Writer.Status(), time.Since(start))
	}
}

func authRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetHeader("Authorization") == "" { // 示例只判断非空
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return // Abort 不会结束当前函数
		}
		c.Set("uid", int64(42))
		c.Next()
	}
}

func audit(c *gin.Context, action string) {
	log.Printf("audit uid=%d ip=%s action=%s", c.GetInt64("uid"), c.ClientIP(), action)
}

func main() {
	r := gin.New()
	// 全局中间件。POST /api/users 的执行顺序：Recovery → timing → authRequired → 处理函数 → 回到 timing
	r.Use(gin.Recovery(), timing())

	api := r.Group("/api", authRequired()) // 只作用于 /api 下的路由
	api.GET("/users/:id", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"id": c.Param("id")}) })
	api.POST("/users", func(c *gin.Context) {
		var req CreateUserReq
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		// ✅ 传副本；❌ go audit(c, ...)：请求结束后 c 会被复用，可能读到别的请求的数据
		cp := c.Copy()
		go audit(cp, "create "+req.Name)
		c.JSON(http.StatusCreated, gin.H{"name": req.Name})
	})
	log.Fatal(r.Run(":8080")) // Run 只在启动失败时返回
}
```

## 面试官可能追问

::: details 能把 gin.Context 直接当 context.Context 传给数据库查询吗？
gin.Context 实现了 context.Context 接口，编译能通过，但默认情况下它的 Done、Deadline 不会转发到 `c.Request.Context()`，客户端断开或超时后查询不会被取消（开启 Engine 的 ContextWithFallback 才会转发）。更稳妥的写法是传 `c.Request.Context()`；要在请求结束后继续执行的后台任务，不能用请求的 context，因为请求结束它就会被取消，可以用 `context.WithoutCancel` 派生一个保留值但不会被取消的 context。
:::

::: details 中间件里 c.Next() 之后还能修改响应头吗？
通常不行。Next 返回时处理函数一般已经写出了响应，响应头和状态码已经发送，再调用 `c.Header()` 不会生效。需要统一加的响应头（如 trace ID、CORS）要在 Next 之前设置。
:::

::: details Gin 的路由有哪些限制？
同一位置的路径参数名要一致，比如不能同时注册 `/users/:id` 和 `/users/:uid/posts`，注册时会 panic；`*path` 只能放在末尾。一条路由能挂的处理函数数量也有上限（由 abortIndex 决定），正常项目远远达不到。
:::

## 易错点

- 以为中间件不调用 `c.Next()` 就能拦截请求，实际后面的处理函数照样执行，拦截要用 Abort
- Abort 之后没有 return，当前函数后面的代码继续执行，可能重复写响应
- 在 goroutine 里使用原始的 c，请求结束后 Context 被放回池里复用，读到错乱的数据
- 部署在反向代理后面时没有调用 `SetTrustedProxies`，`c.ClientIP()` 会信任客户端伪造的 X-Forwarded-For 头，用它做限流或风控就会被绕过
