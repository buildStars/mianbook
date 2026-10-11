---
difficulty: 2
tags: [高频, 手写题]
---

# 分布式 ID 怎么生成？雪花算法有什么问题？

::: tip 一句话回答
分布式 ID 要满足**全局唯一**、**趋势递增**（对 B+ 树索引友好）、**高性能高可用**。常见方案有 UUID、数据库号段、Redis INCR 和**雪花算法**。雪花算法把 64 位拆成"1 位符号 + 41 位毫秒时间戳 + 10 位机器 ID + 12 位序列号"，本地生成、不依赖网络、整体递增。它的主要问题是**依赖系统时钟**，时钟回拨会生成重复 ID；另外**机器 ID 要保证不冲突**，在 JS 里还要注意超出 `Number` 的安全整数范围。
:::

## 详细解析

### 为什么要趋势递增

InnoDB 的主键索引是 B+ 树，[聚簇索引](/basics/mysql/02-clustered-index) 按主键顺序存放数据。递增的主键总是追加到最后一页，写入效率高；随机的主键（比如 UUIDv4）会插到树的中间，导致页分裂和大量随机 IO，索引也更大。

### 常见方案对比

| 方案 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| UUIDv4 | 本地随机生成 128 位 | 简单，无依赖 | 无序、占空间大，做主键性能差 |
| 数据库自增 | 单库 `AUTO_INCREMENT` | 简单、严格递增 | 单点，性能受数据库限制；多库要设置不同步长 |
| 号段模式 | 每次从数据库取一段 ID 到内存里分配 | 数据库压力小，ID 递增 | 依赖数据库，服务重启会浪费未用完的号段 |
| Redis INCR | 原子自增 | 性能好、递增 | 依赖 Redis，要处理持久化导致的 ID 回退 |
| 雪花算法 | 时间戳 + 机器 ID + 序列号 | 本地生成，性能最好，趋势递增 | 依赖时钟，要分配机器 ID |

**UUIDv7**（RFC 9562）把 48 位毫秒时间戳放在最前面，生成的 UUID 按时间有序，缓解了 UUID 做主键的问题，但仍然是 128 位。

**号段模式**的表结构和取号 SQL：

```sql
-- biz_tag 区分业务，max_id 是已经分配出去的最大值，step 是每次取的数量
UPDATE id_segment SET max_id = max_id + step WHERE biz_tag = 'order';
SELECT max_id, step FROM id_segment WHERE biz_tag = 'order';
-- 两条语句在同一个事务里执行，本次可分配的区间是 (max_id - step, max_id]
```

美团 Leaf 的号段模式还用了**双 buffer**：当前号段用掉一定比例时，异步预取下一个号段，避免号段耗尽时请求卡在数据库上。

### 雪花算法的位划分

```text
| 1 位 | 41 位毫秒时间戳（相对自定义纪元） | 10 位机器 ID | 12 位序列号 |
  符号位恒为 0  约 69 年                  最多 1024 台   每毫秒 4096 个
```

- 时间戳在最高位，所以 ID 整体随时间递增；同一毫秒内由序列号区分
- 单个节点每毫秒最多 4096 个 ID，用完了就等到下一毫秒
- 10 位机器 ID 常拆成 5 位数据中心 + 5 位机器，位数可以按业务调整，比如减少机器位、增加序列号位

### 时钟回拨和机器 ID

**时钟回拨**：NTP 校时或人工改时间，可能让当前时间小于上次生成 ID 的时间，这时生成的 ID 可能和之前的重复。常见处理：

1. 回拨很小（几毫秒）：等待时钟追上上次的时间
2. 回拨较大：直接报错拒绝服务，并告警，把流量切到其他节点
3. 用备用的机器 ID 继续生成，或者不再读系统时钟，在内存里维护一个只增不减的"逻辑时间"

