---
difficulty: 2
tags: [高频, 原理]
---

# Kubernetes 的 HPA 是怎么自动扩缩容的？

::: tip 一句话回答
HPA（HorizontalPodAutoscaler）是一个控制循环：定期从 **metrics-server**（或自定义指标接口）取指标，按公式 **期望副本数 = ceil(当前副本数 × 当前指标值 / 目标值)** 算出副本数，再改 Deployment 的 replicas。CPU 利用率是相对 **requests** 算的，所以没设 requests 就没法按 CPU 扩缩。为了防止来回抖动，有 10% 的容忍度，缩容默认还要过 **5 分钟的稳定窗口**。
:::

## 详细解析

### 工作流程

```text
metrics-server ──(资源指标 API)──┐
Prometheus Adapter ──(自定义指标 API)──┤
                                       ▼
                      HPA 控制器（默认每 15 秒一轮）
                                       │ 计算期望副本数
                                       ▼
                    Deployment / StatefulSet 的 scale 子资源
```

1. metrics-server 从各节点的 kubelet 收集 Pod 的 CPU、内存用量
2. HPA 控制器取出目标工作负载所有 Pod 的指标，求平均值
3. 按公式算期望副本数，限制在 `minReplicas` 和 `maxReplicas` 之间
4. 更新工作负载的副本数，扩容的 Pod 怎么调度见 [Pod 调度](/basics/container/11-k8s-scheduling)

### 副本数怎么算

举个例子（假设值）：目标 CPU 利用率 50%，当前 4 个副本，平均利用率 80%。

- 期望副本数 = ceil(4 × 80 / 50) = ceil(6.4) = 7
- 利用率是相对 requests 的：requests 是 500m，实际用了 400m，就是 80%
- 比值在 1 ± 0.1 以内（默认容忍度）不做调整，避免小波动引起扩缩
- 配了多个指标时，每个指标各算一个副本数，取**最大值**

指标缺失的 Pod 会被特殊处理，让结果偏保守：如果算出来要扩容，按它们用了目标值的 0% 算；要缩容，按 100% 算。还没就绪的 Pod 在扩容时也按 0% 算。重新计算后如果方向反转或落进容忍度内，就不调整。

### 防抖：behavior

流量有毛刺时，副本数跟着来回变是很糟糕的。`autoscaling/v2` 的 `behavior` 字段可以分别控制扩容和缩容：

- **稳定窗口** `stabilizationWindowSeconds`：缩容时取窗口内算出的最大推荐值，默认 300 秒，等于"高负载过去 5 分钟后才缩"；扩容默认 0，立刻扩
- **速率策略** `policies`：比如每 60 秒最多缩掉 10% 的副本，或者每 15 秒最多扩 4 个

### 指标类型

| 类型 | 例子 | 来源 |
| --- | --- | --- |
| Resource | CPU、内存利用率 | metrics-server |
| Pods | 每个 Pod 的 QPS、队列长度 | 自定义指标 API，比如 Prometheus Adapter |
| Object | Ingress 的总请求量 | 自定义指标 API |
| External | 云上消息队列的积压数 | 外部指标 API |

内存不太适合做扩缩指标：很多运行时（JVM、Node.js）内存涨上去后不会立刻还回去，扩了之后平均值也降不下来。按业务指标（QPS、队列积压）扩缩往往比 CPU 更准，事件驱动的场景也可以用 KEDA 这类基于 HPA 的组件。

## 代码示例

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 50   # 相对 requests 的百分比
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60          # 每分钟最多缩 10%
    scaleUp:
      policies:
        - type: Pods
          value: 4
          periodSeconds: 15          # 每 15 秒最多扩 4 个
```

也可以用命令快速创建：`kubectl autoscale deployment web --cpu-percent=50 --min=2 --max=20`。

## 面试官可能追问

::: details HPA、VPA、Cluster Autoscaler 有什么区别？
HPA 调 Pod 的**数量**；VPA 调单个 Pod 的 **requests 和 limits**，适合不好水平扩展的服务；Cluster Autoscaler 调**节点数量**，有 Pod 因资源不足 Pending 时加节点，节点长期空闲时减节点。三者常常配合：HPA 扩出 Pod，节点不够时 Cluster Autoscaler 补节点。HPA 和 VPA 不要在同一个 CPU 或内存指标上同时用，会互相打架。
:::

::: details 为什么 HPA 扩容了，服务还是扛不住突发流量？
扩容有一连串延迟：指标采集周期、HPA 的计算周期、Pod 调度、拉镜像、应用启动、就绪探针通过，加起来可能是分钟级，节点不够还要等新节点。应对办法：`minReplicas` 留足余量，提前按计划扩容，缩短启动时间，配好[就绪探针](/basics/container/07-k8s-probes-rollout)，入口加限流兜住扩容完成前的那段时间。
:::

::: details 用了 HPA，Deployment 的 YAML 里还要写 replicas 吗？
最好不写。每次 `kubectl apply` 都会把 replicas 改回 YAML 里的值，覆盖 HPA 算出的结果，造成副本数突然跳变。用 GitOps 工具时也要让它忽略这个字段。
:::

## 易错点

- 容器没设 CPU requests，HPA 按利用率算不出值，状态里会显示 unknown，根本不会扩缩
- 以为缩容会马上发生。默认有 5 分钟的稳定窗口，压测结束后副本数不会立刻降
- 多指标时取的是各指标算出副本数的最大值，不是平均值
- 没装 metrics-server，`kubectl top` 和基于 CPU 的 HPA 都用不了
