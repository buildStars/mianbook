---
difficulty: 2
tags: [场景题, 性能优化]
---

# 大 Key 和热 Key 怎么发现和解决？

::: tip 一句话回答
**大 Key** 是 value 很大或集合元素很多的 key，对它做全量读写、删除、迁移都会阻塞单线程的 Redis，还会占满网络带宽；用 `redis-cli --bigkeys`、`MEMORY USAGE` 或离线分析 RDB 来发现，通过拆分、压缩、只读需要的部分解决，删除时用 `UNLINK` 异步释放。**热 Key** 是访问量远高于其他 key 的 key，它只能落在一个节点上，会把这个节点打满；用 `redis-cli --hotkeys`（要求 LFU 淘汰策略）或客户端统计来发现，用**本地缓存**和**复制多份分散读取**来解决。
:::

## 详细解析

### 大 Key 的标准和危害

没有统一的标准，以团队规范为准。常见的规范例如：String 超过 10KB，或者 Hash、List、Set、ZSet 的元素超过 5000 个，就算大 Key。

危害：

- **阻塞**：`HGETALL`、`SMEMBERS`、`LRANGE key 0 -1` 是 O(N) 的，元素多时执行时间长，期间所有请求都在等，原因见 [Redis 的线程模型](/basics/redis/02-why-fast)
- **占用带宽**：一次读取几 MB，访问量稍大就会占满网卡，同一节点上的其他请求跟着变慢
- **删除和过期卡顿**：释放一个有几百万元素的集合要逐个释放内存，`DEL` 或者 key 过期被删除时都会阻塞主线程
- **集群不均衡**：数据量和访问量集中在某个节点上；迁移槽时大 Key 要整体搬迁，迁移过程会阻塞源节点和目标节点

### 发现大 Key

- `redis-cli --bigkeys`：用 SCAN 遍历所有 key，输出每种类型中最大的 key。集合类型按元素个数统计，不是按占用的内存。加上 `-i 0.1`，每执行 100 次 SCAN 休息 0.1 秒，减少对线上的影响
- `MEMORY USAGE key`：查看单个 key 占用的字节数，集合类型默认抽样估算
- 离线分析：把 RDB 文件拷出来，用 RDB 分析工具统计每个 key 的大小，完全不影响线上
- 监控：慢日志里频繁出现 O(N) 命令、出口带宽突然升高，通常都和大 Key 有关；云厂商的 Redis 服务一般也提供大 Key 分析

### 解决大 Key

- **拆分**：大 Hash 按 field 的哈希值分到多个小 Hash，如 `user:1001:fav:0` 到 `user:1001:fav:15`；大 List 按时间分段；大 String 拆成多个 key，或者把内容放到对象存储，Redis 里只存地址
- **压缩**：JSON 这类文本用 gzip 等算法压缩后再存，用 CPU 换内存和带宽
- **只读需要的部分**：用 `HMGET` 取指定字段，用 `HSCAN`、`LRANGE` 分批读，不要一次取出全部
- **异步删除**：用 `UNLINK` 代替 `DEL`；开启 `lazyfree-lazy-expire`、`lazyfree-lazy-eviction`，让过期和淘汰也在后台释放内存

### 热 Key

**危害**：Cluster 中一个 key 只属于一个槽、一个节点。某个商品突然爆火，所有请求都打到这一个节点，CPU 或带宽被打满，其他节点却很空闲，加节点也分担不了。这个节点扛不住时，请求会穿透到数据库，造成缓存击穿（见 [缓存穿透、击穿、雪崩](/basics/redis/01-cache-problems)）。

**发现**：

- `redis-cli --hotkeys`：基于 LFU 计数器统计访问频率，所以要求 `maxmemory-policy` 是 LFU 类的策略（见 [过期删除和内存淘汰](/basics/redis/05-expire-eviction)）
- 客户端或代理层统计：对 key 的访问计数并定期上报，发现热点最及时
- `MONITOR` 能看到所有执行的命令，但会明显降低性能，只能在线上短时间采样

**解决**：

- **本地缓存**：在应用进程里缓存热点数据，过期时间设得很短（如几秒），绝大部分读请求不再访问 Redis
- **复制多份**：把 `product:1001` 复制成 `product:1001:copy:0` 到 `product:1001:copy:7`，它们一般会分散到不同的槽和节点上，读取时随机选一份；更新时要更新所有副本
- **读写分离**：把热点读请求分摊到从节点
- 能提前预知的热点（如大促商品）提前预热；突发的热点要靠自动发现后动态开启上面的措施

## 代码示例

本地缓存 + 多副本读取热 Key（ioredis）：

```js
const localCache = new Map() // key -> { value, expireAt }；生产中要限制容量，比如用 LRU 缓存库
const COPIES = 8

async function getHot(key) {
  const hit = localCache.get(key)
  if (hit && hit.expireAt > Date.now()) return hit.value // 命中本地缓存，不访问 Redis

  // 随机读一个副本，把压力分散到不同节点
  const value = await redis.get(`${key}:copy:${Math.floor(Math.random() * COPIES)}`)
  localCache.set(key, { value, expireAt: Date.now() + 3000 }) // 本地只缓存 3 秒
  return value
}

async function setHot(key, value, ttl) {
  // 副本分散在不同的节点上，要分别写入
  await Promise.all(
    Array.from({ length: COPIES }, (_, i) => redis.set(`${key}:copy:${i}`, value, 'EX', ttl)),
  )
}
```

## 面试官可能追问

::: details 为什么删除大 Key 会阻塞？UNLINK 是怎么做的？
DEL 要把集合中每个元素占用的内存逐一释放，几百万个元素就要释放几百万次，全在主线程里完成。UNLINK 在主线程里只把 key 从键空间中摘掉，这一步是 O(1) 的，真正释放内存的工作交给后台线程；value 很小时直接同步释放，因为这样开销更小。Redis 6.0 起还可以开启 `lazyfree-lazy-user-del`，让 DEL 的行为和 UNLINK 一样。
:::

::: details 本地缓存会带来什么问题？
每个应用实例各有一份，实例之间、本地和 Redis 之间会有短暂的不一致，所以只适合能容忍几秒延迟的数据，过期时间要短。需要更快失效时，可以在数据变更后通过 Redis 的发布订阅通知所有实例清除本地缓存。另外本地缓存占用应用进程的内存，要限制容量并按 LRU 淘汰。
:::

::: details 大 Key 拆分后，原来的一个操作变成了多个，原子性怎么办？
拆分后的 key 在 Cluster 中通常落在不同的槽里，没法用一个事务或 Lua 脚本同时操作。真需要原子性，可以用哈希标签让它们落在同一个槽，但这样数据又集中到了一个节点上。多数需要拆分的场景（收藏列表、关注列表）只操作单个分片，并不需要跨分片的原子性。
:::

## 易错点

- `--bigkeys` 对集合按元素个数排名，元素少但每个元素很大的集合可能被漏掉，要结合按内存统计的 `--memkeys` 或 `MEMORY USAGE` 一起看
- 大 Key 过期时同样会阻塞，不只是手动删除才有问题
- 给集群加节点解决不了热 Key，因为一个 key 只在一个节点上
- `--hotkeys` 依赖 LFU 计数器，淘汰策略不是 LFU 时无法使用