**机器 ID 分配**：多个实例用了同一个机器 ID，同一毫秒内就会生成相同的 ID。容器环境下实例频繁变化，不能写死在配置里。常见做法是启动时到 ZooKeeper、etcd 或数据库里注册，领取一个空闲编号；美团 Leaf 用 ZooKeeper 的持久顺序节点分配，并在本地缓存一份，ZooKeeper 不可用时也能启动；运行中定期把本机时间上报到 ZooKeeper，启动时和记录的时间、其他节点的时间比对，发现明显偏离就拒绝启动并告警。

## 代码示例：手写雪花算法

64 位整数超出了 JS `Number` 的安全范围（2^53 - 1），必须用 BigInt：

```js
// 自定义纪元：2024-01-01 00:00:00 UTC，越晚，41 位时间戳能用得越久
const EPOCH = 1704067200000n
const WORKER_BITS = 10n
const SEQ_BITS = 12n
const MAX_WORKER = (1n << WORKER_BITS) - 1n // 1023
const MAX_SEQ = (1n << SEQ_BITS) - 1n // 4095
const MAX_BACKWARD_MS = 5n // 能容忍的最大回拨，超过直接报错

class Snowflake {
  constructor(workerId) {
    const id = BigInt(workerId)
    if (id < 0n || id > MAX_WORKER) throw new RangeError(`workerId 必须在 0~${MAX_WORKER}`)
    this.workerId = id
    this.lastTs = -1n
    this.seq = 0n
  }

  nextId() {
    let ts = BigInt(Date.now())
    if (ts < this.lastTs) {
      const diff = this.lastTs - ts
      if (diff > MAX_BACKWARD_MS) throw new Error(`时钟回拨 ${diff}ms，拒绝生成 ID`)
      ts = this.waitUntil(this.lastTs) // 小幅回拨：等时钟追上来
    }
    if (ts === this.lastTs) {
      this.seq = (this.seq + 1n) & MAX_SEQ
      if (this.seq === 0n) ts = this.waitUntil(this.lastTs + 1n) // 本毫秒序列号用完，等下一毫秒
    } else {
      this.seq = 0n
    }
    this.lastTs = ts
    return ((ts - EPOCH) << (WORKER_BITS + SEQ_BITS)) | (this.workerId << SEQ_BITS) | this.seq
  }

  waitUntil(target) {
    let ts = BigInt(Date.now())
    while (ts < target) ts = BigInt(Date.now()) // 忙等，最多几毫秒
    return ts
  }
}

const gen = new Snowflake(7)
const ids = Array.from({ length: 100000 }, () => gen.nextId())
console.log(new Set(ids).size === ids.length) // true：没有重复
console.log(ids.every((id, i) => i === 0 || id > ids[i - 1])) // true：单机内严格递增
console.log(ids[0].toString()) // 返回给前端时转成字符串
```

## 面试官可能追问

::: details 雪花 ID 返回给前端为什么要转成字符串？
JS 的 `Number` 是双精度浮点数，超过 2^53 - 1 的整数会丢失精度，前端 `JSON.parse` 后 ID 的末几位可能变掉，再拿去查询就查不到。后端序列化时把 ID 转成字符串最稳妥，Java 项目常见的做法是给 Long 字段配置转字符串的序列化器。
:::

::: details 雪花 ID 是严格递增的吗？
单个节点内严格递增；多个节点之间只是趋势递增，因为各节点时钟有偏差，同一时刻不同节点生成的 ID 也没有先后关系。如果业务需要全局严格递增（比如按 ID 判断先后顺序），要用数据库自增或号段这类中心化方案。
:::

::: details ID 能暴露业务信息吗？
可能。自增 ID 能被人推算出订单量，也方便遍历抓取；雪花 ID 能解析出生成时间和机器编号。对外暴露的 ID 可以和内部主键分开，比如对外用随机的短码或对内部 ID 加密后的值。
:::

## 易错点

- 认为 UUID 做主键没问题，随机的 UUIDv4 会让 InnoDB 频繁页分裂
- 在 JS 里用 `Number` 和位运算处理雪花 ID，位运算只有 32 位，还会丢精度
- 只处理了序列号溢出，没处理时钟回拨
- 多个实例配置了相同的机器 ID，同一毫秒内会生成重复 ID
