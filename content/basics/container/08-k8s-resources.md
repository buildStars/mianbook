---
difficulty: 2
tags: [高频, 原理, 实践]
---

# Kubernetes 的 requests 和 limits 是什么？OOMKilled 怎么排查？

::: tip 一句话回答
**requests** 是给调度器看的"预订量"，调度器只把 Pod 放到剩余可分配资源够 requests 的节点上；**limits** 是运行时的硬上限，靠 cgroups 执行。CPU 是可压缩资源，超过 limit 只会被**限流（throttling）**变慢；内存不可压缩，超过 limit 进程会被内核 **OOMKill**，状态显示 `OOMKilled`、退出码 137。根据 requests 和 limits 的设置，Pod 分为 **Guaranteed、Burstable、BestEffort** 三个 QoS 等级，节点资源紧张时 BestEffort 最先被驱逐。排查 OOM 先 `kubectl describe pod` 看上次终止原因，再 `kubectl logs --previous` 看崩溃前的日志，最后结合监控判断是限额太小还是内存泄漏。
:::

## 详细解析

### requests 和 limits 各管什么

| | requests | limits |
| --- | --- | --- |
| 作用阶段 | 调度时 | 运行时 |
| 含义 | 保证能拿到的量，节点按它做"记账" | 能用的上限 |
| CPU | 资源争抢时按 requests 的比例分配 CPU 时间 | 超过后在每个调度周期内被限流，进程变慢但不会被杀 |
| 内存 | 节点内存紧张时，用量超过 requests 的 Pod 更容易被驱逐 | 超过后容器内进程被 OOMKill，kubelet 按重启策略重启 |

单位：CPU 的 `1` 表示一个核，`500m` 表示半个核；内存用 `Mi`、`Gi`（二进制单位），注意 `M` 和 `Mi` 不同，小写 `m` 用在内存上表示的是"千分之一字节"，是常见的笔误。

调度只看 requests 的总和，不看实际用量。requests 设得太小，节点会被塞进太多 Pod，运行时互相争抢；设得太大，资源利用率低。CPU limit 设得过低会导致严重的延迟抖动，所以不少团队对在线服务只设 CPU requests、不设 CPU limit，内存则一定要设 limit。

### QoS 等级和驱逐顺序

| QoS | 条件 | 节点压力下 |
| --- | --- | --- |
| Guaranteed | 每个容器都设置了 CPU 和内存的 requests 和 limits，并且两者相等 | 最后被驱逐 |
| Burstable | 不满足 Guaranteed，但至少一个容器设置了 CPU 或内存的 requests 或 limits | 用量超过 requests 越多越先被驱逐 |
| BestEffort | 所有容器都没有设置 requests 和 limits | 最先被驱逐 |

驱逐（Evicted）和 OOMKilled 是两回事：OOMKilled 是容器超过自己的内存 limit，被内核杀掉，Pod 原地重启容器；驱逐是节点整体资源不足，kubelet 主动终止整个 Pod，需要由控制器在别处重建。kubelet 实际按"用量是否超过 requests、Pod 优先级、超出 requests 的程度"排序，并不直接看 QoS 等级，QoS 只是一个直观的近似。

### 进程要感知容器的内存限制

容器里读 `/proc/meminfo` 看到的是宿主机内存，不感知 cgroup 的运行时会按宿主机内存来设置堆大小，堆还没到上限，容器就先被 OOMKill 了。

- **Node.js**：V8 的堆上限只覆盖 JS 对象，Buffer、原生模块的内存在堆外。用 `--max-old-space-size`（单位 MB）显式设置，一般留出堆外内存的余量，比如设为 limit 的七成左右（经验值，要结合监控调整）
- **Java**：新版本 JVM 默认能识别容器限制，用 `-XX:MaxRAMPercentage` 按比例设置堆大小，同样要给元空间、线程栈、直接内存留余量

Node.js 内存泄漏本身的排查方法见 [Node.js 内存泄漏怎么排查](/basics/node/08-memory-leak)。

### HPA 自动扩缩容

HorizontalPodAutoscaler 根据指标调整 Deployment 的副本数。按 CPU 利用率扩缩时，利用率是**相对 requests** 计算的，所以没有设置 requests 的 Pod 无法按 CPU 利用率扩缩。HPA 需要集群里部署 metrics-server 这类指标来源，也可以接入自定义指标（如队列长度、QPS）。

## 代码示例

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 2
  selector:
    matchLabels: { app: api }
  template:
    metadata:
      labels: { app: api }
    spec:
      containers:
        - name: api
          image: registry.example.com/api:2.0.1
          env:
            - name: NODE_OPTIONS
              value: "--max-old-space-size=700"   # 堆上限小于内存 limit，给堆外内存留余量
          resources:
            requests:
              cpu: 500m
              memory: 1Gi
            limits:
              memory: 1Gi       # 内存 requests = limits：用量不会超过 requests，节点内存紧张时排在驱逐顺序后面
                                # 没设 CPU limit，所以这个 Pod 的 QoS 是 Burstable，不是 Guaranteed
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70   # 相对 requests 的 70%
```

```bash
kubectl get pods                                 # RESTARTS 在增加
kubectl describe pod api-xxx                     # Last State: Terminated, Reason: OOMKilled, Exit Code: 137
kubectl logs api-xxx --previous                  # 上一次崩溃前的日志
kubectl top pod api-xxx --containers             # 当前用量，需要 metrics-server
kubectl get events --field-selector involvedObject.name=api-xxx
kubectl describe node <节点名>                   # Allocated resources，查看节点上 requests 的分配情况
```

## 面试官可能追问

::: details 退出码 137 一定是 OOMKilled 吗？
137 表示进程被 SIGKILL 杀死（128 + 9）。除了 OOM，超过优雅终止时间被强杀、被人手动 kill 也是 137。要以 `describe` 里的 `Reason: OOMKilled` 为准。另外容器里有多个进程时，内核可能只杀掉其中占内存最多的子进程，主进程没退出，Pod 状态里就看不到 OOMKilled，要看节点的内核日志或监控里的 OOM 事件。较新版本的 Kubernetes 在 cgroup v2 节点上默认让一次 OOM 杀掉整个容器的所有进程，具体取决于版本和 kubelet 配置。
:::

::: details 怎么区分是 limit 设小了还是内存泄漏？
看监控里的内存曲线：启动后很快涨到一个平台、偶尔碰到 limit，多半是 limit 不够或流量峰值导致；随时间持续上涨、重启后又从低位开始涨，是泄漏的典型特征。泄漏要在应用侧抓堆快照分析，单纯调大 limit 只是推迟 OOM。
:::

::: details CPU throttling 怎么发现？
CPU 使用率看起来没到 limit，但接口延迟有明显毛刺，就要怀疑限流。cgroup 的 `cpu.stat` 里有被限流的周期数和时间，监控系统通常会采集为 throttled 相关的指标。原因是 limit 按很短的周期计算配额，多线程程序可能在周期开头就把配额用完，剩下的时间只能等待。
:::

## 易错点

- 把 requests 理解为"最低用量"或"上限"，它是调度时的预订量
- 以为 CPU 超过 limit 会被杀，实际是被限流；内存超过才会被杀
- 不设 requests，HPA 无法按 CPU 利用率扩缩，Pod 还会成为 BestEffort
- 混淆 OOMKilled 和 Evicted：前者是单个容器超限，后者是节点资源不足
