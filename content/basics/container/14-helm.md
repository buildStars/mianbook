---
difficulty: 1
tags: [实践, 原理]
---

# Helm 是什么？解决了什么问题？

::: tip 一句话回答
Helm 是 Kubernetes 的**包管理器**。一个应用通常要一堆 YAML（Deployment、Service、Ingress、ConfigMap……），不同环境只有镜像版本、副本数、域名这些值不一样。Helm 把这些 YAML 写成**模板**，可变部分抽到 **values** 里，打包成 **Chart**；每次安装生成一个 **Release**，记录版本历史，可以一条命令升级和**回滚**。
:::

## 详细解析

### 它解决的问题

只用 `kubectl apply` 管理应用时，常见的麻烦：

- **重复**：开发、测试、生产三套 YAML 大部分相同，改一处要改三份
- **没有版本**：集群里现在跑的是哪一版配置、上一版是什么，没有记录
- **回滚难**：升级出问题，要找到旧的 YAML 再 apply 一遍
- **复用难**：装一个 Redis 或 Prometheus，要自己写全套资源

Helm 用模板解决重复，用 Release 历史解决版本和回滚，用公共的 Chart 仓库解决复用。

### 三个核心概念

| 概念 | 是什么 | 类比 |
| --- | --- | --- |
| Chart | 一个目录：`Chart.yaml` 元信息、`values.yaml` 默认值、`templates/` 模板 | 安装包 |
| Values | 填进模板的参数，可以用 `-f` 指定文件或 `--set` 覆盖 | 安装选项 |
| Release | Chart 在集群里的一次安装实例，每次升级产生一个新的修订号 | 已安装的软件 |

同一个 Chart 可以装多次，比如 `redis-cache` 和 `redis-session` 是两个 Release。Helm 3 的 Release 信息默认以 Secret 的形式存在 Release 所在的命名空间里，不再需要旧版那个跑在集群里的 Tiller 组件。

### 模板长什么样

```text
mychart/
├── Chart.yaml
├── values.yaml
└── templates/
    ├── deployment.yaml
    ├── service.yaml
    └── _helpers.tpl     # 可复用的模板片段
```

模板是 Go template 语法，`.Values` 取 values 里的值，`.Release.Name` 取 Release 名：

```yaml
# templates/deployment.yaml（片段）
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}-web
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: web
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
```

```yaml
# values-prod.yaml：生产环境只写和默认值不同的部分
replicaCount: 4
image:
  tag: "1.8.2"
```

## 代码示例

```bash
# 安装：Release 名 web，用生产环境的 values
helm install web ./mychart -f values-prod.yaml -n prod

# 升级；没装过就安装，CI 里常用这个写法
helm upgrade --install web ./mychart -f values-prod.yaml --set image.tag=1.8.3 -n prod

# 查看历史版本，回滚到第 2 版
helm history web -n prod
helm rollback web 2 -n prod

# 只在本地渲染出最终 YAML，不提交到集群，用来检查模板
helm template web ./mychart -f values-prod.yaml

# 使用公共 Chart
helm repo add example https://charts.example.com
helm install cache example/redis
```

## 面试官可能追问

::: details Helm 和 Kustomize 有什么区别？
Helm 是**模板**思路，YAML 里挖洞填值，功能强（条件、循环、依赖、版本和回滚），代价是模板难读、容易写出语法正确但结果错误的 YAML。Kustomize 是**补丁叠加**思路，基础 YAML 保持原样，每个环境写一个 overlay 去修改字段，没有模板语言，已经内置在 `kubectl apply -k` 里，但没有 Release 和回滚的概念。分发给别人用的软件包倾向 Helm，自己团队的应用两种都常见。
:::

::: details helm rollback 能回滚数据库数据吗？
不能。它只是把 Kubernetes 资源恢复成旧版本的 Release 渲染结果。如果新版本做过数据库迁移，回滚后旧代码可能和新表结构不兼容，所以迁移要写成向前兼容的，先加字段、后删字段。PVC 里的数据也不会被回滚。
:::

::: details 敏感信息能直接写在 values.yaml 里吗？
不应该。values 文件通常进 Git，渲染出来的 Secret 也只是 base64 编码。常见做法是部署时从 CI 的密钥变量用 `--set` 传入，或者用外部密钥管理组件在集群里生成 Secret，见 [配置和密钥管理](/basics/container/09-k8s-config)。
:::

## 易错点

- `--set` 传的值会按类型解析，纯数字的镜像 tag、`true` 这类值会变成整数或布尔；要保持字符串用 `--set-string`，模板里也可以用 `quote` 函数加引号
- 以为 `helm rollback` 是"撤销"，它其实是用旧配置生成一个新的修订号
- 手动 `kubectl edit` 过 Helm 管理的资源，下次 `helm upgrade` 可能覆盖或冲突，配置要统一从 values 改
- 把 Helm 当成部署平台。它只管渲染和提交资源，发布策略、健康检查仍然是 Deployment 自己的事
