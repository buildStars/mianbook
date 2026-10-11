---
difficulty: 3
tags: [系统设计, 场景题]
---

# 设计一个延时任务系统，比如订单超时自动取消

::: tip 一句话回答
常见方案有四种：**数据库定时扫描**最简单可靠，但精度取决于扫描间隔，数据多了扫描有压力；**Redis ZSet** 以执行时间为 score，worker 轮询到期的任务，精度高、能取消；**消息队列的延时消息**（RocketMQ 定时消息、RabbitMQ 死信或插件）开箱即用，但发出后不好取消、延时有上限；**时间轮**是内存里的高效定时结构，多用在框架内部。无论哪种，投递都是**至少一次**，所以处理逻辑必须**幂等**，订单取消用 `UPDATE ... WHERE status = 'UNPAID'` 条件更新；多实例下靠原子认领或分布式锁避免重复执行；最后加一个**兜底扫描**，补上丢失的任务。
:::

## 详细解析

### 第一步：澄清需求

- **场景**：订单 30 分钟未支付自动取消、发货 7 天后自动确认收货、会议开始前提醒、失败任务延后重试
- **精度和范围**：秒级还是分钟级？订单取消晚几十秒可以接受，提醒类要准时一些；最长延时多久，决定能不能直接用 MQ 的延时消息
- **可靠性**：任务不能丢；重复执行可以接受，但业务要幂等
- **取消**：订单支付了，超时任务要能取消，或者执行时能判断出已经不需要

量级估算（假设值）：每天 1000 万笔订单，每笔一个 30 分钟的超时任务。

- 写入速率：1000 万 / 86400 ≈ 116 个/秒；大促峰值按 20 倍算约 2300 个/秒
- 同时在等待的任务数 = 写入速率 × 延时时长：平时 116 × 1800 ≈ 21 万；峰值持续半小时约 2300 × 1800 ≈ 414 万
- 放进 Redis ZSet，每个元素按 100 字节粗估（实际取决于成员长度和编码），峰值约 400 MB，单实例放得下，但已经是[大 Key](/basics/redis/09-big-hot-key)，要拆成多个 key

### 第二步：整体架构

先比较四种方案：

| 方案 | 做法 | 优点 | 缺点 | 适用场景 |
| --- | --- | --- | --- | --- |
| 数据库定时扫描 | 每分钟查 `status = 'UNPAID' AND expire_at <= NOW()` 的订单 | 不引入新组件，任务不会丢 | 延迟最多一个扫描周期；数据量大时扫描压数据库；多实例要防重复扫描 | 量小、分钟级精度，或者作为兜底 |
| Redis ZSet | score 是执行时间，worker 轮询 score 小于当前时间的成员 | 秒级精度，性能好，`ZREM` 就能取消 | 认领要原子；Redis 故障可能丢任务；单个 key 太大要拆分 | 中等规模、需要取消、愿意自建 |
| MQ 延时消息 | 发送时指定投递时间，到期才对消费者可见 | 开箱即用，可靠性和扩展性由 MQ 保证 | 发出去的消息不好撤回，只能消费时判断；延时有上限 | 已经在用支持延时的 MQ |
| 时间轮 | 环形数组，每格挂一批任务，指针每个 tick 走一格 | 插入、删除 O(1)，海量短延时任务效率高 | 在单机内存里，进程挂了就丢，要自己持久化 | 框架内部的超时管理，或作为调度层的内存结构 |

MQ 的细节：RocketMQ 4.x 默认只有 18 个固定的延时级别（1 秒到 2 小时）；5.x 支持任意时刻的定时消息，官方文档写明定时时长默认最长 24 小时、精度为秒级，超出范围的消息不会报错，而是被立即投递。RabbitMQ 用 TTL + 死信交换机或延时插件，两者的限制见[消息队列选型](/basics/distributed/04-mq-why)。Kafka 没有原生的延时消息。

时间轮的例子：Netty 的 `HashedWheelTimer`、Kafka 内部管理请求超时的延迟操作。延时超过一圈的任务，要么记录"还要转几圈"，要么用多层时间轮（像时钟的时、分、秒）。单机内存里的延时任务也可以用最小堆，Java 的 `DelayQueue` 就基于优先队列，原理见[堆](/basics/algorithm/06-heap-topk)。

