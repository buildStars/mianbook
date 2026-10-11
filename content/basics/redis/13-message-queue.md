---
difficulty: 2
tags: [高频, 对比, 场景题]
---

# 怎么用 Redis 做消息队列？List、Pub/Sub、Stream 有什么区别？

::: tip 一句话回答
**List** 用 `LPUSH` 生产、`BRPOP` 阻塞消费，最简单，但消息取出就删除，消费者处理到一半崩溃消息就丢了，可以用 `BLMOVE` 取出的同时放进备份队列来补救；一条消息只能给一个消费者。**Pub/Sub** 是广播，消息不保存，订阅者不在线或处理不过来，消息直接丢失。**Stream**（Redis 5.0 引入）是持久化的追加日志，支持**消费者组、ACK、Pending 列表**，消费者崩溃后可以用 `XCLAIM`、`XAUTOCLAIM` 把超时未确认的消息转给别人，还能按 ID 回溯历史，是 Redis 里最接近专业消息队列的方案。不过 Redis 的持久化和主从复制都是异步的，故障时仍可能丢消息，核心业务和海量堆积还是交给 Kafka、RocketMQ 这类专业 MQ。
:::

## 详细解析

### List：最简单的队列

生产者 `LPUSH queue msg`，消费者 `BRPOP queue 5` 从另一端阻塞地取，超时单位是秒，0 表示一直等。阻塞读取避免了用 `RPOP` 轮询空转。问题在于：

- **消息取出即删除**：消费者处理到一半崩溃，这条消息就没了，也没有确认和重试机制
- **只能单播**：一条消息只会被一个消费者拿到，不能让多个服务各自消费一份
- **可靠队列的补救**：用 `BLMOVE queue processing RIGHT LEFT 5`（6.2 起，替代已废弃的 `BRPOPLPUSH`）在取出的同时放进 processing 列表，处理成功后 `LREM processing 1 msg`；再起一个任务检查 processing 里停留太久的消息，放回原队列。这样消息可能被处理两次，消费逻辑要幂等，见 [消息幂等](/basics/distributed/06-mq-idempotent)

### Pub/Sub：只管广播

`SUBSCRIBE channel` 订阅，`PUBLISH channel msg` 发布，`PSUBSCRIBE news.*` 按模式订阅。Redis 把消息推给**当前在线**的所有订阅者，推完就不管了，官方明确说这是"至多一次"的投递：

- 不保存消息，订阅者断线、重启期间发布的消息全部丢失
- 订阅者消费太慢，输出缓冲区超过 `client-output-buffer-limit pubsub 32mb 8mb 60`（默认值：超过 32MB，或持续 60 秒超过 8MB）会被断开，缓冲区里的消息一起丢掉
- RESP2 协议下，订阅中的连接只能执行订阅相关的命令，所以客户端要为订阅单独建一个连接
- Cluster 中普通的 `PUBLISH` 会转发到所有节点，7.0 起可以用分片的 `SPUBLISH`、`SSUBSCRIBE`，消息只在频道所属的分片内传播

适合丢了也无所谓的实时通知，比如通知各个应用实例清除本地缓存（见 [大 Key 和热 Key](/basics/redis/09-big-hot-key)）、多实例之间转发 WebSocket 消息。

### Stream：消费者组和 ACK

```text
生产者：XADD orders * orderId 1001          → 生成 ID：毫秒时间戳-序号，如 1700000000000-0
Stream orders：[1700000000000-0] [1700000000000-1] [1700000000005-0] ...
  ├─ 消费者组 order-service：记录 last_delivered_id + Pending 列表（PEL）
  │     ├─ worker-1：XREADGROUP ... STREAMS orders >   处理完 XACK
  │     └─ worker-2：同一组内，一条消息只投给一个消费者
  └─ 消费者组 stats-service：独立的消费进度，每条消息都能完整消费一遍
```

1. **建组**：`XGROUP CREATE orders order-service $ MKSTREAM`，`$` 表示只消费之后的新消息，用 `0` 则从头消费；`MKSTREAM` 在 Stream 不存在时一并创建
2. **读取**：`XREADGROUP GROUP order-service worker-1 COUNT 10 BLOCK 5000 STREAMS orders >`，`>` 表示读从未投递给任何消费者的消息。读到的消息进入 PEL，直到 `XACK` 才移出
3. **崩溃恢复**：消费者重启后，先用具体 ID（如 `0`）代替 `>` 读自己 PEL 里的旧消息，处理完再读新消息
4. **转移消息**：消费者彻底挂了，它 PEL 里的消息会一直挂着。`XPENDING` 能看到每条消息的空闲时间和投递次数，`XCLAIM` 把空闲超过指定时间的消息转给自己，6.2 起的 `XAUTOCLAIM` 把"扫描 + 转移"合成一条命令
5. **死信**：某条消息总是处理失败，投递次数会不断增加。官方建议超过一个阈值后把它写入另一个 Stream 并告警，这就是 Stream 的死信做法
6. **长度控制**：XACK 不会删除消息，要用 `XADD orders MAXLEN ~ 100000 * ...` 或 `XTRIM` 裁剪。`~` 表示近似裁剪：Stream 内部是由多个宏节点组成的基数树，近似裁剪只删除整个宏节点，比精确裁剪高效，代价是实际保留的条数会比阈值略多

### 对比

| | List | Pub/Sub | Stream |
| --- | --- | --- | --- |
| 消息持久化 | 是，随 RDB/AOF | 否 | 是，消费者组的状态也会持久化 |
| 消费模型 | 一条消息给一个消费者 | 广播给所有在线订阅者 | 组内分摊，组间各自完整消费 |
| 确认和重试 | 没有，要自己用 BLMOVE 实现 | 没有 | XACK、PEL、XCLAIM |
| 消费者离线时 | 消息留在队列里 | 消息丢失 | 消息留在 Stream 里，上线后接着读 |
| 回溯历史 | 不支持，取出即删除 | 不支持 | 支持，按 ID 范围读取 |
| 适合 | 简单的任务队列 | 实时通知、广播 | 需要可靠消费的轻量队列 |

