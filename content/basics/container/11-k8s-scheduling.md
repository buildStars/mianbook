---
difficulty: 2
tags: [高频, 原理]
---

# Kubernetes 怎么决定 Pod 调度到哪个节点？亲和性和污点容忍怎么用？

::: tip 一句话回答
kube-scheduler 对每个待调度的 Pod 做两步：**过滤**掉资源不够、不满足约束的节点，再对剩下的节点**打分**，选分最高的绑定。人为干预有两个方向：**亲和性**是 Pod 主动"想去哪"（nodeSelector、节点亲和性、Pod 亲和与反亲和），**污点和容忍**是节点"拒绝谁"，只有带了对应容忍的 Pod 才能上去。想让 Pod 均匀分布在各个可用区，用**拓扑分布约束**。
:::

## 详细解析

### 调度流程

1. 新建的 Pod 没有 `spec.nodeName`，进入调度队列
2. **过滤（Filter）**：去掉不能运行它的节点，比如剩余资源小于 Pod 的 requests、端口冲突、不满足节点亲和性、有它不容忍的污点
3. **打分（Score）**：给剩下的节点打分，考虑资源均衡、镜像是否已在本地、偏好型亲和性等
4. **绑定（Bind）**：把节点名写回 Pod，节点上的 kubelet 看到后拉起容器

过滤后一个节点都不剩，Pod 就停在 Pending，`kubectl describe pod` 的 Events 会写明多少个节点因为什么原因被排除（排查见 [Pod 起不来怎么排查](/basics/container/10-k8s-troubleshoot)）。调度只看 **requests**，不看节点的实际使用量，requests 的含义见 [requests 和 limits](/basics/container/08-k8s-resources)。

### 亲和性：Pod 想去哪

| 方式 | 作用 | 典型用法 |
| --- | --- | --- |
| nodeSelector | 只能调度到带指定标签的节点 | 简单场景，如 `disktype: ssd` |
| 节点亲和性 nodeAffinity | 同上，但支持 In、NotIn、Exists 等表达式，分硬性和偏好 | GPU 任务只上 GPU 节点 |
| Pod 亲和性 podAffinity | 靠近带某标签的 Pod | 应用和它的缓存放在同一可用区 |
| Pod 反亲和性 podAntiAffinity | 远离带某标签的 Pod | 同一服务的副本分散到不同节点 |

硬性规则写在 `requiredDuringSchedulingIgnoredDuringExecution`，不满足就不调度；偏好规则写在 `preferredDuringSchedulingIgnoredDuringExecution`，只影响打分，带 1～100 的权重。名字里的 `IgnoredDuringExecution` 表示：Pod 跑起来之后节点标签变了，不会把它赶走。

### 污点和容忍：节点拒绝谁

污点打在节点上，effect 有三种：

- `NoSchedule`：不容忍的 Pod 不会被调度上来，已经在上面的不受影响
- `PreferNoSchedule`：尽量不调度上来，实在没地方也可以
- `NoExecute`：不调度，而且已经在跑的不容忍的 Pod 会被驱逐；容忍里可以用 `tolerationSeconds` 设定还能待多久

```bash
# 给 GPU 节点打污点：普通 Pod 不会被调度上来
kubectl taint nodes gpu-node-1 gpu=true:NoSchedule
# 去掉污点：末尾加减号
kubectl taint nodes gpu-node-1 gpu=true:NoSchedule-
```

容忍只是"允许上去"，不是"必须上去"。想让 GPU 任务**只**跑在 GPU 节点、普通 Pod 又进不来，要污点和节点亲和性一起用。控制面节点默认带 `node-role.kubernetes.io/control-plane:NoSchedule`，所以业务 Pod 不会被调度上去；节点 NotReady 时系统会自动加 `NoExecute` 污点，触发驱逐。

### 拓扑分布约束

反亲和只能表达"不要在一起"，节点多时控制不了均匀程度。`topologySpreadConstraints` 直接限制各拓扑域（节点、可用区）之间 Pod 数量的最大差值 `maxSkew`。

## 代码示例

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: trainer
spec:
  replicas: 3
  selector:
    matchLabels:
      app: trainer
  template:
    metadata:
      labels:
        app: trainer
    spec:
      # 容忍 GPU 节点的污点
      tolerations:
        - key: gpu
          operator: Equal
          value: "true"
          effect: NoSchedule
      affinity:
        # 硬性：只去带 GPU 标签的节点
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: accelerator
                    operator: In
                    values: ["nvidia"]
      # 各可用区的副本数最多差 1
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: trainer
      containers:
        - name: trainer
          image: example/trainer:1.0
```

## 面试官可能追问

::: details 同一个服务的多个副本，怎么保证不在同一台机器上？
用 Pod 反亲和性，`labelSelector` 选中自己服务的标签，`topologyKey` 设为 `kubernetes.io/hostname`。用硬性规则时副本数不能超过节点数，否则多出来的会 Pending；所以常用偏好规则，或者改用拓扑分布约束，`maxSkew: 1` 配合 `whenUnsatisfiable: ScheduleAnyway`。
:::

::: details Pod 亲和性为什么在大集群里要慎用？
Pod 间亲和和反亲和需要在调度时检查其他 Pod 的分布，计算量随集群规模增长，官方文档提醒它在几百个节点以上的集群里会明显拖慢调度。能用节点标签或拓扑分布约束表达的，优先用它们。
:::

::: details 节点要下线维护，怎么把上面的 Pod 迁走？
先 `kubectl cordon` 标记节点不可调度，再 `kubectl drain` 驱逐上面的 Pod（DaemonSet 的 Pod 要加 `--ignore-daemonsets`）。驱逐会遵守 PodDisruptionBudget，保证服务同时被赶走的副本不超过设定值。维护完 `kubectl uncordon` 恢复。
:::

::: details 已经在跑的 Pod，节点标签变了会被重新调度吗？
不会。调度只发生在 Pod 创建时，亲和性名字里的 `IgnoredDuringExecution` 就是这个意思。想让分布重新平衡，要删 Pod 让控制器重建，或者用社区的 descheduler 这类组件定期驱逐不合理的 Pod。
:::

## 易错点

- 以为加了容忍 Pod 就会去那个节点。容忍只解除限制，定向调度还得靠节点亲和性
- 调度按 requests 算，不看实际负载；没写 requests 的 Pod 会被当成几乎不占资源，导致节点超卖
- `NoSchedule` 不会赶走已经在跑的 Pod，要驱逐得用 `NoExecute`
- 硬性反亲和加上副本数大于节点数，多出来的副本会一直 Pending
