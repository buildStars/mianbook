---
difficulty: 3
tags: [高频, 场景题]
---

# 怎么用 Redis 实现分布式锁？有哪些坑？

::: tip 一句话回答
加锁用 `SET key value NX PX 30000`，**一条命令原子地完成"不存在才设置"和"设置过期时间"**，过期时间保证持有者崩溃后锁也能自动释放。value 要用每次加锁时生成的**唯一值**，释放时用 **Lua 脚本**先比较 value 再删除，避免删掉别人的锁。业务执行时间可能超过过期时间，需要**看门狗**定期续期（Redisson 就是这么做的）。主从切换时锁可能丢失，Redlock 想用多个独立节点解决但存在争议，对互斥要求严格的场景，还要靠数据库约束或 ZooKeeper、etcd 来保证。
:::

## 详细解析

### 一步步演进

| 写法 | 问题 |
| --- | --- |
| `SETNX lock 1` 后再 `EXPIRE lock 30` | 两条命令不是原子的，中间进程崩溃，锁就永远不会过期 |
| `SET lock 1 NX PX 30000`，释放时 `DEL lock` | 业务超时后锁已经过期、被别人拿到，这时 DEL 删掉的是别人的锁 |
| `SET lock <唯一值> NX PX 30000`，释放时先 GET 比较再 DEL | GET 和 DEL 是两条命令，比较完、删除前锁正好过期并被别人拿到，还是会误删 |
| 唯一值 + Lua 脚本比较并删除 | 正确的基础版本 |

释放锁的 Lua 脚本：

```lua
-- KEYS[1]：锁的 key；ARGV[1]：加锁时写入的唯一值
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
```

Redis 执行 Lua 脚本时不会穿插其他命令，比较和删除就成了一个原子操作。

### 锁过期了，业务还没执行完

过期时间设短了，业务没执行完锁就过期，另一个客户端拿到锁，两个客户端同时进入了临界区；设长了，持有者崩溃后要等很久锁才释放。

**看门狗**：加锁成功后启动一个定时任务，每隔过期时间的三分之一检查一次，锁还是自己的，就把过期时间重置。持有者正常运行时锁一直有效；进程崩溃后续期跟着停止，锁按时过期。Java 的 Redisson 就是这样：加锁时不指定持有时间，锁的过期时间默认是 30 秒，每 10 秒续期一次。

续期也不是万能的：进程长时间停顿（如 Full GC）或者网络分区时，续期可能失败，而业务代码还在执行。所以关键操作要有兜底，比如数据库唯一索引、乐观锁版本号，或者 **fencing token**：每次加锁拿到一个递增的令牌，写存储时带上，存储拒绝比已经见过的令牌更旧的请求。

### 主从切换导致锁丢失

```text
1. 客户端 A 在主节点加锁成功
2. 主节点还没把这个 key 同步给从节点就宕机了（主从复制是异步的）
3. 从节点被提升为新的主节点，上面没有这把锁
4. 客户端 B 加锁成功，A 和 B 同时持有锁
```

**Redlock** 是 Redis 作者提出的方案：部署 N 个（通常是 5 个）相互独立的 Redis 主节点，客户端依次向它们加锁，在过半节点上加锁成功、并且总耗时小于锁的有效期，才算成功；否则向所有节点释放锁。

争议在于：Martin Kleppmann 指出，Redlock 依赖"各节点时钟大致准确、进程停顿和网络延迟有上限"这些假设，一旦不成立（时钟跳变、长时间 GC），两个客户端就可能同时持有锁，而且它不提供 fencing token；Redis 作者则撰文反驳。比较普遍的结论是：

- 锁只是为了**提高效率**（避免重复执行，偶尔重复也能接受）：单节点 Redis 锁就够了
- 锁关系到**正确性**（绝不允许同时执行）：用 ZooKeeper、etcd 这类基于共识算法的协调服务，并在存储层用 fencing token 或数据库约束兜底

## 代码示例

Node.js + ioredis，带等待重试和看门狗：

```js
import { randomUUID } from 'node:crypto'

const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`
const RENEW = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE', KEYS[1], ARGV[2]) end return 0`

async function withLock(redis, key, fn, { ttl = 30000, waitMs = 5000 } = {}) {
  const token = randomUUID() // 每次加锁都生成新的唯一值
  const deadline = Date.now() + waitMs
  // 加锁成功返回 'OK'，key 已存在返回 null
  while (!(await redis.set(key, token, 'PX', ttl, 'NX'))) {
    if (Date.now() > deadline) throw new Error(`获取锁超时：${key}`)
    await new Promise((r) => setTimeout(r, 50 + Math.random() * 50)) // 随机退避，避免大家同时重试
  }
  // 看门狗：每 ttl/3 续期一次，只续自己的锁
  const timer = setInterval(() => {
    redis.eval(RENEW, 1, key, token, ttl).catch(() => {})
  }, ttl / 3)
  try {
    return await fn()
  } finally {
    clearInterval(timer)
    await redis.eval(RELEASE, 1, key, token)
  }
}

// 同一个订单同一时间只处理一次
await withLock(redis, `lock:order:${orderId}`, () => handleOrder(orderId))
```

## 面试官可能追问

::: details 怎么实现可重入锁？
同一个持有者再次加锁要能成功，并且加了几次就要释放几次。可以用 Hash 存锁：field 是持有者的唯一标识，value 是重入次数。加锁脚本判断 key 不存在或者 field 是自己时，把次数加 1 并重置过期时间；释放脚本把次数减 1，减到 0 才删除 key。这些判断都要放在 Lua 脚本里完成，Redisson 的可重入锁就是这个思路。
:::

::: details Redis 锁和 ZooKeeper、etcd 的锁怎么选？
Redis 锁性能高、实现简单，但主从是异步复制，切换时可能丢锁。ZooKeeper 用临时顺序节点实现锁，客户端会话断开后节点自动删除，等待者监听前一个节点，不存在过期时间难以设置的问题；etcd 用租约加 revision 实现，revision 单调递增，可以直接当作 fencing token。它们基于共识算法，一致性更强，但性能不如 Redis，运维也更重。大多数业务用 Redis 锁加数据库兜底就够了。
:::

::: details 抢不到锁的请求应该怎么处理？
看业务：防重复提交这类场景直接返回"操作进行中"；必须执行的任务可以带退避地重试，并设置最长等待时间，避免请求越堆越多。高并发下大量请求自旋抢锁，会给 Redis 带来很大压力，这时可以考虑改成排队处理（比如消息队列），而不是抢锁。
:::

## 易错点

- 加锁和设置过期时间必须在一条命令里完成，`SETNX` 加 `EXPIRE` 不是原子的
- 锁的 value 必须每次加锁都不一样，用固定值或服务名无法区分持有者
- 释放锁时的比较和删除必须放在同一个 Lua 脚本里
- 即使做了续期，甚至用了 Redlock，Redis 锁也不能保证绝对互斥，关键数据要有数据库层面的兜底