### 什么时候该用专业 MQ

Stream 已经够很多中小场景用，但它有先天限制：数据在内存里，大量堆积成本高；主从复制是异步的，官方文档也提醒故障切换后可能缺数据；一个 Stream 只存在一个节点上，不会像 Kafka 分区那样自动分布到多台机器；没有事务消息、延时消息这些现成的能力。消息量大、要求不丢、需要重放和堆积的场景，选 Kafka、RocketMQ 等，见 [为什么要用消息队列](/basics/distributed/04-mq-why)；Node.js 服务内部的后台任务可以用基于 Redis 的 BullMQ，见 [任务队列](/basics/node/18-task-queue)。

## 代码示例

Stream 消费者组（ioredis）：

```js
import { Redis } from 'ioredis'

const redis = new Redis()
const STREAM = 'orders'
const GROUP = 'order-service'
const CONSUMER = `worker-${process.pid}` // 组内每个消费者的名字要不同

// 创建消费者组；组已存在时会报 BUSYGROUP 错误，忽略即可
await redis.xgroup('CREATE', STREAM, GROUP, '$', 'MKSTREAM').catch((err) => {
  if (!err.message.includes('BUSYGROUP')) throw err
})

// 生产者：* 表示自动生成 ID，MAXLEN ~ 只保留最近约 10 万条
await redis.xadd(STREAM, 'MAXLEN', '~', 100000, '*', 'orderId', '1001', 'event', 'paid')

async function consume(handle) {
  let lastId = '0' // 先读自己 Pending 列表里没确认的旧消息
  let backlog = true
  while (true) {
    const res = await redis.xreadgroup('GROUP', GROUP, CONSUMER, 'COUNT', 10, 'BLOCK', 5000,
      'STREAMS', STREAM, backlog ? lastId : '>')
    const entries = res?.[0]?.[1] ?? [] // BLOCK 超时返回 null
    if (backlog && entries.length === 0) backlog = false // 旧消息处理完了，开始读新消息
    for (const [id, fields] of entries) {
      lastId = id
      if (!fields) { await redis.xack(STREAM, GROUP, id); continue } // 消息已被裁剪
      const msg = {}
      for (let i = 0; i < fields.length; i += 2) msg[fields[i]] = fields[i + 1]
      try {
        await handle(msg)
        await redis.xack(STREAM, GROUP, id) // 处理成功才确认
      } catch (err) {
        console.error('处理失败，留在 Pending 列表等待重新认领', id, err)
      }
    }
  }
}
```

另起一个定时任务，用 `redis.xautoclaim(STREAM, GROUP, CONSUMER, 60000, '0-0', 'COUNT', 50)` 把空闲超过 60 秒的消息转到自己名下重新处理，转之前用 `XPENDING` 查投递次数，超过阈值的写入死信 Stream 后直接 XACK。

## 面试官可能追问

::: details Stream 能保证消息不丢、不重复吗？
都不能完全保证。消费者处理完、还没 XACK 就崩溃，消息会被重新投递，所以是"至少一次"，消费逻辑要幂等。丢消息主要来自持久化和复制：AOF 每秒刷盘时宕机会丢最后一点数据，主从异步复制在切换时也可能缺数据；可以用 `WAIT` 等待写入复制到从节点来降低概率，但官方也说明故障切换只是尽力选择数据最新的从节点。
:::

::: details 一条消息被多个消费者组 ACK 之后，什么时候删除？
XACK 只是把消息从这个组的 PEL 里移除，消息本身还在 Stream 里，只能靠 `MAXLEN`、`MINID` 裁剪或 `XDEL` 删除。多个组的消费进度不一样时，按长度裁剪可能删掉还没被某个组处理的消息，所以 MAXLEN 要留足余量，或者自己算出各组都已确认的位置，再用 `MINID` 裁剪。较新的版本（8.2 起）给 `XADD`、`XTRIM` 加了 `ACKED` 选项，只裁剪所有组都已确认的消息，还提供了确认并删除的 `XACKDEL`。
:::

::: details 消费者组和 Kafka 的分区有什么区别？
Kafka 的分区是物理的，一个分区同时只被组内一个消费者读，分区内有序。Redis 的消费者组只是在一个 key 上做负载均衡，谁空闲谁拿新消息，多个消费者并行处理时顺序无法保证；一个 Stream 也只在一个节点上。要扩展或保证某类消息有序，就按业务 ID 拆成多个 Stream key，每个 key 只由一个消费者处理。
:::

::: details 要做延时消息怎么办？
List 和 Stream 都不支持延时投递。常见做法是用 ZSet，score 存执行时间，定时取出到期的消息，用 Lua 脚本原子地"认领"，避免多个实例重复处理。认领不要直接删除：处理到一半进程崩溃，消息就丢了。更稳妥的是把 score 改成"现在 + 租约时长"，处理成功再删除，超时没删的会被重新认领，见 [延时任务系统](/basics/backend-design/07-delay-task)。
:::

## 易错点

- Pub/Sub 不是可靠的消息队列，订阅者断线期间的消息全部丢失
- `BRPOP` 的超时单位是秒，`XREADGROUP` 的 `BLOCK` 是毫秒
- XACK 不会删除消息，不设置 MAXLEN 的 Stream 会一直增长，变成大 Key
- `XGROUP CREATE` 用 `$` 只会消费建组之后的消息，要处理已有的消息得用 `0`
