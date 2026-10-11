---
difficulty: 2
tags: [高频, 对比]
---

# Pipeline、事务和 Lua 脚本有什么区别？

::: tip 一句话回答
三者解决的问题不同。**Pipeline** 是客户端把多条命令一次发出去、再一次读回结果，只为**减少网络往返**，不保证原子性，中间可能穿插其他客户端的命令。**MULTI/EXEC 事务**把命令先排队，EXEC 时一次性按顺序执行，执行期间不会插入别的命令，但**不支持回滚**：某条命令执行出错，其他命令照样执行；配合 **WATCH** 可以做乐观锁。**Lua 脚本**在服务端原子执行，能拿到前一条命令的结果做判断，最适合"读、判断、写"一步完成，代价是脚本执行期间会**阻塞所有请求**，必须短小。Cluster 下事务和脚本用到的 key 必须在**同一个槽**。
:::

## 详细解析

### Pipeline：省掉网络往返

不用 Pipeline 时，客户端发一条命令就要等它的响应回来再发下一条，大部分时间花在往返（RTT）上。Pipeline 把 N 条命令一次写出去，Redis 依次执行后，客户端再一次读回 N 个结果。原理和收益见 [Redis 为什么快](/basics/redis/02-why-fast) 的追问，这里只强调几点：

- Pipeline 是客户端的发送方式，Redis 并不知道这些命令是一批，**其他客户端的命令可能插在中间**
- 后面的命令拿不到前面命令的结果，"先读再根据结果写"做不了
- Redis 要在内存里暂存这一批的所有回复，官方建议分批发送，例如每批 1 万条
- Cluster 下一批命令可能属于不同节点，要由客户端按节点拆开发送

### 事务：MULTI、EXEC、DISCARD、WATCH

```text
MULTI          → OK
INCR stock     → QUEUED      命令只入队，不执行
SET flag 1     → QUEUED
EXEC           → 依次执行队列里的命令，返回所有结果；执行期间不会插入其他客户端的命令
（DISCARD 放弃队列，退出事务）
```

事务里的错误分两种，处理方式不同：

| 错误类型 | 例子 | 结果 |
| --- | --- | --- |
| 入队时就能发现的错误 | 命令名写错、参数个数不对、超过 maxmemory | EXEC 直接返回 EXECABORT 错误，整个事务都不执行 |
| 执行时才发现的错误 | 对 String 执行 `LPOP`，报 WRONGTYPE | 只有这条失败，其他命令照常执行，**已执行的不会回滚** |

官方的解释是，支持回滚会明显影响 Redis 的简单性和性能。所以 Redis 事务保证的是"一组命令不被打断地执行"，而不是关系型数据库那种要么全成功、要么全失败。

**WATCH 乐观锁**：在 MULTI 之前 `WATCH key`，如果从 WATCH 到 EXEC 之间这个 key 被修改过（任何连接的写入，包括本连接自己在 MULTI 之前的写入，以及 Redis 的过期删除、淘汰），EXEC 返回 nil，整个事务不执行，由客户端重试。事务队列里的命令只是入队，不会触发 WATCH。EXEC 之后所有 WATCH 自动取消，也可以用 UNWATCH 手动取消。冲突多时重试会很频繁，所以高并发下的"检查再修改"更适合用 Lua。如果只是"值没变才更新"一个 String，较新的版本（8.4 起）可以直接用 `SET key value IFEQ 旧值`。

### Lua 脚本

```text
EVAL script numkeys key [key ...] arg [arg ...]
脚本里用 KEYS[i] 取 key、ARGV[i] 取参数，用 redis.call() 执行命令
```

- **原子执行**：脚本运行期间整个服务端只执行它，不会插入其他命令，而且可以根据中间结果走不同分支
- **脚本缓存**：执行过或用 `SCRIPT LOAD` 加载过的脚本按 SHA1 缓存，之后用 `EVALSHA sha1` 调用，省掉传脚本正文。缓存不持久化，重启、主从切换后可能丢失，较新的版本（7.4 起）还限制 EVAL 带进来的脚本最多 500 个，超出按 LRU 淘汰。缓存里找不到时返回 NOSCRIPT 错误，客户端要退回 EVAL（ioredis 的 `defineCommand` 会自动处理）
- **不会回滚**：Redis 没有撤销写入的机制。脚本因 `redis.call` 报错或 Lua 运行时错误中途退出时，前面已经执行的写命令会保留。官方文档解释超时脚本为什么不能强行终止时也说，中断脚本可能留下"写了一半"的数据。所以校验要放在第一次写之前
- **不能太慢**：脚本超过 `busy-reply-threshold`（7.0 之前叫 `lua-time-limit`，默认 5 秒）后，Redis 不会自动终止它，而是开始对其他请求返回 BUSY 错误；没写过数据的脚本可以用 `SCRIPT KILL` 终止，已经写过数据的只能 `SHUTDOWN NOSAVE`。单线程被长时间占用的后果见 [Redis 为什么快](/basics/redis/02-why-fast)
- **key 要通过 KEYS 传入**：Cluster 要靠它判断脚本访问哪个槽，所有 key 必须在同一个槽，可以用哈希标签 `{order:1001}` 让它们落在一起（见 [主从、哨兵和 Cluster](/basics/redis/08-high-availability)）

