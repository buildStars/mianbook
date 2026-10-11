---
difficulty: 2
tags: [实践, 综合]
---

# Go 后端项目怎么组织代码？依赖注入怎么做？

::: tip 一句话回答
Go 没有官方强制的目录结构。常见做法是：每个可执行程序的入口放在 `cmd/<名字>/main.go`，业务代码放在 **internal/** 下（编译器保证其他模块无法导入），internal 里**按业务领域分包**（order、user），每个包内部再分 handler、service、repository 几层。接口**定义在使用方**，函数"接收接口、返回具体类型"。依赖注入优先用**构造函数手动注入**，在 main 里组装；依赖很多时再考虑 wire（代码生成）或 fx（运行时）这类工具。
:::

## 详细解析

### 目录结构

```text
shop/
├── cmd/
│   ├── api/main.go        # HTTP 服务入口：加载配置、组装依赖、启动
│   └── worker/main.go     # 消费消息队列的后台进程
├── internal/
│   ├── order/             # 按业务领域分包：模型、handler、service、repository 都在这里
│   ├── user/
│   └── platform/          # 基础设施：配置、数据库、Redis、MQ 客户端的初始化
└── migrations/            # 数据库迁移脚本
```

- **cmd/**：一个子目录一个程序，main 只做组装，不写业务逻辑。官方文档 "Organizing a Go module" 推荐把服务端的命令统一放在 cmd 下。pkg/ 则不是官方约定，GitHub 上流行的 golang-standards/project-layout 也不是 Go 官方的项目，目录很多，小项目照搬反而累赘
- **internal/**：路径里带 internal 的包，只能被 internal 的父目录及其子目录下的代码导入，这是**编译器强制**的。服务端代码一般不需要被其他模块引用，官方建议尽量放进 internal，以后重构不用担心破坏外部使用者
- **按领域分包，而不是按层分包**：把所有 handler 放一个包、所有 model 放一个包，改一个功能要跨好几个目录，包之间也容易互相引用。按领域分，一个包就是一块完整的业务，包名就是领域名（`order.Service` 读起来很自然）

### 分层和接口放在哪里

请求的流向是 handler → service → repository，依赖方向也是这样，下层不知道上层的存在。Go 的接口是隐式实现的，所以接口应该由**使用方**定义：service 需要读订单，就在 service 所在的包里声明一个只包含 `Get` 方法的 `Repository` 接口；MySQL 的实现不需要知道这个接口，方法签名对得上就行。这和 Java 里"实现方先定义接口，再写 Impl"的习惯相反。小接口让测试时写 fake 很容易，见 [单元测试](/basics/go/20-testing)。"接收接口、返回具体类型"（accept interfaces, return structs）：构造函数返回 `*Service` 而不是接口，调用方能用到全部方法，需要抽象时由调用方自己定义接口。这也是依赖倒置原则在 Go 里的体现，见 [SOLID 原则](/basics/design-pattern/09-solid)。

### 依赖注入

- **手动注入**：每个组件的依赖都通过构造函数参数传入，main 里从下往上依次创建。代码直白，编译期就能发现缺了什么，大多数项目这样就够了。和 Spring 的 IoC 容器相比（见 [Spring IoC 和 AOP](/basics/java/10-spring-ioc-aop)），Go 社区更倾向于这种显式组装，不用容器和注解
- **wire**：Google 的代码生成工具，声明各组件的构造函数后生成组装代码，本质还是手动注入，只是代码由工具写。注意它的仓库已经在 2025 年归档，不再维护
- **fx**：Uber 的运行时依赖注入框架，基于反射，自带生命周期管理（启动、停止钩子），适合模块很多的大型服务；代价是依赖关系的错误要到启动时才暴露，也更难跳转阅读

### 配置、日志和错误

- **配置**：在 main 里从环境变量、配置文件加载成一个结构体，校验后把需要的字段传给各组件，不要做成到处读取的全局变量
- **日志**：Go 1.21 起标准库有结构化日志 `log/slog`，输出 JSON、带键值对，logger 作为依赖注入，或者通过 ctx 关联 trace ID
- **错误**：repository 返回包内定义的哨兵错误（如 `order.ErrNotFound`），service 用 `%w` 包装后返回，handler 用 `errors.Is` 映射成 HTTP 状态码，见 [错误处理](/basics/go/10-error-handling)

## 代码示例

```go
// internal/order/service.go：service 定义自己需要的接口，通过构造函数注入
package order

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
)

var ErrNotFound = errors.New("order not found") // repository 查不到时返回

type Order struct{ ID, Amount int64 } // Amount 以分为单位

type Repository interface { // 由使用方定义，只包含 service 用到的方法
	Get(ctx context.Context, id int64) (*Order, error)
}

type Service struct {
	repo   Repository
	logger *slog.Logger
}

func NewService(repo Repository, logger *slog.Logger) *Service { // 接收接口，返回具体类型
	return &Service{repo: repo, logger: logger}
}

func (s *Service) Get(ctx context.Context, id int64) (*Order, error) {
	o, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("get order %d: %w", id, err)
	}
	s.logger.InfoContext(ctx, "order loaded", "order_id", id)
	return o, nil
}
```

```go
// cmd/api/main.go：只负责组装（省略了 repository 和 handler 的实现）
package main

import (
	"database/sql"
	"log/slog"
	"net/http"
	"os"

	_ "github.com/go-sql-driver/mysql" // 注册 MySQL 驱动

	"example.com/shop/internal/order"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	db, err := sql.Open("mysql", os.Getenv("MYSQL_DSN"))
	if err != nil {
		logger.Error("open db", "err", err)
		os.Exit(1)
	}
	defer db.Close()
	// 从下往上组装：repository → service → handler
	svc := order.NewService(order.NewMySQLRepository(db), logger)
	h := order.NewHandler(svc)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /orders/{id}", h.Get)
	logger.Error("server stopped", "err", http.ListenAndServe(":8080", mux)) // ListenAndServe 总是返回非 nil 错误
}
```

生产环境还要给 Server 设置超时、实现优雅退出，见 [net/http 服务](/basics/go/11-net-http) 和 [优雅退出](/basics/go/12-graceful-shutdown)。

## 面试官可能追问

::: details 出现循环依赖怎么办？
Go 编译器不允许包之间循环导入，出现时说明包的边界没划好。常见解法：把两个包共同依赖的类型抽到更底层的包；让其中一方定义接口，另一方通过注入的方式提供实现，而不是直接导入；两个包确实紧密耦合时，干脆合并成一个包。
:::

::: details 为什么不推荐用全局变量保存 db、logger？
全局变量让依赖关系变得隐式：看函数签名不知道它用了什么，测试时也只能改全局变量，没法并行跑测试。通过构造函数注入后，每个组件依赖什么一目了然，测试时传一个 fake 就行。
:::

::: details 小项目也要分这么多层吗？
不需要。几个接口的小服务，一个 main 包加几个文件就够了。Go 社区普遍反对过度设计，结构应该随着代码量增长再拆分：先按领域分包，某一层的逻辑确实复杂了再单独拆出来。
:::

## 易错点

- 把接口定义在实现方的包里，还为每个结构体都配一个接口：接口变多，却没有带来解耦，Go 里接口应该小而且按需定义
- 建一个 `utils`、`common` 包什么都往里放：它会被所有包依赖，也容易引出循环依赖，包名应该说明它提供什么
- 在 `init()` 里连接数据库、读取配置：失败时没法优雅地处理，测试时导入这个包就会触发，初始化应该放在 main 里显式进行
