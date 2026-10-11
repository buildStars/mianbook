---
difficulty: 2
tags: [高频, 对比, 实践]
---

# gRPC 是什么？和 REST 有什么区别？

::: tip 一句话回答
gRPC 是一个 RPC 框架：先用 **Protocol Buffers** 在 `.proto` 文件里定义服务和消息，再用工具**生成**客户端和服务端代码，调用远程方法就像调用本地函数。它跑在 **HTTP/2** 上，消息是二进制编码，支持一元调用和三种**流式**调用。和 REST/JSON 相比，它契约强类型、编码紧凑、天然支持流，适合内部服务之间调用；代价是浏览器不能直接调用、报文不可读，负载均衡也要额外处理。
:::

## 详细解析

### 工作方式

在 `.proto` 里定义 service 和 message，用 protoc 配合 `protoc-gen-go`、`protoc-gen-go-grpc` 两个插件生成代码：`xxx.pb.go` 是消息类型，`xxx_grpc.pb.go` 是客户端存根和服务端接口。服务端实现接口并注册到 `grpc.Server`，客户端用存根直接调用方法。请求被序列化成 protobuf 二进制，作为 HTTP/2 的一个流发送，一条连接上可以同时跑很多个调用（多路复用，见 [HTTP 各版本的区别](/basics/network/07-http-versions)）。常见做法是对外提供 REST，内部服务之间用 gRPC（REST 的设计见 [RESTful API 设计](/basics/network/17-restful)）。下面的 proto 省略了部分 message 的定义。

```text
syntax = "proto3";
package user.v1;
option go_package = "example.com/app/gen/user/v1;userv1";
service UserService {
  rpc GetUser(GetUserRequest) returns (User);               // 一元：一个请求一个响应
  rpc ListUsers(ListUsersRequest) returns (stream User);    // 服务端流：如分批推送查询结果
  rpc UploadLogs(stream LogEntry) returns (UploadSummary);  // 客户端流：如上传大量日志后汇总
  rpc Chat(stream ChatMessage) returns (stream ChatMessage); // 双向流：如聊天、实时协同
}
message GetUserRequest { int64 id = 1; }
message User {
  int64 id = 1;
  string name = 2;
  reserved 3; reserved "email"; // 删除过的字段：编号和名字都保留，防止被复用
}
```

### 和 REST/JSON 对比

| | gRPC | REST + JSON |
| --- | --- | --- |
| 契约 | `.proto` 强类型，代码生成，改字段编译期就能发现 | 靠 OpenAPI 文档约定，不强制 |
| 编码 | protobuf 二进制，体积小、解析快 | JSON 文本，可读，体积和解析开销更大 |
| 流式 | 原生支持三种流 | 需要借助 SSE、WebSocket 等 |
| 传输和调试 | 必须 HTTP/2，调试要用 grpcurl 等专门工具 | HTTP/1.1、HTTP/2 都行，curl 就能调 |
| 浏览器 | 不能直接调用，要用 gRPC-Web 或 grpc-gateway 这类网关转成 HTTP/JSON | 直接调用 |

### 拦截器、deadline 和状态码

- **拦截器**相当于 gRPC 的中间件，分一元和流式两种，用 `grpc.ChainUnaryInterceptor` 串起来，适合做日志、鉴权、指标、panic 恢复。元数据（类似 HTTP header）用 `metadata.FromIncomingContext` 读取，key 一律是小写
- **deadline**：客户端用 `context.WithTimeout` 设置截止时间，gRPC 把剩余时间放进 `grpc-timeout` 请求头传给服务端，服务端的 ctx 带着同样的 deadline；服务端调用下游时把这个 ctx 传下去，整条链路共享一个截止时间，上游超时后下游也能及时停止
- **状态码**：服务端用 `status.Error(codes.NotFound, "...")` 返回错误，客户端用 `status.Code(err)` 取出状态码，常用的有 `InvalidArgument`、`NotFound`、`Unauthenticated`、`PermissionDenied`、`DeadlineExceeded`、`Unavailable`。正常情况下 HTTP 状态码都是 200，调用结果在 trailer 的 grpc-status 里

### 负载均衡的难点

