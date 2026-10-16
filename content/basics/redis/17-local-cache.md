---
difficulty: 2
tags: [场景题]
---

# 有了 Redis 为什么还要本地缓存？多级缓存怎么设计？

::: tip 一句话回答
Redis 再快也要走一次**网络往返**，还要序列化、反序列化；本地缓存就在进程内存里，读取没有网络开销，也不怕 Redis 单个分片被热点打满。所以读多写少、能容忍短暂不一致的数据，常做成**本地缓存 → Redis → 数据库**的多级缓存。难点是多实例之间本地缓存的一致性，一般靠**短 TTL** 加**消息广播失效**解决。
:::

## 详细解析

### 两者的差异

| 维度 | 本地缓存（如 Java 的 Caffeine、Node 的 lru-cache） | Redis |
| --- | --- | --- |
| 访问延迟 | 内存访问，没有网络 | 一次网络往返 + 序列化 |
| 容量 | 受单个进程内存限制，要小 | 可以集群扩展 |
| 共享 | 每个实例各一份 | 所有实例共享一份 |
| 一致性 | 多实例之间各自过期，难统一 | 只有一份，天然一致 |
| 重启 | 进程重启就没了 | 可持久化 |

本地缓存解决的是"Redis 也扛不住"或"网络往返太贵"的问题，不是替代 Redis。

### 读写流程

```text
读：本地缓存 ──命中──> 返回
       │ 未命中
       ▼
     Redis ──命中──> 回填本地缓存，返回
       │ 未命中
       ▼
     数据库 ──> 回填 Redis 和本地缓存，返回

写：更新数据库 ──> 删除 Redis ──> 广播"失效 key" ──> 各实例删除本地缓存
```

写路径沿用"先更新数据库，再删缓存"的思路（见 [缓存一致性](/basics/redis/06-cache-consistency)），只是多了一步通知所有实例。

### 多实例的一致性

每个实例的本地缓存都是独立的，A 实例更新了数据，B 实例的本地缓存不会自己知道。常用手段可以叠加：

1. **短 TTL**：本地缓存只缓存几秒到几十秒，最坏情况也只脏这么久，这是兜底
2. **广播失效**：写操作后发一条消息，所有实例收到后删除本地 key。可以用 Redis Pub/Sub，也可以用 MQ（区别见 [Redis 消息队列](/basics/redis/13-message-queue)）
3. **监听 binlog**：用 Canal 一类的组件订阅数据库变更，统一发失效消息，业务代码不用每处都记得广播

Pub/Sub 不保证送达，实例断线期间的消息会丢，所以短 TTL 不能省。

### 适合放本地缓存的数据

- 热 key：秒杀商品、热门榜单，单个 Redis 分片扛不住时用本地缓存分摊（见 [大 Key 和热 Key](/basics/redis/09-big-hot-key)）
- 很少变的配置、字典数据、权限规则
- 不适合：库存、余额这类要求强一致的数据；量大且分散、命中率低的数据

## 代码示例

```js
import { LRUCache } from 'lru-cache'

const local = new LRUCache({ max: 10000, ttl: 30 * 1000 }) // 最多 1 万条，30 秒过期

async function getConfig(key) {
  const hit = local.get(key)
  if (hit !== undefined) return hit

  let value = await redis.get(key)
  if (value === null) {
    value = await db.loadConfig(key)
    await redis.set(key, value, 'EX', 600)
  }
  local.set(key, value)
  return value
}

// 每个实例订阅失效频道（订阅要用单独的连接）
sub.subscribe('cache:invalidate')
sub.on('message', (_channel, key) => local.delete(key))

async function updateConfig(key, value) {
  await db.saveConfig(key, value)
  await redis.del(key)
  await redis.publish('cache:invalidate', key)
}
```

## 面试官可能追问

::: details 本地缓存会不会导致内存溢出或 GC 变慢？
会。一定要设上限（条数或内存大小）和淘汰策略，不能用普通 Map 无限放。Java 里缓存对象多了会增加 GC 压力，大对象要谨慎，必要时用堆外缓存。
:::

::: details 本地缓存过期时也会击穿吗？
会，而且是每个实例各自击穿到 Redis。一般 Redis 扛得住；如果担心，可以用"同一个 key 只允许一个请求回源"的合并加载，Caffeine 的 LoadingCache 自带这个能力。
:::

::: details 怎么判断需不需要加本地缓存？
看监控：Redis 单分片 CPU 或带宽是否被少数 key 打满、接口耗时里 Redis 往返占比是否明显。没有这些问题时，多一层缓存只是多一个不一致的来源。
:::

## 易错点

- 只靠 Pub/Sub 广播失效，不设 TTL：消息丢了数据就一直是旧的
- 先删本地缓存再更新数据库：并发读会把旧值重新加载进本地缓存
- 本地缓存不设容量上限，把进程内存撑爆
