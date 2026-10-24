---
difficulty: 2
tags: [实践]
---

# Nuxt 项目怎么部署上线？构建产物、启动方式、环境变量和静态资源怎么处理？

::: tip 一句话回答
`nuxt build` 生成 **`.output` 目录**，里面是打包好的服务端代码和静态资源，**不依赖 `node_modules`**，用 `node .output/server/index.mjs` 启动，端口用 `PORT` 或 `NITRO_PORT` 指定。Docker 用多阶段构建，运行阶段只复制 `.output`。配置用 **`NUXT_` 前缀的环境变量**在运行时覆盖，生产环境不读 `.env`。`/_nuxt/` 下的资源文件名带哈希，可以长期缓存或放到 CDN；前面放 Nginx 做 HTTPS 和反向代理，配合健康检查和优雅停机做零停机发布。
:::

## 详细解析

### 构建产物

```text
.output/
├── server/        # 服务端代码，入口 index.mjs，用到的依赖已经打包或复制进来
├── public/        # 静态资源：/_nuxt/ 下的 JS、CSS，以及 public 目录的文件
└── nitro.json     # 构建信息
```

`.output` 每次构建都会整体重建，不要手动改里面的文件，也不要提交到 git。因为它自带依赖，部署时只需要这个目录和 Node 运行时，不用在服务器上 `npm install`。

启动：

```bash
NODE_ENV=production PORT=3000 node .output/server/index.mjs
```

- 端口：`NITRO_PORT` 或 `PORT`，默认 3000
- 主机：`NITRO_HOST` 或 `HOST`
- 建议设置 `NODE_ENV=production`，有些依赖只有这样才不输出开发警告

### preset：部署到哪里

Nuxt 的服务端由 Nitro 打包，preset 决定输出成什么形式，详见 [Nitro 服务端引擎](/basics/nuxt/07-nitro-server)：

| 场景 | 做法 |
| --- | --- |
| 自己的服务器、容器 | 默认 `node-server` |
| 单机用满多核 | `node-cluster` preset（写成 `node_cluster` 也一样，名字会被规范化），或 PM2 的 cluster 模式；容器环境更常见的是多跑几个副本 |
| Serverless、边缘平台 | 换对应 preset，如 `vercel`、`netlify`、`cloudflare-pages`，很多平台能自动识别 |
| 纯静态站点 | `nuxt generate` 预渲染所有页面，把 `.output/public` 部署到静态托管 |

preset 可以写在 `nuxt.config` 的 `nitro.preset`，也可以构建时用 `NITRO_PRESET` 环境变量指定。

### 环境变量

`runtimeConfig` 里声明过的键，运行时可以用 `NUXT_` 前缀的环境变量覆盖，比如 `public.apiBase` 对应 `NUXT_PUBLIC_API_BASE`。构建好的服务不会读 `.env` 文件，变量要由部署平台、容器或进程管理器注入。这样同一份构建产物可以部署到测试和生产环境，详见 [runtimeConfig 和 app.config 的区别](/basics/nuxt/13-runtime-config)。

### 静态资源和 CDN

- `/_nuxt/` 下的文件名带内容哈希，可以设置一年的强缓存；HTML 由服务端渲染，不能强缓存
- 设置 `app.cdnURL`（运行时可以用 `NUXT_APP_CDN_URL`），资源链接会指向 CDN 域名。要先把 `.output/public` 上传到 CDN 源站
- 部署在子路径下时设置 `app.baseURL`

### 零停机发布

- **反向代理**：Nginx 终止 HTTPS，把请求转给 Node 进程，同时负责 gzip、静态文件和限流
- **健康检查**：写一个 `server/api/health` 接口，负载均衡或编排系统确认新实例就绪后再切流量
- **滚动发布**：逐个替换实例，始终有实例在服务
- **优雅停机**：Nitro 的 Node 服务会处理 SIGTERM 等信号，停止接收新连接，等进行中的请求处理完再退出，超时则强制退出。相关的开关和超时用环境变量配置，变量名在不同版本间有差异，以所用版本的文档为准

发版后，用户手里的旧页面可能去加载已经被删掉的旧 chunk，导致路由跳转失败。处理办法是保留一段时间的旧版本资源，或捕获加载失败后刷新页面，详见 [前端项目怎么部署](/basics/build/14-frontend-deploy)。

## 代码示例

多阶段构建，运行镜像里只有 `.output`：

```dockerfile
# 构建阶段：安装依赖并打包
FROM node:lts-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 运行阶段：只复制构建产物，不带 node_modules 和源码
FROM node:lts-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/.output ./.output
EXPOSE 3000
# 用 node 直接启动，SIGTERM 能直接送到 Node 进程
CMD ["node", ".output/server/index.mjs"]
```

## 面试官可能追问

::: details 为什么运行镜像里不需要 node_modules？
Nitro 构建时会把服务端用到的依赖打包进 `.output/server`，不适合打进包里的依赖会按实际用到的文件复制到 `.output/server/node_modules` 里，产物是自包含的。所以运行阶段只复制 `.output`，镜像小，也不会带进开发依赖和源码。
:::

::: details 为什么 CMD 里要直接写 node，而不是 npm start？
容器停止时，运行时会给主进程发 SIGTERM。用 `npm start` 时主进程是 npm，信号未必能转发给 Node，应用来不及优雅停机，等超时后被强制杀掉，进行中的请求会失败。直接用 `node` 启动，Node 就是主进程，能收到信号。
:::

::: details 改了 NUXT_PUBLIC_API_BASE 重启后没生效，可能是什么原因？
最常见的是这个键没在 `nuxt.config` 的 `runtimeConfig` 里声明，环境变量只能覆盖已经声明过的键；或者变量名拼错了层级，比如嵌套键之间少了下划线。另外前端拿到的值来自页面的 payload，CDN 缓存了旧的 HTML 时也会看到旧值。
:::

## 易错点

- 生产环境指望 `.env` 生效。构建产物不读 `.env`，变量要由平台注入
- 运行镜像里重新 `npm install` 全部依赖，镜像大、启动慢，其实 `.output` 已经自包含
- 给 HTML 也设置了长缓存，发版后用户一直拿到旧页面
- 没有处理 SIGTERM（比如用 shell 包了一层），每次发布都有一批请求失败
