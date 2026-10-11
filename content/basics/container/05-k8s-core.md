---
difficulty: 2
tags: [高频, 原理]
---

# Kubernetes 的核心概念有哪些？Pod、Deployment、Service 是什么关系？

::: tip 一句话回答
Kubernetes 是**声明式**的：你把期望状态写成 YAML 交给 API Server，各个控制器不断对比实际状态和期望状态并做调整（**调谐循环**）。**Pod** 是最小的调度单位，包含一个或多个共享网络和存储的容器；**Deployment** 管理 **ReplicaSet**，ReplicaSet 保证指定数量的 Pod 副本在运行，Deployment 在此基础上负责滚动更新和回滚；Pod 会被重建、IP 会变，**Service** 用**标签选择器**选中一组 Pod，提供稳定的访问地址并做负载均衡。
:::

## 详细解析

### 集群架构

```text
控制平面
  kube-apiserver       所有组件和 kubectl 的唯一入口，负责认证、鉴权、校验，读写 etcd
  etcd                 分布式键值存储，保存集群的全部状态
  kube-scheduler       给还没分配节点的 Pod 选择合适的节点
  kube-controller-manager  运行各种控制器（Deployment、ReplicaSet、Node 等）

工作节点（每个节点都有）
  kubelet              接收分配到本节点的 Pod，调用容器运行时启动容器，执行探针，上报状态
  kube-proxy           根据 Service 配置节点上的转发规则（部分网络插件会替代它）
  容器运行时             如 containerd，真正负责拉镜像和运行容器
```

各组件之间不直接互相调用，都通过 API Server 读写资源对象、监听（watch）变化。etcd 用 Raft 保证一致性，见 [Raft 共识算法](/basics/distributed/10-raft)。

### 声明式和调谐循环

以创建一个 3 副本的 Deployment 为例：

1. `kubectl apply` 把 Deployment 提交给 API Server，存入 etcd
2. Deployment 控制器发现新对象，创建对应的 ReplicaSet
3. ReplicaSet 控制器发现实际 Pod 数是 0、期望是 3，创建 3 个 Pod（此时还没有分配节点）
4. 调度器为每个 Pod 选择节点，把结果写回 API Server
5. 对应节点的 kubelet 发现分配给自己的 Pod，启动容器并上报状态

之后某个 Pod 所在节点宕机，ReplicaSet 控制器发现实际只有 2 个，会再创建 1 个。你不用写"怎么做"，只描述"要什么"，系统负责持续收敛到这个状态。

### Pod、Deployment、ReplicaSet、Service

```text
Deployment (web)            负责发布策略、版本历史
   └─ ReplicaSet (web-<hash>)   负责维持副本数，每个版本一个
        ├─ Pod  labels: app=web
        ├─ Pod  labels: app=web
        └─ Pod  labels: app=web
                 ▲
Service (web)  selector: app=web  → 稳定的 ClusterIP 和 DNS 名
```

- **Pod**：同一个 Pod 里的容器共享网络命名空间（可以用 `localhost` 互访）和挂载的卷，一起被调度到同一个节点。一般一个 Pod 只跑一个主容器，日志采集、代理这类辅助容器作为 sidecar 放进去
- **ReplicaSet**：一般不直接创建。更新镜像时，Deployment 新建一个 ReplicaSet 并逐步扩容它、缩容旧的，旧 ReplicaSet 保留下来用于回滚
- **Service**：Pod 随时可能被重建、换 IP，客户端不能直接记 Pod IP。Service 按标签选择当前就绪的 Pod，提供不变的虚拟 IP 和 DNS 名。Service 的类型见 [Service 有哪些类型](/basics/container/06-k8s-service-ingress)

标签（labels）是这些对象之间唯一的关联方式：Deployment 用 `selector` 认领自己的 Pod，Service 也用 `selector` 找到后端。

## 代码示例

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 3
  selector:
    matchLabels:
      app: web            # 必须和下面 Pod 模板的 labels 匹配
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: registry.example.com/web:1.4.2   # 用明确的版本标签，不要用 latest
          ports:
            - containerPort: 3000
---
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web              # 选中带这个标签的 Pod
  ports:
    - port: 80            # Service 自身的端口
      targetPort: 3000    # 转发到 Pod 的端口
```

```bash
kubectl apply -f web.yaml
kubectl get deploy,rs,pods -l app=web
kubectl get endpointslices -l kubernetes.io/service-name=web   # 查看 Service 当前选中的 Pod
```

## 面试官可能追问

::: details 为什么最小调度单位是 Pod，而不是容器？
有些容器必须紧密协作：共享网络、共享文件目录、一起被调度和销毁，比如应用容器加日志采集 sidecar。Pod 把它们打包成一个整体，Kubernetes 只需要调度 Pod。每个 Pod 有一个独立的 IP，Pod 内的容器通过 `localhost` 通信。
:::

::: details Deployment 和 StatefulSet 有什么区别？
Deployment 的 Pod 是可以互相替换的，名字随机，适合无状态服务。StatefulSet 给每个 Pod 固定的序号名称和稳定的网络标识，每个 Pod 可以绑定自己的持久卷，按顺序创建和删除，适合数据库、消息队列等有状态服务。此外还有 DaemonSet（每个节点一个，如日志采集）和 Job / CronJob（一次性或定时任务）。
:::

::: details 直接 kubectl edit 改线上配置有什么问题？
集群里的状态和 Git 里的 YAML 不一致，下次 apply 可能把修改覆盖掉，也没有审计记录。生产中一般把 YAML 放在 Git 里，通过 CI 或 GitOps 工具（如 Argo CD、Flux）同步到集群，集群状态以仓库为准。
:::

## 易错点

- 认为 Service 转发给 Deployment，其实 Service 只认标签，和 Deployment 没有直接关系
- Deployment 的 `selector` 和 Pod 模板的 `labels` 对不上，apply 时会被拒绝
- 直接创建裸 Pod，节点故障后不会有人重建它
- 把 kube-proxy 当成流量经过的代理，实际上它只负责配置节点上的转发规则
