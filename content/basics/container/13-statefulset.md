---
difficulty: 2
tags: [原理, 对比]
---

# StatefulSet 和 Deployment 有什么区别？有状态服务怎么部署？

::: tip 一句话回答
Deployment 的 Pod 是可以随便替换的"牲口"：名字随机、共享同一份存储声明、启停没有顺序。StatefulSet 给每个 Pod **固定的身份**：名字带序号（`db-0`、`db-1`），配合 **Headless Service** 有稳定的 DNS 名；通过 **volumeClaimTemplates** 每个 Pod 有自己的 PVC，Pod 重建后还挂回原来的盘；默认**按序号顺序**创建和删除。适合数据库、ZooKeeper、Kafka 这类节点之间有角色、要各自持久化数据的服务。
:::

## 详细解析

### 主要区别

| 对比项 | Deployment | StatefulSet |
| --- | --- | --- |
| Pod 名字 | 随机后缀，如 `web-7d9f8-x2k4p` | 固定序号，如 `db-0`、`db-1` |
| 网络标识 | 只能通过 Service 负载均衡访问 | 每个 Pod 有独立 DNS：`db-0.db.default.svc.cluster.local` |
| 存储 | 多个副本引用同一个 PVC，或者不用持久卷 | 每个 Pod 一个 PVC，按序号绑定 |
| 创建和删除 | 并行 | 默认按 0、1、2 顺序创建，前一个就绪才建下一个；缩容从序号最大的开始 |
| 滚动更新 | 先起新 Pod 再删旧的，可以超出副本数 | 从序号最大的开始，逐个删掉重建 |

### 稳定的网络标识

StatefulSet 要求有一个 Headless Service（`clusterIP: None`）。Headless Service 不分配虚拟 IP，DNS 查询直接返回各 Pod 的 IP，并给每个 Pod 一条 `<pod 名>.<service 名>` 的记录。Pod 重建后 IP 会变，但名字和 DNS 名不变，集群成员之间可以用名字互相找到，比如 `db-0` 固定当主库，其他副本连 `db-0.db` 做复制。普通 Service 的类型见 [Service 和 Ingress](/basics/container/06-k8s-service-ingress)。

### 每个 Pod 自己的存储

`volumeClaimTemplates` 是 PVC 的模板，StatefulSet 按它给每个 Pod 创建名为 `<模板名>-<pod 名>` 的 PVC，比如 `data-db-0`。`db-0` 被删掉重建，哪怕换了节点，也会重新挂上 `data-db-0`。

缩容或删除 StatefulSet 时，PVC 默认**保留**，防止误删数据，需要手动清理。可以用 `persistentVolumeClaimRetentionPolicy`（`whenDeleted` 和 `whenScaled` 默认都是 `Retain`） 配置缩容或删除时是否一起删 PVC。

### 有序和分批更新

- `podManagementPolicy: OrderedReady`（默认）按顺序启停；改成 `Parallel` 可以并行，只影响扩缩容，不影响更新
- `updateStrategy.rollingUpdate.partition: N` 表示只更新序号大于等于 N 的 Pod，可以拿来做金丝雀：先更新最后一个，观察没问题再把 partition 调小
- `updateStrategy.type: OnDelete` 表示改了模板不自动更新，手动删一个 Pod 才按新模板重建

## 代码示例

```yaml
apiVersion: v1
kind: Service
metadata:
  name: db
spec:
  clusterIP: None          # Headless Service
  selector:
    app: db
  ports:
    - port: 5432
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: db
spec:
  serviceName: db          # 关联上面的 Headless Service
  replicas: 3
  selector:
    matchLabels:
      app: db
  template:
    metadata:
      labels:
        app: db
    spec:
      containers:
        - name: postgres
          image: postgres:16
          ports:
            - containerPort: 5432
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:      # 每个 Pod 生成一个 PVC：data-db-0、data-db-1 ...
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 20Gi
```

注意：这个例子只演示 StatefulSet 的结构，三个 Pod 是三个互相独立的 PostgreSQL，并不会自动组成主从，复制要靠镜像里的脚本或 Operator 来配置。

## 面试官可能追问

::: details 数据库适合放到 Kubernetes 上吗？
可以，但 StatefulSet 只解决"身份和存储稳定"，主从切换、备份恢复、扩容时的数据重分布它都不管。生产上通常用对应数据库的 Operator（把运维知识写进控制器），或者直接用云厂商的托管数据库。团队没有足够的 K8s 存储运维经验时，托管数据库往往更省心。
:::

::: details 节点宕机了，StatefulSet 的 Pod 会马上在别的节点重建吗？
不一定会。StatefulSet 保证同一个序号同时最多只有一个 Pod，控制面联系不上节点时，无法确认原来的 Pod 已经停了，为了防止两个 `db-0` 同时写同一份数据，不会自动在别处重建。需要确认节点真的挂了之后，手动强制删除 Pod，或者通过节点的停机处理机制让它被清理掉。
:::

::: details StatefulSet 的 Pod 能被 Service 负载均衡访问吗？
能。另外建一个普通的 ClusterIP Service 选中这些 Pod，就能负载均衡访问，常用来做只读流量。Headless Service 用来定位具体的某个 Pod，比如写请求只发给主库。
:::

## 易错点

- 以为 StatefulSet 会自动搭好主从或集群。它只提供稳定身份，集群逻辑要应用自己或 Operator 实现
- 删了 StatefulSet 以为数据也清掉了，PVC 默认是保留的，重建同名 StatefulSet 会挂回旧数据
- 忘了建 Headless Service，或者 `serviceName` 写错，Pod 的 DNS 记录就解析不出来
- 默认的顺序启动里有一个 Pod 一直起不来，后面的 Pod 都会卡住
