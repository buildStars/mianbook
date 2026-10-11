---
difficulty: 2
tags: [高频, 实践]
---

# Kubernetes 怎么做滚动发布和健康检查？

::: tip 一句话回答
健康检查靠三种探针：**readinessProbe** 失败时把 Pod 从 Service 的后端里摘掉，不重启；**livenessProbe** 失败时重启容器；**startupProbe** 用于启动慢的应用，成功之前其他两种探针不执行。Deployment 默认用**滚动更新**，由 `maxSurge`（最多多出几个 Pod）和 `maxUnavailable`（最多少几个可用 Pod）控制节奏，新 Pod 就绪后才继续替换，出问题用 `kubectl rollout undo` 回滚。要做到发布不丢请求，还要处理好**优雅终止**：Pod 从端点移除和 SIGTERM 是并行发生的，通常用 `preStop` 等几秒再退出。
:::

## 详细解析

### 三种探针

| | readinessProbe | livenessProbe | startupProbe |
| --- | --- | --- | --- |
| 问的是 | 现在能接流量吗 | 进程还活着吗，是不是卡死了 | 启动完成了吗 |
| 失败后果 | 从 Service 端点中移除，不重启 | kubelet 重启容器 | 超过失败次数后重启容器 |
| 典型检查 | 依赖是否初始化完成、是否在关闭中 | 进程内部的轻量检查，如事件循环是否响应 | 和 liveness 同一个接口，但给足启动时间 |

探针可以用 `httpGet`、`tcpSocket`、`exec` 或 `grpc` 四种方式。

**最常见的误用是在 liveness 里检查数据库、Redis 等依赖。** 依赖一抖动，所有 Pod 的 liveness 同时失败、同时重启，重启后又因为大量重连冲击依赖，形成级联故障。重启解决不了依赖的问题，liveness 只检查进程自身；依赖不可用时可以让 readiness 失败暂停接流量，但如果所有 Pod 共用同一个依赖，readiness 同时失败会让服务整体无端点，也要谨慎，很多时候更好的做法是应用内部降级。

### 滚动更新的节奏

```text
replicas: 4, maxSurge: 1, maxUnavailable: 0

旧 旧 旧 旧          开始
旧 旧 旧 旧 新(未就绪)  先多起 1 个新 Pod
旧 旧 旧 新          新 Pod 就绪后，删 1 个旧的
旧 旧 旧 新 新(未就绪)  ……循环，直到全部替换
```

- `maxSurge` 和 `maxUnavailable` 可以写数字或百分比，默认都是 25%
- `maxUnavailable: 0` 保证可用副本数不下降，代价是需要额外资源，发布也更慢
- readinessProbe 决定"新 Pod 就绪"的时机，没有 readiness 时容器一启动就被当作就绪，流量可能打到还没初始化完的进程上
- `minReadySeconds` 要求新 Pod 就绪后稳定一段时间才算可用；`progressDeadlineSeconds` 超时后发布会被标记为失败，但 Kubernetes 不会自动回滚

### 优雅终止

Pod 被删除时，有两件事**同时**开始：

1. 控制平面把这个 Pod 在 EndpointSlice 里标记为终止中、不再就绪（`ready: false`），各节点的 kube-proxy、Ingress Controller 陆续更新转发规则，这需要一点时间
2. kubelet 先执行 `preStop` 钩子（如果有），然后给容器发 SIGTERM；超过 `terminationGracePeriodSeconds`（默认 30 秒，从 Pod 进入终止状态开始计时，包含 preStop 的时间；preStop 超时只会额外宽限 2 秒）还没退出就发 SIGKILL

如果应用一收到 SIGTERM 就立刻关闭，转发规则可能还没更新完，仍有请求被发过来，结果就是发布时出现少量连接失败。常见做法是在 `preStop` 里等待几秒，让摘流量先完成，再让应用开始优雅关闭（停止接收新连接、处理完进行中的请求、释放资源）。应用侧的写法见 [Node.js 服务怎么处理异常](/basics/node/07-error-handling)。

### 蓝绿和金丝雀

- **蓝绿发布**：新旧两套完整环境同时存在，验证完新环境后一次性切换流量，回滚就是切回去。代价是资源翻倍
- **金丝雀发布**：先把少量流量（按比例或按用户、请求头）导向新版本，观察指标没问题再逐步放大。原生 Deployment 只能靠调整新旧两组副本数粗略控制比例，精细的流量控制一般借助 Ingress Controller、Gateway API、服务网格，或 Argo Rollouts 这类工具

## 代码示例

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      terminationGracePeriodSeconds: 45
      containers:
        - name: web
          image: registry.example.com/web:1.4.3
          ports:
            - containerPort: 3000
          startupProbe:              # 最多给 30 × 2 = 60 秒启动时间
            httpGet: { path: /healthz, port: 3000 }
            periodSeconds: 2
            failureThreshold: 30
          livenessProbe:             # 只检查进程自身，不检查数据库
            httpGet: { path: /healthz, port: 3000 }
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:            # 关闭过程中也让它返回失败
            httpGet: { path: /ready, port: 3000 }
            periodSeconds: 5
          lifecycle:
            preStop:
              exec:                  # 等摘流量完成；镜像里要有 sleep 命令
                command: ["sleep", "5"]
```

较新的 Kubernetes 版本也支持 `preStop.sleep.seconds` 这种不依赖镜像里 `sleep` 命令的写法。

```bash
kubectl set image deployment/web web=registry.example.com/web:1.4.4
kubectl rollout status deployment/web           # 等待发布完成
kubectl rollout history deployment/web          # 查看历史版本
kubectl rollout undo deployment/web             # 回滚到上一个版本
kubectl rollout undo deployment/web --to-revision=3
kubectl rollout pause deployment/web            # 暂停，可用于手动观察
```

## 面试官可能追问

::: details 发布到一半新版本报错了，会自动停下来吗？
新 Pod 的 readiness 一直不通过，滚动更新就不会继续删旧 Pod（在 `maxUnavailable` 允许的范围内），服务仍由旧版本提供。超过 `progressDeadlineSeconds` 后 Deployment 状态会标记为失败，但需要人或 CI 执行 `rollout undo`。如果新版本能通过探针但业务有问题，滚动更新会照常完成，所以要配合监控和金丝雀。
:::

::: details liveness 和 readiness 能用同一个接口吗？
可以但不推荐完全一样。常见做法是 liveness 只返回进程是否正常，readiness 还要考虑是否完成初始化、是否正在关闭。liveness 的失败阈值也要设得宽松一些，避免在 GC 停顿、短暂高负载时误杀。
:::

::: details 回滚会回滚 ConfigMap 吗？
不会。`rollout undo` 只回滚 Deployment 的 Pod 模板，也就是切回旧的 ReplicaSet。ConfigMap、Secret 是独立对象，如果新版本同时改了配置，要单独恢复，或者把配置做成带版本号的不可变对象，见 [配置和密钥怎么管理](/basics/container/09-k8s-config)。
:::

## 易错点

- liveness 检查外部依赖，依赖一抖动全部 Pod 被重启
- 没有 readinessProbe，新 Pod 还没准备好就开始接流量
- 收到 SIGTERM 立刻退出，忽略了摘流量和 SIGTERM 是并行的
- `preStop` 加应用关闭时间超过了 `terminationGracePeriodSeconds`，最后被 SIGKILL