订单超时这种量大、要取消、要求可靠的场景，常见组合是**Redis ZSet 或 MQ 延时消息负责准时触发，数据库扫描兜底**：

```text
下单 ──> 订单表（status = UNPAID，expire_at = 下单时间 + 30 分钟）
    └──> 提交延时任务（Redis ZSet 或 MQ 延时消息）
                     │ 到期
                     ▼
           超时处理（多实例）── 条件更新：只取消仍是 UNPAID 的订单 ──> 释放库存、关闭支付单
                     ▲
兜底扫描（每几分钟）：expire_at 已过去一段时间仍是 UNPAID 的订单，再取消一次
支付成功 ──> 订单改成 PAID，顺手 ZREM 取消任务（取消失败也没关系，执行时条件更新会跳过）
```

### 第三步：核心模块和数据模型

做成通用的延时任务服务，多个业务共用：

```sql
CREATE TABLE delay_task (
  id          BIGINT PRIMARY KEY,
  biz_type    VARCHAR(32) NOT NULL,          -- 如 order_timeout
  biz_key     VARCHAR(64) NOT NULL,          -- 如订单号
  execute_at  DATETIME(3) NOT NULL,
  status      TINYINT NOT NULL,              -- 等待、已投递、已取消
  retry_count INT NOT NULL DEFAULT 0,
  topic       VARCHAR(64) NOT NULL,          -- 到期后投递到哪个 MQ 主题
  payload     JSON,
  UNIQUE KEY uk_biz (biz_type, biz_key),     -- 同一个业务对象重复提交只算一个任务
  KEY idx_due (status, execute_at)
);
```

- **分层存储**：数据库保存全部任务，是唯一可信的来源；加载任务每分钟把未来 10 分钟内到期的任务放进 Redis ZSet，几天后才执行的任务不占内存
- **触发**：worker 轮询 ZSet，认领到期任务，投递到业务指定的 MQ 主题，再把任务标为已投递；业务方只管消费消息
- **认领**：多个 worker 同时轮询，一个任务只能被一个 worker 拿到。用 Lua 脚本把"查出到期任务"和"把它们的 score 推后一个租约时长"做成原子操作；处理成功再 `ZREM`。处理失败或进程崩溃，租约到期后任务重新变成"到期"，被别的 worker 认领，比"取出就删除"多一层保险（见代码示例）

### 第四步：关键难点

**任务不丢**：

- 数据库里的任务记录是底线，Redis 数据丢了可以从数据库重新加载；MQ 方案要开启发送确认和持久化，见[消息不丢失](/basics/distributed/05-mq-reliability)
- 兜底扫描定时找出早该执行、却还没处理的任务（订单场景直接扫超时未支付的订单），重新触发
- 不要用 Redis 的过期事件（keyspace notification）做延时任务：官方文档说明过期事件在 key 被真正删除时才发出，可能比 TTL 到期晚很多；而且它基于 Pub/Sub，订阅者断线期间的事件直接丢失

**不重复执行**：至少一次投递下重复无法避免，只能让处理逻辑幂等，见[重复消费与幂等](/basics/distributed/06-mq-idempotent)。订单取消用条件更新：

```sql
UPDATE orders SET status = 'CANCELLED', cancelled_at = NOW()
WHERE order_no = ? AND status = 'UNPAID';
-- 影响 1 行：取消生效，在同一个事务里释放库存；影响 0 行：已支付或已取消过，什么都不做
```

兜底扫描这种"只该一个实例执行"的定时任务，用[分布式锁](/basics/redis/07-distributed-lock)选出执行者，或者按 `id % N` 分给 N 个实例各扫一段。

**支付和超时撞在一起**：用户在第 29 分 59 秒付款，超时任务和支付回调几乎同时到达。两边都是条件更新，谁先执行谁生效；取消先生效时，后到的支付成功要走退款，见[订单和支付系统](/basics/backend-design/08-order-payment)。取消前也可以先调用支付渠道的查询接口，确认没有付款再关闭支付单。

**集中到期和轮询压力**：大促时大量订单在同一分钟创建，30 分钟后同时到期。worker 每次只取一批、限速处理，处理不完的留在队列里，晚几秒取消订单没有影响（RocketMQ 文档也提醒避免大量消息定在同一时刻）。轮询间隔越短越准，空轮询也越多：没有到期任务时休眠一会儿，有积压时连续处理。任务多时把 ZSet 按任务 ID 哈希拆成多个 key，每个 worker 负责其中几个。

