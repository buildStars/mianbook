---
difficulty: 3
tags: [实践, 系统设计]
---

# 不用 Vercel，自己部署 Next.js 要注意哪些问题？

::: tip 一句话回答
`next build` 之后用 **`next start`** 启动的 Node.js 服务支持全部功能，Docker 里通常配合 **`output: 'standalone'`** 生成精简产物。难点在**多实例**：缓存默认存在每个实例自己的内存和磁盘里，`revalidateTag` 只影响当前实例，要配置共享存储的 **cacheHandler / cacheHandlers**；Server Actions 的加密密钥、build ID 或 **deploymentId** 要各实例一致。另外前面要放 Nginx 这类反向代理并**关闭流式响应的缓冲**，图片优化、优雅退出和安全更新也要自己负责。
:::

## 详细解析

### 运行方式

| 方式 | 适合 | 限制 |
| --- | --- | --- |
| `next start`（Node.js 服务） | 大多数场景 | 要自己管进程、扩容 |
| Docker + `output: 'standalone'` | 容器、Kubernetes | 同上，镜像体积小 |
| `output: 'export'` 静态导出 | 纯静态站点 | 不支持 Proxy、Server Actions、请求时渲染等服务端功能 |

`standalone` 会只把运行需要的依赖拷到产物目录，镜像里不用带完整的 `node_modules`。静态资源目录（`public` 和 `.next/static`）要按官方 Docker 示例一起拷进镜像，或者交给 CDN。

### 反向代理和流式响应

官方建议在 Next.js 前面放 Nginx 之类的反向代理，让它处理畸形请求、慢连接、请求体大小和限流，Node 进程只管渲染。

流式渲染（Suspense、loading.tsx）依赖响应一块一块地发出。Nginx 默认会缓冲上游响应，结果是用户要等整页生成完才看到内容。可以在 Next.js 侧给响应加 `X-Accel-Buffering: no` 头，或在 Nginx 里关闭对应 location 的 `proxy_buffering`；中间的负载均衡器也要支持分块传输。

```js
// next.config.js：让 Nginx 不缓冲页面响应
module.exports = {
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'X-Accel-Buffering', value: 'no' }] }]
  },
}
```

### 多实例的缓存

默认情况下，ISR 页面、数据缓存放在实例自己的内存（默认 50MB）和磁盘上。部署 3 个 Pod 就有 3 份互不相干的缓存：

```text
用户 → 负载均衡 ─┬→ Pod A（内存 + 磁盘缓存）  ← revalidateTag 只清了这里
                 ├→ Pod B（旧缓存）
                 └→ Pod C（旧缓存）
```

解决办法是把缓存放到共享存储（Redis、S3 等）：

- 传统的 ISR 和数据缓存：配置 `cacheHandler` 指向自己写的处理器，实现 `get`、`set`、`revalidateTag`、`resetRequestCache`，同时设置 `cacheMaxMemorySize: 0` 关闭进程内缓存
- `'use cache'`（Cache Components）：用 `cacheHandlers` 配置后端，多实例推荐 `'use cache: remote'`。处理器的 `refreshTags()` 在每次请求前同步标签状态，一个实例上的失效才能被其他实例看到
- 自己写的处理器要考虑大小限制和过期淘汰、Buffer 和 Map 的序列化、按 tag 建索引，以及存储挂了时的降级

缓存原理见 [Next.js 的缓存机制](/basics/ssr/05-next-caching) 和 [Cache Components](/basics/nextjs/03-cache-components)。

### 各实例要一致的东西

- **Server Actions 加密密钥**：闭包变量和 action ID 用密钥加密，默认每次构建随机生成。多个实例如果是分别构建的，A 生成的表单提交到 B 会报 "Failed to find Server Action"。用环境变量 `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` 固定一个 base64 编码的密钥，所有实例共用
- **版本不一致（version skew）**：滚动发布时新旧版本同时在线，旧页面请求到新实例会拿到对不上的资源。配置 `deploymentId`（比如取环境变量里的版本号），静态资源和客户端导航请求都会带上它，版本不匹配时框架触发整页刷新。没设置时，至少用 `generateBuildId` 让所有容器用同一次构建的产物

### 图片、退出和适配器

- **图片优化**在自己的服务器上用 CPU 完成，流量大时考虑用 `loader` 交给独立的图片服务。前面的 CDN 或代理必须转发 `Accept` 头，否则格式协商（WebP、AVIF）会出错甚至把错误格式缓存给别的浏览器
- **优雅退出**：收到 SIGTERM 时，`next start` 会等在途请求和 `after()` 回调完成。Kubernetes 里给足 drain 时间（官方建议 10 到 30 秒），先从负载均衡摘除再停进程
- **构建适配器**：`adapterPath` 指向一个适配器模块，可以在构建阶段按目标平台调整产物，用来对接不同的云平台
- **安全更新**：框架本身出过严重漏洞，自托管没人替你打补丁，要订阅官方安全公告并及时升级，见 [Next.js 的安全风险](/basics/nextjs/15-security)

静态前端（纯 SPA）的部署、缓存和灰度见 [前端项目怎么部署](/basics/build/14-frontend-deploy)。

## 面试官可能追问

::: details 只部署一个实例，还需要配 cacheHandler 吗？
单实例时内存加磁盘的默认缓存可以用，但容器重启、重新部署后磁盘缓存可能丢失（取决于有没有挂载持久卷），所有页面要重新生成。要扩容或者希望缓存在发布间保留，就该上共享存储。
:::

::: details 为什么静态资源可以长期缓存，页面不行？
带内容哈希的静态资源，Next.js 默认返回 `public, max-age=31536000, immutable`，内容变了文件名就变。动态渲染的页面返回 `private, no-cache, no-store`，避免 CDN 把某个用户的页面缓存给别人。CDN 规则不要覆盖页面的这个头。
:::

::: details 自托管时 after() 里的任务可靠吗？
`next start` 下完全支持，进程正常收到 SIGTERM 会等它执行完。但进程被强杀或崩溃时任务就丢了，所以重要的任务（发邮件、扣费）应该写进消息队列，`after()` 只做日志、统计这类丢了也不要紧的事。
:::

## 易错点

- 多实例部署却沿用默认缓存，`revalidateTag` 之后不同用户看到的内容不一样
- 各实例分别构建且没固定 `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`，表单提交随机报错
- Nginx 开着代理缓冲，流式渲染和 loading 状态全部失效
- 用 `output: 'export'` 部署后才发现 Server Actions、Proxy 都用不了