gRPC 用 HTTP/2 长连接，所有请求复用少数几条连接。四层负载均衡（比如 K8s Service 默认的 kube-proxy）只在建立连接时选一次后端，之后请求全落在同一个 Pod 上，新扩容的实例也分不到流量（见 [K8s Service 和 Ingress](/basics/container/06-k8s-service-ingress)）。解决办法有两种：**客户端负载均衡**，通过 DNS（如 K8s 的 Headless Service）拿到所有后端地址，客户端对每个地址建连，按请求轮询（`round_robin` 策略）；或者用 **七层代理**，如 Envoy、支持 gRPC 的 Nginx 或服务网格，按请求而不是按连接转发。

## 代码示例

```go
package main

import (
	"context"
	"log"
	"net"
	"time"

	userv1 "example.com/app/gen/user/v1" // 上面的 proto 生成的包
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type userServer struct {
	userv1.UnimplementedUserServiceServer // 按值嵌入：未实现的方法返回 Unimplemented，proto 新增方法时也能编译
}

func (s *userServer) GetUser(ctx context.Context, req *userv1.GetUserRequest) (*userv1.User, error) {
	if req.GetId() <= 0 {
		return nil, status.Error(codes.InvalidArgument, "id must be positive")
	}
	return &userv1.User{Id: req.GetId(), Name: "alice"}, nil
}

func logging(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
	start := time.Now()
	resp, err := handler(ctx, req)
	log.Printf("%s code=%s cost=%s", info.FullMethod, status.Code(err), time.Since(start))
	return resp, err
}

func main() {
	lis, err := net.Listen("tcp", ":50051")
	if err != nil {
		log.Fatal(err)
	}
	s := grpc.NewServer(grpc.ChainUnaryInterceptor(logging)) // 加一个记录日志的一元拦截器
	userv1.RegisterUserServiceServer(s, &userServer{})
	log.Fatal(s.Serve(lis)) // 退出时可以调用 s.GracefulStop() 等待进行中的调用结束
}
```

```go
// 客户端关键片段（省略 import，insecure 来自 google.golang.org/grpc/credentials/insecure；演示用明文，生产环境用 TLS）
conn, err := grpc.NewClient("dns:///user-svc:50051",
	grpc.WithTransportCredentials(insecure.NewCredentials()),
	grpc.WithDefaultServiceConfig(`{"loadBalancingConfig":[{"round_robin":{}}]}`), // 按请求轮询
)
if err != nil {
	log.Fatal(err)
}
defer conn.Close() // ClientConn 并发安全，全局复用一个
client := userv1.NewUserServiceClient(conn)
ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
defer cancel()
user, err := client.GetUser(ctx, &userv1.GetUserRequest{Id: 42})
if err != nil {
	log.Printf("get user: code=%s", status.Code(err)) // 按状态码区分处理，DeadlineExceeded 表示超时
	return
}
log.Println("user:", user.GetName())
```

## 面试官可能追问

::: details proto 字段怎么改才能保持兼容？
线上传输只认字段编号，不认名字。新增字段用新编号，老代码会忽略不认识的字段；删除字段时用 `reserved` 把编号和名字都保留下来，**编号绝对不能复用**，否则旧数据会被按新字段的类型解析，出现静默的数据错乱；也不要改已有字段的类型。proto3 里标量字段等于默认值时不会被序列化，需要区分"没传"和"传了零值"时，用 `optional` 声明。
:::

::: details grpc.NewClient 和 grpc.Dial 有什么区别？
`Dial` 已被标记为废弃，推荐用 `NewClient`。NewClient 不做任何 I/O，第一次发起 RPC 时才建立连接；默认的名称解析方式也不同，NewClient 默认按 DNS 解析 target。两者返回的都是 `*grpc.ClientConn`，它内部管理连接和重连，应该长期复用。
:::

::: details 怎么做鉴权？
客户端把 token 放进元数据（`metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer ...")`，或者用 `grpc.WithPerRPCCredentials`），服务端在拦截器里用 `metadata.FromIncomingContext` 取出来校验，失败返回 `codes.Unauthenticated`。服务之间还可以用 mTLS 做双向身份认证。
:::

## 易错点

- 调用时不设 deadline：下游卡住时请求会一直挂着，占住 goroutine 和连接；每次调用都应该带上有超时的 ctx
- 每次请求都新建 ClientConn：频繁握手，开销很大，还会造成连接泄漏
