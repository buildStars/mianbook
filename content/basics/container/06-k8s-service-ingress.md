---
difficulty: 2
tags: [高频, 对比]
---

# Kubernetes 的 Service 有哪些类型？Ingress 是做什么的？

::: tip 一句话回答
Service 有四种类型：**ClusterIP**（默认，只在集群内可访问的虚拟 IP）、**NodePort**（在每个节点上开一个端口对外暴露）、**LoadBalancer**（由云厂商创建外部负载均衡器）、**ExternalName**（DNS 别名，指向集群外的域名）；另外把 `clusterIP` 设为 `None` 就是 **Headless Service**，DNS 直接返回各个 Pod 的 IP。Service 工作在四层。**Ingress** 是七层的路由规则，按**域名和路径**把 HTTP(S) 流量分发到不同 Service，并负责 TLS 终止，但它本身只是配置，必须部署 **Ingress Controller** 才会生效。
:::

## 详细解析

### Service 的类型

| 类型 | 访问方式 | 典型用途 |
| --- | --- | --- |
| ClusterIP | 集群内通过虚拟 IP 或 DNS 名访问 | 服务之间的内部调用，最常用 |
| NodePort | `任意节点 IP:节点端口`，端口默认从 30000-32767 中分配 | 测试环境、自建机房接外部负载均衡器 |
| LoadBalancer | 云厂商分配的外部地址 | 云上直接对外暴露一个四层服务；它同样有 ClusterIP，默认还会分配 NodePort（可用 `allocateLoadBalancerNodePorts: false` 关闭） |
| ExternalName | DNS 返回一条 CNAME 记录，不做代理 | 让集群内用统一的服务名访问外部数据库等 |
| Headless（`clusterIP: None`） | DNS 返回所有就绪 Pod 的 IP，没有虚拟 IP、不做负载均衡 | StatefulSet、需要客户端自己选择后端的场景 |

ClusterIP 是一个"虚拟 IP"，没有网卡真正持有它。每个节点上的 kube-proxy 监听 Service 和 EndpointSlice 的变化，用 iptables、IPVS 等机制在节点上写好转发规则，把发往 ClusterIP 的包改写成某个后端 Pod 的 IP。有些网络插件（如基于 eBPF 的实现）会替代 kube-proxy 做这件事。

### 集群内 DNS

集群里的 DNS 服务（一般是 CoreDNS）会为每个 Service 生成记录，格式是 `<服务名>.<命名空间>.svc.<集群域名>`，集群域名默认是 `cluster.local`。同一命名空间内直接用服务名访问，如 `http://web`；跨命名空间用 `web.shop`。Headless Service 下，StatefulSet 的每个 Pod 还会有自己的记录，如 `mysql-0.mysql.db.svc.cluster.local`。DNS 本身的原理见 [DNS 解析过程](/basics/network/11-dns)。

### Ingress 和 Ingress Controller

每个对外服务都用一个 LoadBalancer，成本高，也没法按路径路由。Ingress 让多个服务共用一个入口：

- **按域名和路径路由**：`api.example.com` 转给 api 服务，`example.com/` 转给前端
- **TLS 终止**：证书放在 Secret 里，由 Ingress 引用
- **必须有 Controller**：Ingress 对象只是规则，要部署一个 Ingress Controller（例如基于 NGINX、Traefik、Envoy 的实现或云厂商提供的实现）来监听这些规则并真正转发流量，它本质是一个运行在集群里的 [反向代理](/basics/network/20-reverse-proxy)。`ingressClassName` 指定由哪个 Controller 处理

Ingress 的标准字段能力有限，限流、重写、灰度等功能往往靠各个 Controller 自己的注解，换实现时要重写。Kubernetes 官方现在推荐用 **Gateway API** 替代 Ingress：它把基础设施（Gateway）和路由规则（HTTPRoute 等）分开，表达能力更强、各实现之间更一致。Ingress API 已经冻结，不再增加新功能，但仍是稳定版、没有移除计划，存量项目大量在用。

### 外部流量到 Pod 的路径

```text
客户端
  │  DNS 解析 example.com
  ▼
云负载均衡器（LoadBalancer 类型的 Service，指向 Ingress Controller）
  │
  ▼
Ingress Controller Pod（七层：按 Host 和 Path 匹配，做 TLS 终止）
  │  按规则选中 Service，通常直接转发到它的后端 Pod IP
  ▼
Service web（ClusterIP，由 EndpointSlice 记录就绪的 Pod）
  │
  ▼
Pod web-xxx :3000
```

## 代码示例

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
spec:
  ingressClassName: nginx        # 由哪个 Ingress Controller 处理，名字取决于集群里的 IngressClass
  tls:
    - hosts: [example.com]
      secretName: example-com-tls   # 类型为 kubernetes.io/tls 的 Secret
  rules:
    - host: example.com
      http:
        paths:
          - path: /api
            pathType: Prefix     # 必填：Prefix、Exact 或 ImplementationSpecific
            backend:
              service:
                name: api
                port:
                  number: 80
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web
                port:
                  number: 80
```

## 面试官可能追问

::: details Service 的负载均衡对长连接有效吗？
kube-proxy 的转发是按连接选择后端的，一条 TCP 连接建立后就固定在一个 Pod 上。gRPC、HTTP/2 这类复用长连接的协议，请求会集中在少数 Pod 上。解决办法是在客户端做负载均衡（配合 Headless Service 拿到所有 Pod IP），或者使用能按请求分发的七层代理、服务网格。
:::

::: details NodePort 的流量为什么会多绕一跳？怎么保留客户端 IP？
请求打到节点 A 的 NodePort，后端 Pod 可能在节点 B，节点 A 会做一次 SNAT 转发过去，Pod 看到的源 IP 是节点 A 的。把 Service 的 `externalTrafficPolicy` 设为 `Local`，节点只转发给本节点上的 Pod，能保留客户端 IP，代价是没有本地 Pod 的节点不处理流量，负载可能不均衡。
:::

::: details Pod 访问 Service 的 DNS 名很慢或偶尔失败，可能是什么原因？
默认 DNS 策略下，kubelet 生成的 `/etc/resolv.conf` 带有 `ndots:5` 和多个搜索域。名字里的点少于 5 个时（大部分外部域名都是），解析器会先依次拼接各个搜索域去查，产生多次无效查询。可以在访问外部域名时写完整域名（末尾加点），或者调整 Pod 的 `dnsConfig`。另外 CoreDNS 副本不足、节点上的 conntrack 问题也会导致解析超时。
:::

## 易错点

- 创建了 Ingress 却没有部署 Ingress Controller，规则不会生效
- 以为 Service 能按 HTTP 路径路由，Service 只在四层转发
- 把 Headless Service 当成普通 Service，以为它会做负载均衡
- 长连接场景下以为 Service 能把请求均匀分到每个 Pod
