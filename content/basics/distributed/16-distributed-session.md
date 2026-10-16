---
difficulty: 2
tags: [高频, 场景题]
---

# 分布式系统下 Session 怎么共享？

::: tip 一句话回答
单机时 Session 存在服务器内存里，部署多个实例后，负载均衡把同一用户的请求分到不同机器，另一台机器上找不到 Session，用户就"掉登录"了。常见方案有四种：**粘性会话**（同一用户固定打到同一台）、**Session 复制**（实例之间互相同步）、**集中存储**（Session 放 Redis，例如 Spring Session）、**无状态 Token**（用 JWT，服务端不存 Session）。实践中最常用的是 **Redis 集中存储**，需要无状态横向扩展或跨域时考虑 JWT。
:::

## 详细解析

### 问题是怎么来的

```text
              ┌──► 实例 A（内存里有用户 1 的 Session）
用户 1 ──► LB ─┤
              └──► 实例 B（内存里没有）→ 判定未登录
```

第一次登录落在 A，Session 写进 A 的内存，浏览器拿到 Cookie 里的 Session ID。下一次请求被轮询到 B，B 拿着这个 ID 查自己的内存，查不到。Cookie、Session、Token 本身的区别见 [Cookie、Session、Token、JWT 有什么区别](/basics/network/13-auth)，这里只讨论多实例下怎么共享。

### 四种方案对比

| 方案 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| 粘性会话 | 负载均衡按 Cookie 或源 IP 哈希，固定转发到同一实例 | 应用不用改 | 实例宕机或重启，上面的 Session 全丢；负载可能不均；扩缩容时映射会变 |
| Session 复制 | 实例之间广播同步 Session（例如 Tomcat 集群复制） | 应用基本不改，任意实例都能处理 | 每个实例存全量数据，内存和网络开销随实例数增长，只适合小集群 |
| 集中存储 | Session 统一存到 Redis 等外部存储，实例只存 Session ID | 实例无状态，可随意扩缩容；重启不丢登录 | 多一次网络访问；Redis 要做高可用，它挂了全站掉登录 |
| JWT 无状态 | 把用户信息签名后放进 Token，由客户端保存，服务端只验签 | 服务端不存任何东西，天然支持横向扩展和跨服务 | Token 签发后难以主动失效；Token 体积比 Session ID 大 |

负载均衡的哈希策略见 [反向代理和负载均衡](/basics/network/20-reverse-proxy)。

### Redis 集中存储的要点

1. 登录成功后生成随机且足够长的 Session ID，写入 Redis：key 是 `session:<id>`，value 是用户信息，设置过期时间
2. Session ID 通过 Cookie 下发，设置 `HttpOnly`、`Secure`、`SameSite`
3. 每次请求按 ID 去 Redis 取，取到就续期（滑动过期）
4. 退出登录直接删 key，管理员踢人下线也只要删 key

Java 里 Spring Session 把这一套封装好了：替换掉容器的 `HttpSession` 实现，底层存到 Redis，业务代码里还是照常用 `request.getSession()`。Redis 高可用方案见 [Redis 高可用](/basics/redis/08-high-availability)。

### JWT 方案要注意什么

JWT 最大的问题是**无法主动作废**：用户改了密码或被封号，旧 Token 在过期前依然有效。常见折中：

- Access Token 有效期设短（例如十几分钟），配合 Refresh Token 续签
- 需要强制下线时，维护一个 Token 黑名单或用户的"Token 版本号"，放在 Redis 里校验

这样服务端又有了状态，所以很多系统最后的形态是"JWT + Redis"。要不要上 JWT，取决于是否真的需要跨服务、跨域的无状态鉴权。

## 代码示例

```js
// Express 中间件：从 Redis 读取 Session（ioredis）
async function sessionMiddleware(req, res, next) {
  const sid = req.cookies.sid
  if (!sid) return next()

  const data = await redis.get(`session:${sid}`)
  if (data) {
    req.user = JSON.parse(data)
    // 滑动过期：每次访问把过期时间延长到 30 分钟
    await redis.expire(`session:${sid}`, 1800)
  }
  next()
}
```

## 面试官可能追问

::: details 粘性会话按源 IP 哈希有什么问题？
大量用户可能在同一个 NAT 出口后面，共用一个公网 IP，会全部打到同一台实例，负载严重倾斜。用户网络切换（比如从 Wi-Fi 换到移动网络）后 IP 变了，也会被分到别的实例。
:::

::: details Session 存在 Redis 里，Redis 挂了怎么办？
先用主从加哨兵或集群保证高可用，主节点故障自动切换。真的整体不可用时，所有用户都会被判定未登录，可以降级成只读或提示稍后重试。对登录态要求极高的系统，可以在 Session 里只放必要信息，减小故障时的恢复成本。
:::

::: details 微服务之间怎么传递用户身份？
一般在网关统一鉴权：网关查 Session 或校验 JWT，再把用户 ID 等信息放进请求头传给下游服务，下游信任网关，不再重复查 Session。下游服务不能直接对外暴露，否则请求头可以伪造。
:::

## 易错点

- 粘性会话没有解决共享问题，只是绕开了它，实例一挂 Session 就丢
- JWT 不是"更安全的 Session"，它解决的是无状态和扩展性，代价是难以吊销
- Session ID 要用安全的随机数生成，不能用自增 ID 或可推测的值
