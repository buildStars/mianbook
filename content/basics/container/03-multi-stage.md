---
difficulty: 2
tags: [高频, 实践]
---

# 多阶段构建是什么？Node.js 项目的 Dockerfile 怎么写？

::: tip 一句话回答
多阶段构建是在一个 Dockerfile 里写多个 `FROM`，每个 `FROM` 开始一个阶段，后面的阶段用 `COPY --from=<阶段名>` 只拿前面阶段的产物，**最终镜像只包含最后一个阶段的内容**。这样编译工具、开发依赖、源码都留在构建阶段，运行镜像又小又干净。Node.js 项目一般分 deps、build、runner 三个阶段；运行阶段用**非 root 用户**、用 **`node` 直接启动**而不是 `npm start`，处理好 SIGTERM 实现优雅退出，并配上健康检查。
:::

## 详细解析

### 为什么要分阶段

单阶段构建时，为了编译 TypeScript、打包前端，镜像里要装 devDependencies，有时还要装 `python3`、`make`、`g++` 编译原生模块。这些东西运行时用不上，却让镜像变大、漏洞更多。多阶段构建把"构建环境"和"运行环境"分开：

```text
deps    安装全部依赖（含开发依赖）
  │
build   拷贝源码，执行 npm run build，产出 dist/
  │
prod-deps  只安装生产依赖
  │
runner  基础镜像 + 生产依赖 + dist/，只有这一阶段进入最终镜像
```

各阶段之间没有依赖关系时，BuildKit 会并行构建它们；最终目标没用到的阶段会被跳过。用 `docker build --target build` 还可以只构建到某个阶段，比如在 CI 里跑测试。

### PID 1 和信号转发

容器停止时，`docker stop` 或 Kubernetes 会给容器的 PID 1 发 SIGTERM，等待一段时间后发 SIGKILL。问题出在 PID 1 是谁：

- **用 `npm start` 启动**：PID 1 是 npm，`node` 是它的子进程。npm 不一定把信号可靠地转发给子进程，应用收不到 SIGTERM，最后被 SIGKILL 强杀，正在处理的请求直接中断
- **shell 形式的 `CMD node server.js`**：会以 `/bin/sh -c` 启动，PID 1 可能是 shell，同样存在转发问题
- **exec 形式的 `CMD ["node", "server.js"]`**：PID 1 就是 node，能直接收到信号

PID 1 在 Linux 里还有特殊之处：内核不会对它应用信号的默认处理动作，没注册 SIGTERM 处理函数的 PID 1 进程收到 SIGTERM 不会退出。另外它要负责回收孤儿子进程。应用会派生子进程时，可以用 `docker run --init` 或在镜像里装 tini 这类轻量 init 作为 PID 1。

应用自己要监听 SIGTERM：停止接收新连接、处理完进行中的请求、关闭数据库连接后退出，写法见 [Node.js 服务怎么处理异常](/basics/node/07-error-handling)。在 Kubernetes 里还要配合摘流量的时序，见 [滚动发布和健康检查](/basics/container/07-k8s-probes-rollout)。

### 运行阶段的安全和健康检查

- **非 root 运行**：官方 Node.js 镜像自带 `node` 用户，用 `USER node` 切换；拷贝文件时用 `--chown=node:node`
- **`NODE_ENV=production`**：很多库会据此关闭调试功能
- **健康检查**：`HEALTHCHECK` 让 Docker 定期探测，容器状态会显示 healthy / unhealthy，`docker compose` 的 `depends_on` 可以等依赖健康后再启动。注意 Kubernetes 不使用镜像里的 `HEALTHCHECK`，要单独配置探针

## 代码示例

```dockerfile
# syntax=docker/dockerfile:1
# 生产环境建议固定到具体版本，甚至固定镜像摘要
ARG NODE_IMAGE=node:lts-slim

# 1. 安装全部依赖，供构建使用
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# 2. 构建：编译 TypeScript 等
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 3. 只安装生产依赖
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 4. 运行阶段：只拿需要的东西
FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000

# slim 镜像里没有 curl，用 Node.js 内置的 fetch 做探测（需要内置 fetch 的 Node.js 版本）
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# exec 形式，node 是 PID 1，能直接收到 SIGTERM
CMD ["node", "dist/server.js"]
```

```bash
docker build -t myapp .
docker build --target build -t myapp:build .   # 只构建到 build 阶段，比如用来跑测试
docker run --init -p 3000:3000 myapp           # --init 让 tini 做 PID 1，负责转发信号、回收僵尸进程
```

## 面试官可能追问

::: details 为什么不在 build 阶段执行 npm prune --omit=dev，而是单独装生产依赖？
两种都可以。prune 能省一次安装，但构建阶段可能装过额外的东西，prune 之后的 `node_modules` 不一定和"干净地只装生产依赖"完全一致。单独一个阶段只依赖锁文件，能和 build 阶段并行，缓存也更独立。
:::

::: details 前端项目（如 Vue、React）的 Dockerfile 怎么写？
构建阶段用 Node.js 镜像执行 `npm run build` 产出静态文件，运行阶段换成 Nginx 这类镜像，只拷贝打包产物和 Nginx 配置，最终镜像里完全没有 Node.js。SSR 项目则和上面的服务端写法类似。
:::

::: details 怎么验证应用确实能优雅退出？
在容器里发起一个慢请求，同时执行 `docker stop`，看请求是否正常返回、进程退出码是否为 0、耗时是否远小于超时时间。如果每次 `docker stop` 都要等满超时（默认 10 秒）才结束，基本就是信号没被处理，最后被 SIGKILL 杀掉的。
:::

## 易错点

- 最终阶段 `COPY . .` 把源码和开发依赖又带了回来，多阶段白写
- 用 `npm start` 或 shell 形式的 `CMD` 启动，应用收不到 SIGTERM
- 运行阶段仍然是 root 用户
- 以为写了 `HEALTHCHECK` 在 Kubernetes 里也会生效，实际上要配置探针
