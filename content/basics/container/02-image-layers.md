---
difficulty: 2
tags: [高频, 原理, 性能优化]
---

# Docker 镜像是怎么分层的？Dockerfile 怎么写才能构建快、体积小？

::: tip 一句话回答
镜像由一组**只读层**叠成，容器运行时在最上面加一个**可写层**，修改文件时用**写时复制**把文件拷到可写层再改。Dockerfile 里修改文件系统的指令（`RUN`、`COPY`、`ADD`）会各自产生一层，构建时逐条命中缓存，**某一层失效后，后面所有层都要重建**。所以要把变化少的步骤放前面：先拷贝依赖清单装依赖，再拷贝源码；配合 `.dockerignore`、在同一个 `RUN` 里安装并清理缓存、选精简的基础镜像，并且**不要把密钥写进任何一层**。
:::

## 详细解析

### 只读层和可写层

```text
容器可写层（容器删除就没了）
-------------------------------- 以下只读，多个容器共享
COPY . .               源码层
RUN npm ci             依赖层
COPY package*.json ./  依赖清单层
FROM node:lts-slim     基础镜像的若干层
```

- 读文件时，从上往下找到第一个有这个文件的层
- 改文件时，先把文件从下层复制到可写层再修改（写时复制），下层不变
- 删文件时，在上层加一个"删除标记"把它遮住，**下层里的数据还在，镜像体积不会变小**

最后一条是很多镜像臃肿的原因：在一个 `RUN` 里下载了大文件，在下一个 `RUN` 里删掉，镜像照样包含它。

### 构建缓存怎么失效

构建时，每条指令会和缓存里的结果比对：

- `RUN`：只看指令字符串本身，不会去检查命令的执行结果。命令没变就命中缓存，哪怕 `apt-get update` 拿到的软件源早已更新
- `COPY` / `ADD`：根据被拷贝文件的内容和元数据（如权限）计算校验和，有变化就失效；只改了修改时间（mtime）不会让缓存失效
- `ARG` 的值变了，从用到它的指令开始缓存失效
- 某一层失效后，它后面的所有层都要重新构建

因此"先 `COPY . .` 再 `npm ci`"的写法，改一行源码就要重装全部依赖；先只拷贝 `package.json` 和锁文件安装依赖，再拷贝源码，日常改代码时依赖层能一直命中缓存。

### 让镜像更小

- **`.dockerignore`**：排除 `node_modules`、`.git`、日志、本地 `.env` 等。它既减少发送给构建器的上下文，也避免 `COPY . .` 把不该有的文件带进镜像
- **一个 `RUN` 里装完就清理**：安装和清理缓存写在同一条指令里，清理才对体积有效
- **只装生产依赖**：开发依赖只在构建阶段需要，用多阶段构建把它们留在构建镜像里，见 [多阶段构建](/basics/container/03-multi-stage)
- **选精简的基础镜像**，取舍如下

| 基础镜像 | 特点 | 注意 |
| --- | --- | --- |
| 完整版（如 `node:lts`） | 带编译工具和常用命令，兼容性最好 | 体积大，包含的软件多，漏洞扫描告警也多 |
| slim（Debian 精简版） | 去掉了大部分工具，仍然是 glibc | 通常是稳妥的默认选择 |
| alpine | 体积很小，用 musl libc | 依赖 glibc 的原生模块、预编译二进制可能不兼容或要重新编译；DNS 解析等行为和 glibc 有差异 |
| distroless | 只有运行时，没有 shell 和包管理器 | 攻击面最小，但出问题时不能 `exec` 进去排查，要用调试镜像或临时容器 |

### 不要把密钥写进镜像层

`COPY .npmrc .`、`ARG NPM_TOKEN` 或 `ENV` 写进去的令牌，即使后面删除，也会留在镜像层或镜像的构建历史里，任何拿到镜像的人都能用 `docker history` 或解包镜像看到。构建时需要的密钥用 BuildKit 的 secret 挂载，它只在这条 `RUN` 执行期间可见，不进入任何一层；运行时需要的密钥由部署平台注入，见 [配置和密钥怎么管理](/basics/container/09-k8s-config)。

## 代码示例

```dockerfile
# syntax=docker/dockerfile:1
FROM node:lts-slim
WORKDIR /app

# 系统依赖：安装和清理放在同一个 RUN 里
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# 先拷依赖清单，源码改动不会让依赖层失效
COPY package.json package-lock.json ./

# 私有仓库的 .npmrc 通过 secret 挂载，不会留在镜像里；npm 缓存放在构建缓存里
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

COPY . .
CMD ["node", "server.js"]
```

```bash
# 构建时把本机的 .npmrc 作为 secret 传入
docker build --secret id=npmrc,src=$HOME/.npmrc -t myapp .

# 查看每一层的大小和产生它的指令
docker history myapp
```

`.dockerignore` 示例：

```text
node_modules
.git
*.log
.env*
Dockerfile
```

## 面试官可能追问

::: details apt-get update 和 apt-get install 为什么要写在同一个 RUN 里？
分开写时，`RUN apt-get update` 这一层会被长期缓存。之后修改 install 那一行，会用到旧的软件源索引，可能装到过时的版本，甚至因为索引里的包已经不存在而失败。写在一起，安装列表一变就会重新 update。
:::

::: details 构建缓存在 CI 里经常不命中怎么办？
CI 的构建机器通常是全新的，本地没有缓存。可以用 `docker buildx build` 的 `--cache-from` / `--cache-to` 把缓存导出到镜像仓库或 CI 的缓存存储，下次构建时导入。导出到镜像仓库等外部存储需要支持缓存导出的构建驱动（如 `docker-container`），默认的 `docker` 驱动有限制。前提仍然是 Dockerfile 的顺序合理，否则有缓存也会在前面的层就失效。
:::

::: details COPY 和 ADD 有什么区别？
`COPY` 只做本地文件拷贝。`ADD` 还能从 URL 下载、自动解压本地的 tar 包，行为不够直观。一般用 `COPY`，只有确实需要自动解压时才用 `ADD`。
:::

## 易错点

- 在后面的层删除文件，以为镜像会变小，实际上下层的数据还在
- 先 `COPY . .` 再安装依赖，改一行代码就要重装所有依赖
- 只有 `.gitignore` 没有 `.dockerignore`，把 `node_modules` 和 `.env` 拷进了镜像
- 用 `ARG` 或 `ENV` 传令牌，以为构建完就没了，实际上会留在镜像的元数据或历史里
