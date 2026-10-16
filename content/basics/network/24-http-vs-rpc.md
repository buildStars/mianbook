---
difficulty: 2
tags: [高频]
---

# HTTP 和 RPC 有什么区别？有了 HTTP 为什么还要 RPC？

::: tip 一句话回答
两者不在一个层面：**HTTP 是应用层协议**，**RPC 是一种调用方式**，目标是让调用远程服务像调用本地函数一样。RPC 框架可以基于自定义的 TCP 协议，也可以直接跑在 HTTP 上（例如 **gRPC 基于 HTTP/2**）。内部服务之间常用 RPC，是因为它的**二进制序列化**更紧凑、**长连接复用**效率高，还自带**服务发现、负载均衡、超时重试**这些治理能力。对外开放的接口一般还是用 HTTP/REST，通用、好调试。
:::

## 详细解析

### RPC 是什么

RPC（Remote Procedure Call）关心的是"调用"这个抽象：调用方拿到一个本地代理对象（stub），调用它的方法，框架负责把方法名和参数序列化、通过网络发出去、等结果回来再反序列化。

```text
调用方                                       服务方
userService.getUser(1)
  └► stub：序列化 { method, args } ──网络──► 反序列化 → 找到实现 → 执行
       等待响应 ◄────────────────────网络── 序列化返回值
  ◄─ 返回 User 对象
```

一个 RPC 框架通常包含：接口定义（IDL，例如 Protobuf 的 `.proto` 文件）、序列化协议、传输协议、服务注册发现、负载均衡、容错。传输协议只是其中一环，所以说"RPC 和 HTTP 哪个好"本身就是错位比较。

### 有了 HTTP 为什么还要 RPC

这里的 HTTP 一般指"HTTP/1.1 + JSON"的 REST 接口。内部调用量大、链路长时，RPC 的优势主要在这几点：

| 维度 | HTTP/1.1 + JSON | 典型 RPC 框架 |
| --- | --- | --- |
| 序列化 | 文本 JSON，字段名每次都传，解析慢 | Protobuf、Thrift 等二进制格式，体积小，编解码快 |
| 协议头 | 文本头部，冗余较多 | 精简的二进制头，或 HTTP/2 的头部压缩 |
| 连接 | keep-alive 可复用，但一条连接同一时刻只处理一个请求 | 长连接 + 多路复用，一条连接并发处理多个请求 |
| 接口约束 | 靠文档约定，字段错了运行时才发现 | IDL 生成客户端代码，有类型检查 |
| 服务治理 | 要自己接注册中心、网关、重试 | 框架自带发现、负载均衡、超时、熔断 |
| 通用性 | 浏览器、任何语言、curl 都能直接调 | 要引入框架或生成代码，调试要专门工具 |

HTTP 各版本连接模型的差异见 [HTTP/1.0、1.1、2、3 有什么区别](/basics/network/07-http-versions)。

另一方面，RPC 的历史比 HTTP 还早，很多公司在 HTTP/2 出现之前就有了自己的 RPC 协议，一直沿用下来。

### gRPC：跑在 HTTP 上的 RPC

gRPC 把 HTTP/2 当传输层：方法名对应请求路径（`/包名.服务名/方法名`），消息体用 Protobuf 编码，利用 HTTP/2 的多路复用和流实现双向流式调用。它说明 HTTP 和 RPC 可以组合，而不是二选一。Go 里的具体用法见 [gRPC](/basics/go/18-grpc)。

### 常见架构

```text
浏览器 / App / 第三方 ──HTTP REST──► API 网关 / BFF ──RPC──► 用户服务
                                                     └─RPC──► 订单服务 ──RPC──► 库存服务
```

对外用 HTTP，兼容性好，方便鉴权、限流、缓存和调试，设计规范见 [RESTful API 设计](/basics/network/17-restful)。对内用 RPC，追求性能和强类型约束。团队小、调用量不大时，内部也全用 HTTP + JSON 完全没问题，引入 RPC 框架本身有学习和运维成本。

## 代码示例

用 Protobuf 定义接口，再由工具生成各语言的客户端和服务端代码：

```text
syntax = "proto3";

package user;

service UserService {
  rpc GetUser (GetUserRequest) returns (User);
}

message GetUserRequest {
  int64 id = 1;
}

message User {
  int64 id = 1;
  string name = 2;
}
```

字段后面的数字是字段编号，编码时只传编号不传字段名，这是它比 JSON 省空间的原因之一。

## 面试官可能追问

::: details RPC 调用和本地调用真的一样吗？
不一样。网络会超时、丢包、对方会宕机，一次调用可能"执行了但响应丢了"，所以要设置超时、考虑重试是否安全（接口要幂等）、处理部分失败。把远程调用当成本地调用随便循环调，很容易拖垮下游。
:::

::: details 浏览器能直接调 gRPC 吗？
不能直接调。浏览器的 API 没法精细控制 HTTP/2 帧和 trailer，所以要用 gRPC-Web，经过一层代理转换；或者网关把 gRPC 转成 HTTP/JSON 对外提供。
:::

::: details 怎么选 RPC 框架？
看技术栈和治理需求：多语言团队倾向 gRPC 这种跨语言、基于 IDL 的方案；纯 Java 体系可以选 Dubbo 这类自带服务治理的框架。还要考虑是否和现有注册中心、监控、链路追踪集成，链路追踪的原理见 [分布式链路追踪](/basics/distributed/18-tracing)。
:::

## 易错点

- RPC 不是一种协议，是一种调用模型，底层可以用 TCP 自定义协议，也可以用 HTTP
- "RPC 比 HTTP 快"不准确，快的是二进制序列化和多路复用；HTTP/2 + Protobuf 一样可以很快
- HTTP/1.1 的 keep-alive 也能复用连接，差别在于同一条连接上不能并发处理多个请求
