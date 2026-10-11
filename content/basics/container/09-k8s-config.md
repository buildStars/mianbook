---
difficulty: 2
tags: [实践, 安全]
---

# Kubernetes 里的配置和密钥怎么管理？

::: tip 一句话回答
普通配置放 **ConfigMap**，敏感信息放 **Secret**，两者都可以注入成**环境变量**或**挂载为文件**：环境变量在容器启动时确定，改了要重启 Pod；挂载的文件会被 kubelet 延迟同步更新（`subPath` 挂载除外），但应用要自己重新读取。Secret 默认只是 **base64 编码，不是加密**，要配合 **etcd 静态加密**、**RBAC 限制读取权限**，更进一步用 Vault 或云 KMS 这类外部密钥管理。密钥绝不能以明文提交到 Git。
:::

## 详细解析

### ConfigMap 和 Secret

| | ConfigMap | Secret |
| --- | --- | --- |
| 内容 | 非敏感配置：开关、地址、配置文件 | 密码、令牌、证书 |
| 存储 | 明文存在 etcd | `data` 字段是 base64 编码，默认也明文存在 etcd（可开启静态加密） |
| 挂载到容器 | 普通文件 | kubelet 把内容放在节点的 tmpfs（内存）里，不写入节点磁盘 |
| 常见类型 | — | `Opaque`、`kubernetes.io/tls`、`kubernetes.io/dockerconfigjson`（拉私有镜像） |

base64 只是为了能存二进制内容，用 `base64 -d` 就能还原，任何能 `get secret` 的人都能拿到原文。

### 环境变量还是文件

| | 环境变量（`env` / `envFrom`） | 挂载为文件（`volumes`） |
| --- | --- | --- |
| 更新 | 不会更新，必须重启容器 | kubelet 定期同步，有一定延迟；用 `subPath` 挂载的不会更新 |
| 应用感知 | 启动时读一次 | 要监听文件变化或定期重读，否则仍然用旧值 |
| 安全 | 容易被打印到日志、错误报告，子进程会继承 | 可以设置文件权限，泄露面小一些 |

密钥更推荐挂载为文件；很多官方镜像支持 `XXX_FILE` 形式的环境变量，从文件读取密码。

### 让 Secret 真正安全

- **静态加密**：在 API Server 配置 `EncryptionConfiguration`，让 Secret 写入 etcd 前加密，最好使用对接 KMS 的方式，主密钥不放在控制平面节点上。托管的 Kubernetes 服务一般提供开关
- **RBAC 最小权限**：只有需要的服务账号能读取特定 Secret；注意能在某个命名空间创建 Pod 的人，就能把该命名空间的 Secret 挂进自己的 Pod 读出来
- **外部密钥管理**：密钥存在 Vault、云厂商的密钥管理服务里，由 External Secrets Operator 同步成 Secret，或用 Secrets Store CSI Driver 直接挂载成文件。好处是集中审计、自动轮换，Git 里只有引用
- **GitOps 场景**：仓库里不放明文，可以放加密后的密文（例如 Sealed Secrets、SOPS），由集群内的组件解密

API Key 的保存和轮换思路见 [API Key 怎么安全管理](/engineering/security/07-api-key)。

### 配置变了怎么让 Pod 生效

修改 ConfigMap 不会触发 Deployment 滚动更新，因为 Pod 模板没变。常见做法：

- **改名而不是改内容**：每次配置变更生成一个新名字的 ConfigMap（如 Kustomize 的 `configMapGenerator` 会在名字后加内容哈希），Deployment 引用新名字，Pod 模板变了就会滚动更新；旧版本保留，回滚时配置也跟着回滚。这类按版本命名的对象可以设置 `immutable: true`
- **注解里放校验和**：Helm 常见写法是在 Pod 模板的注解里写配置内容的哈希，配置变了注解就变
- **手动重启**：`kubectl rollout restart deployment/web`，本质是给 Pod 模板加一个 `kubectl.kubernetes.io/restartedAt` 时间戳注解，模板变了就会滚动更新

## 代码示例

```bash
# 从字面量和文件创建；不要把明文写进会提交到 Git 的 YAML
kubectl create configmap web-config --from-literal=LOG_LEVEL=info --from-file=app.yaml
kubectl create secret generic db-cred --from-literal=username=app --from-file=password=./db-password.txt

# 能 get 就能解码，Secret 的读取权限要收紧
kubectl get secret db-cred -o jsonpath='{.data.password}' | base64 -d
```

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      containers:
        - name: web
          image: registry.example.com/web:1.4.3
          envFrom:
            - configMapRef:
                name: web-config          # 所有键注入为环境变量，改了要重启
          env:
            - name: DB_USER
              valueFrom:
                secretKeyRef: { name: db-cred, key: username }
            - name: DB_PASSWORD_FILE
              value: /etc/secrets/db/password
          volumeMounts:
            - name: db-cred
              mountPath: /etc/secrets/db  # 整个目录挂载，更新会同步
              readOnly: true
      volumes:
        - name: db-cred
          secret:
            secretName: db-cred
            defaultMode: 0400             # YAML 里按八进制解析（十进制 256）；写 JSON 时要用十进制
```

## 面试官可能追问

::: details 挂载的 ConfigMap 更新了，应用怎么热加载？
kubelet 更新挂载文件时是原子替换（通过符号链接切换目录），应用可以监听目录变化，或者定期重新读取并比较内容。也可以加一个 sidecar 监听变化后通知应用（如发信号或调用重载接口）。不少团队为了可预期，干脆不做热加载，统一走滚动更新。
:::

::: details 环境变量为什么不适合放密钥？
环境变量会被子进程继承，程序崩溃时可能被错误上报工具整体采集，调试时一个 `env` 或打印配置就会出现在日志里，`kubectl describe` 等地方也可能看到引用。文件方式可以单独控制权限，也只有显式读取它的代码才会接触到原文。
:::

::: details 密钥已经提交到 Git 了怎么办？
第一时间轮换：在服务端作废旧密钥、生成新密钥。只从历史里删除不够，仓库可能已经被克隆或被扫描过。之后在 CI 里加入密钥扫描，在提交前拦截。
:::

## 易错点

- 认为 Secret 是加密的，其实只是 base64 编码
- 修改 ConfigMap 后以为环境变量会自动更新
- 用 `subPath` 挂载单个文件，之后发现配置永远不更新
- 只限制了 `get secret` 权限，忽略了能创建 Pod 的人也能读到 Secret