### 第五步：扩展与优化

- **平台化**：多个业务共用，按业务类型隔离队列和配额，提供提交、取消、查询接口和管理后台
- **重试和监控**：处理失败时把 score 改成"当前时间 + 退避时长"，超过重试上限转入死信；监控到期未执行的任务数、实际与计划执行时间的偏差，超过阈值告警
- **先用现成的**：Node.js 项目可以先用 BullMQ 的延迟任务（见[任务队列](/basics/node/18-task-queue)），规模上来再考虑自建

## 代码示例

Redis ZSet 延时队列（ioredis），member 是任务 ID，score 是执行时间（毫秒时间戳）：

```js
// 原子认领：取出到期的任务，并把它们的 score 推后到租约结束时间
const CLAIM = `
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
for _, id in ipairs(ids) do
  redis.call('ZADD', KEYS[1], ARGV[3], id)
end
return ids`

export async function schedule(redis, key, taskId, runAt) {
  await redis.zadd(key, runAt, taskId) // 同一个任务 ID 重复提交只会更新执行时间
}

export async function pollOnce(redis, key, handler, { batch = 100, leaseMs = 60_000 } = {}) {
  const now = Date.now()
  const ids = await redis.eval(CLAIM, 1, key, now, batch, now + leaseMs)
  for (const id of ids) {
    try {
      await handler(id) // 必须幂等：租约到期后同一个任务可能被再次认领
      await redis.zrem(key, id) // 处理成功才删除
    } catch (err) {
      console.error('任务处理失败，租约到期后重试', id, err.message)
    }
  }
  return ids.length
}

export async function runPoller(redis, key, handler, { intervalMs = 1000, signal } = {}) {
  while (!signal?.aborted) {
    const n = await pollOnce(redis, key, handler).catch(() => 0)
    if (n === 0) await new Promise((r) => setTimeout(r, intervalMs)) // 没有到期任务才休眠
  }
}
```

## 面试官可能追问

::: details Redis 挂了或者主从切换，ZSet 里的任务丢了怎么办？
Redis 主从是异步复制，切换时最近写入的任务可能丢失；单机重启时会丢多少，取决于持久化方式和 AOF 的刷盘策略。所以 ZSet 只做"准时触发"的加速层，任务以数据库为准：Redis 恢复后从数据库重新加载未完成的任务，兜底扫描也会补上漏掉的。订单场景下，最坏情况只是某些订单晚几分钟被取消。
:::

::: details 用 MQ 延时消息，订单已经支付了，消息怎么取消？
一般不撤回，让它照常投递。消费时按订单号查状态，或者直接执行带 `status = 'UNPAID'` 条件的更新，已支付的订单影响 0 行，什么都不做，成本很低。如果取消的比例很高（比如大多数订单都会按时支付），大量无效消息浪费资源，这时用支持直接删除的 Redis ZSet 更合适。
:::

::: details 时间轮是怎么工作的？
时间轮是一个环形数组，每一格代表一个时间间隔（tick），格子里挂着这段时间到期的任务链表。指针每个 tick 前进一格，执行当前格子里的任务。插入任务时按"延时 ÷ tick"算出放在哪一格，复杂度 O(1)。延时超过一圈时，可以在任务上记录剩余圈数，指针经过时减 1，减到 0 才执行；或者用多层时间轮，粗粒度的轮子到期后把任务降级放进细粒度的轮子。
:::

::: details 为什么不在服务里直接用 setTimeout？
进程重启，内存里的定时器全部丢失；服务部署了多个实例，每个实例都可能执行；任务多了内存也撑不住。进程内定时器只适合不重要、可丢失的短延时操作，业务上的延时任务要持久化，并由独立的调度组件触发。
:::

## 易错点

- 用 Redis 过期事件做延时任务，事件可能延迟，订阅者断线时还会直接丢失
- 取出任务就删除，处理失败或进程崩溃后任务永远丢了
- 超时取消写成 `UPDATE orders SET status = 'CANCELLED' WHERE order_no = ?`，不带原状态条件，把刚支付的订单取消了
- 只有一种触发机制，没有兜底扫描，丢了的任务没人发现