Redis 7.0 新增了 **Functions**：用 `FUNCTION LOAD` 加载一个 `#!lua name=mylib` 开头、用 `redis.register_function` 注册函数的库，再用 `FCALL 函数名 numkeys ...` 调用。和 EVAL 脚本不同，函数有名字，是数据库的一部分，会写进 RDB、AOF 并复制给从节点，应用不用每次启动都去加载。

### 对比

| | Pipeline | MULTI/EXEC | Lua 脚本 |
| --- | --- | --- | --- |
| 主要目的 | 减少网络往返 | 一组命令不被打断地执行 | 在服务端原子地执行带逻辑的操作 |
| 中间会插入其他命令 | 会 | 不会 | 不会 |
| 出错后回滚 | 不回滚 | 不回滚（入队错误则整个不执行） | 不回滚 |
| 能用前面命令的结果 | 不能 | 不能，EXEC 后才拿到全部结果 | 能 |
| 主要风险 | 一批太大，回复占用内存 | 事务很大时 EXEC 执行时间长 | 脚本慢会阻塞所有请求 |
| Cluster | 客户端按节点拆分 | key 必须在同一个槽 | key 必须在同一个槽 |

## 代码示例

扣减库存的三种写法（ioredis）：

```js
import { Redis } from 'ioredis'

const redis = new Redis()

// 1. Pipeline：批量写入，一次往返；结果是 [err, result] 组成的数组
const results = await redis.pipeline().set('stock:1001', 100).set('stock:1002', 50).get('stock:1001').exec()

// 2. WATCH + MULTI：WATCH 的状态属于连接，必须用独占的连接，不能和其他请求共用
async function decrStockWithWatch(conn, key, retries = 5) {
  for (let i = 0; i < retries; i++) {
    await conn.watch(key)
    const stock = Number(await conn.get(key))
    if (stock <= 0) {
      await conn.unwatch()
      return false
    }
    const res = await conn.multi().decr(key).exec()
    if (res !== null) return true // null 表示 key 在 WATCH 之后被改过，事务被放弃，重试
  }
  throw new Error('冲突太多，请稍后重试')
}
const conn = redis.duplicate()
await decrStockWithWatch(conn, 'stock:1001')

// 3. Lua：判断和扣减在服务端一次完成，没有竞态，也不用重试
redis.defineCommand('decrStock', {
  numberOfKeys: 1,
  lua: `
    local stock = tonumber(redis.call('GET', KEYS[1]) or '0')
    if stock < tonumber(ARGV[1]) then return -1 end
    return redis.call('DECRBY', KEYS[1], ARGV[1])`,
})
const left = await redis.decrStock('stock:1001', 1) // 库存不足返回 -1，否则返回扣减后的库存
```

## 面试官可能追问

::: details Redis 事务满足 ACID 吗？
不完全满足。隔离性有保证，EXEC 执行期间不会插入其他命令；但原子性只做到"一起执行"，执行时出错不会回滚；一致性靠入队时的检查和命令本身的正确性；持久性取决于持久化配置，比如 AOF 设为 always 时才接近持久。面试时说清"不回滚"和"不被打断"这两点就够了。
:::

::: details 脚本里能不能用随机数或当前时间？
Redis 7.0 起脚本只按"效果"复制：主节点把脚本实际执行的写命令包在 MULTI/EXEC 里发给从节点和 AOF，而不是让从节点重新执行脚本，所以在脚本里调用 `TIME`、`SRANDMEMBER` 不会导致主从不一致。老版本还可以把脚本原文发给从节点重新执行（5.0 之前默认如此），那时脚本必须是确定性的，这也是很多旧资料说"脚本里不能用随机命令"的原因。
:::

::: details Pipeline 和 MGET、MSET 这类批量命令怎么选？
能用批量命令就优先用：一条命令、一次执行，Redis 处理起来比解析多条命令更省事，`MSET` 本身也是原子的。批量命令只能做同一种操作，要混合不同命令时再用 Pipeline。两者在 Cluster 下都要注意 key 的分布：`MGET` 的 key 必须在同一个槽，否则报 CROSSSLOT 错误。
:::

::: details 用 Lua 脚本要注意什么？
脚本要短小，循环次数要有上限，不要在脚本里遍历大集合；不要在运行时拼接脚本正文，每种脚本都会占一份缓存，应该写成固定脚本、用参数传值；脚本返回小数会被截断成整数，要返回字符串。另外脚本里的 key 都要从 KEYS 传入，不要在脚本里拼 key 名，否则 Cluster 下没法正确路由。
:::

## 易错点

- Pipeline 不是原子的，事务和脚本才能保证中间不插入其他命令
- 事务和脚本都不回滚：事务里某条命令执行出错，其他命令照样执行；脚本中途出错，之前的写入会保留
- WATCH 是连接级别的，Node.js 里多个请求共用一个连接时，WATCH 会互相干扰
- 脚本超时后 Redis 不会自动停止它，写过数据的脚本只能停掉整个实例
