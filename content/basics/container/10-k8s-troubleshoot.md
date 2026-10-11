---
difficulty: 2
tags: [高频, 场景题, 实践]
---

# Pod 一直起不来怎么排查？CrashLoopBackOff、Pending 分别是什么原因？

::: tip 一句话回答
按固定顺序排查：`kubectl get pod` 看状态和重启次数 → `kubectl describe pod` 看**Events**和上次终止原因 → `kubectl logs --previous` 看上一次崩溃前的日志 → 能进去时用 `kubectl exec` 检查环境，进不去用 `kubectl debug` 加临时容器。**Pending** 说明还没调度成功，常见是资源不够、调度约束不满足、PVC 没绑定；**ImagePullBackOff** 是镜像拉不下来；**CrashLoopBackOff** 是容器启动后反复退出，Kubernetes 在重启之间等待的时间越来越长，原因多是启动报错、配置缺失或探针过严。
:::

## 详细解析

### 排查流程

```text
kubectl get pod -o wide        状态、重启次数、所在节点
        │
kubectl describe pod <pod>     Events（调度、拉镜像、探针失败）、Last State、Exit Code
        │
kubectl logs <pod> --previous  上一次运行的日志（当前容器刚重启，日志可能是空的）
        │
kubectl exec -it <pod> -- sh   检查配置文件、环境变量、网络连通性
        │
kubectl debug                  镜像里没有 shell 或容器起不来时，用临时容器排查
```

Events 只保留一段时间（由 kube-apiserver 的 `--event-ttl` 控制，默认 1 小时），过期后 `describe` 里就看不到了，所以要尽早看，或者把事件采集到日志系统里。

### 常见状态和原因

| 状态 | 含义 | 常见原因 | 先看哪里 |
| --- | --- | --- | --- |
| Pending | 还没调度到节点，或已调度但还在准备 | 所有节点的可分配资源不满足 requests；nodeSelector、亲和性、污点和容忍不匹配；PVC 没有绑定到 PV | `describe` 的 Events 里 `FailedScheduling` 的说明 |
| ContainerCreating | 已调度，容器还没创建好 | 卷挂载失败、引用的 ConfigMap / Secret 不存在、网络插件分配 IP 失败 | `describe` 的 Events |
| ImagePullBackOff / ErrImagePull | 拉镜像失败，在退避重试 | 镜像名或标签写错；私有仓库没配 `imagePullSecrets`；节点访问不到仓库；镜像架构不匹配 | `describe` 里拉取失败的具体报错 |
| CrashLoopBackOff | 容器反复启动又退出 | 启动时报错（缺少环境变量、连不上依赖、端口被占）；启动命令写错；liveness 或 startup 探针过严，应用还没启动完就被杀 | `logs --previous` 和 Exit Code |
| OOMKilled | 容器超过内存 limit 被内核杀掉 | limit 太小或内存泄漏 | `describe` 的 Last State |
| Evicted | 节点资源（内存、磁盘等）紧张，Pod 被 kubelet 驱逐 | 节点上其他 Pod 用量大、日志或临时文件写满磁盘 | Pod 的 status message、节点的 Conditions |
| Running 但 0/1 Ready | 进程在运行，readiness 一直不通过 | 依赖未就绪、探针路径或端口写错 | `describe` 里 readiness 失败的事件 |

CrashLoopBackOff 不是失败原因本身，而是"在等下一次重启"的状态，真正的原因要看退出码和上一次的日志：

- **退出码 1 或其他应用自定义的值**：应用自己报错退出，看日志
- **退出码 137**：被 SIGKILL，结合 Reason 判断是 OOMKilled 还是探针失败后被杀
- **退出码 0 却一直重启**：主进程正常结束了，比如启动命令是个执行完就退出的脚本，或者服务被放到后台运行，PID 1 退出导致容器结束

内存相关问题的细节见 [requests 和 limits 是什么](/basics/container/08-k8s-resources)，探针配置见 [滚动发布和健康检查](/basics/container/07-k8s-probes-rollout)。

### kubectl debug：临时容器

distroless 这类镜像里没有 shell，`exec` 进不去。`kubectl debug` 可以往正在运行的 Pod 里加一个**临时容器（ephemeral container）**，带上各种排查工具；`--target` 让它进入目标容器的进程命名空间，能看到目标容器的进程，这需要容器运行时支持，不支持时临时容器里看不到这些进程。容器一启动就崩溃时，可以用 `--copy-to` 复制出一个新 Pod，并改掉启动命令让它停住，再进去手动执行启动命令复现问题。

## 代码示例

```bash
# 1. 总览：状态、重启次数、节点
kubectl get pods -n shop -o wide
kubectl get events -n shop --sort-by=.lastTimestamp | tail -20

# 2. 看 Events 和上次终止的原因
kubectl describe pod web-7d9f-abcde -n shop

# 3. 看崩溃前的日志；多容器 Pod 用 -c 指定容器
kubectl logs web-7d9f-abcde -n shop --previous -c web

# 4. 进入容器检查
kubectl exec -it web-7d9f-abcde -n shop -- sh

# 5. 镜像里没有 shell：加一个临时容器，共享 web 容器的进程命名空间
kubectl debug -it web-7d9f-abcde -n shop --image=busybox --target=web

# 6. 容器一启动就崩：复制一个 Pod，把启动命令换成 sh，进去手动启动
kubectl debug web-7d9f-abcde -n shop -it --copy-to=web-debug --container=web -- sh

# Pending 时：看节点的可分配资源和已分配的 requests
kubectl describe node <节点名> | grep -A 8 "Allocated resources"
kubectl get pvc -n shop    # PVC 是否为 Bound
```

排查完记得删除 `web-debug` 这类复制出来的 Pod。

## 面试官可能追问

::: details 日志里什么都没有，`--previous` 也是空的，怎么办？
可能进程在打印任何日志之前就退出了，比如启动命令找不到可执行文件、入口文件路径错误、架构不匹配（exec format error）。这类错误一般出现在 `describe` 的 Last State 或 Events 里。也可以用 `kubectl debug --copy-to` 把启动命令换成 `sh`，进去手动执行原命令，看到完整报错。
:::

::: details 本地 docker run 好好的，到了集群里就 CrashLoopBackOff，可能是什么差异？
常见差异有：集群里没有本地的环境变量或配置文件；以非 root 用户运行（集群设置了 `runAsNonRoot` 或安全策略），没有权限写目录；根文件系统只读；资源 limit 比本地小；依赖服务的地址不同；节点是不同的 CPU 架构。逐项对比 Pod 的实际配置（`kubectl get pod -o yaml`）就能找到。
:::

::: details 大量 Pod 同时 Evicted，该从哪里查？
看被驱逐 Pod 的 status message，说明了是哪种资源不足（内存、临时存储等），再看对应节点的 Conditions，如 `MemoryPressure`、`DiskPressure`。磁盘压力常见于日志写到容器的可写层、镜像堆积；内存压力多半是很多 Pod 没设置合理的 requests，节点被超卖。被驱逐的 Pod 对象会残留，需要清理。
:::

## 易错点

- 只看 `kubectl logs`，忘了加 `--previous`，看到的是刚重启的新容器的空日志
- 把 CrashLoopBackOff 当成原因，没有去看退出码和上一次的日志
- Pending 时去看应用日志，此时容器根本还没创建，要看调度事件
- 用 `latest` 标签导致不同节点拉到不同版本，问题时好时坏
