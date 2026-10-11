---
difficulty: 2
tags: [高频, 实践]
---

# 消息队列怎么保证消息不丢失？

::: tip 一句话回答
消息会在三个环节丢：**生产者发送、Broker 存储、消费者处理**，要逐个堵住。生产端等 Broker 确认后才算发送成功，失败就重试（Kafka 设置 `acks=all`，RabbitMQ 开启 **publisher confirms**）；Broker 端持久化并多副本存储（Kafka 设置 `replication.factor=3`、`min.insync.replicas=2`，并关闭 unclean 选举）；消费端**处理成功后再提交 offset 或 ack**，不要自动提交。这样做到的是"至少一次"，代价是可能重复，所以消费者要幂等。最后再用对账兜底。
:::

## 详细解析

### 消息会在哪里丢

```text
生产者 ──①网络失败/没等确认──> Broker ──②只在内存/Leader 宕机──> 消费者 ──③先提交后处理，处理时崩溃
```

### ① 生产者：等确认，失败重试

Kafka 的 `acks` 决定 Leader 收到多少确认才回复生产者：

| 取值 | 含义 | 丢消息的情况 |
| --- | --- | --- |
| `acks=0` | 不等任何确认，写入 socket 缓冲区就算发送成功 | 网络或 Broker 任何问题都会丢，`retries` 也不生效 |
| `acks=1` | Leader 写入本地日志就确认，不等 Follower | Leader 确认后、Follower 复制前宕机，消息丢失 |
| `acks=all`（即 `-1`） | 等 ISR（同步副本集合）里的所有副本都确认 | 只要还有一个同步副本存活就不会丢 |

另外几个要点：

- 发送是异步的，必须检查发送结果（回调或 Promise），失败时记录日志或落库补发，不能"发完就不管"
- `retries` 配合 `delivery.timeout.ms` 控制重试多久。重试可能造成重复，开启 `enable.idempotence=true` 后 Broker 会按生产者 ID 和序列号去重，并保证单分区内不乱序。幂等要求 `acks=all`、`retries` 大于 0、`max.in.flight.requests.per.connection` 不超过 5
- Kafka 3.0 起 Java 客户端默认 `acks=all` 并开启幂等（幂等默认值因为一个 bug，到 3.0.1、3.1.1、3.2.0 才真正生效）。没有显式开启幂等、又配了冲突的参数（比如 `acks=1`）时，幂等会被悄悄关闭；显式写 `enable.idempotence=true` 后再配冲突参数会直接报配置错误，所以建议显式写出来。其他语言的客户端默认值不一定相同，要看各自文档

RabbitMQ 对应的是 **publisher confirms**：把 channel 设为 confirm 模式后，Broker 对每条消息回复 ack 或 nack。对于路由到持久化队列的持久化消息，ack 在消息写入磁盘后才发出；quorum 队列要等多数副本确认后才发出。还要注意路由失败：消息找不到匹配的队列时默认被直接丢弃，而且 Broker **照样回复 ack**，光靠 confirm 发现不了。要设置 `mandatory` 标志接收退回的消息（`basic.return`），或者给交换机配置备用交换机（alternate exchange）。

### ② Broker：持久化和副本

Kafka 的副本机制：每个分区有一个 Leader 和多个 Follower，跟得上 Leader 的副本组成 **ISR**。

```properties
# 主题级别：3 个副本
replication.factor=3
# acks=all 时，ISR 至少要有 2 个副本，否则生产者收到 NotEnoughReplicas 异常
min.insync.replicas=2
# 不允许不在 ISR 里的副本当选 Leader（默认就是 false）
unclean.leader.election.enable=false
```

`min.insync.replicas` 拒绝写入的检查只对 `acks=all` 的请求生效，`acks=1` 的写入不受它约束。只设 `acks=all` 不够：如果 ISR 缩到只剩 Leader 自己，`acks=all` 就退化成了 `acks=1`。3 副本加最少 2 个同步副本，能容忍一个副本故障而继续写入。

Kafka 默认不会每条都刷盘：数据先进入页缓存，由操作系统在后台刷盘。官方文档也不建议配置强制刷盘，而是靠多副本保证可靠性，多个副本所在的机器同时掉电的概率很低。

RabbitMQ 的 classic 队列要同时满足**队列声明为 durable** 和**消息设为 persistent**，但它只存在于一个节点上，这个节点的磁盘坏了照样丢。经典队列镜像已在 RabbitMQ 4.0 中移除，需要副本时用 **quorum queue**：基于 Raft 复制，多数副本写入后才确认，本身总是持久化的，不论消息是否标记为 persistent 都会写盘。

### ③ 消费者：处理完再提交

Kafka Java 消费者默认 `enable.auto.commit=true`，每隔 `auto.commit.interval.ms`（默认 5 秒）自动提交已经由 `poll` 返回的消息的 offset。如果在 poll 循环里同步处理完再 poll，自动提交大体是至少一次；但只要把消息交给线程池或异步任务处理，就可能出现 offset 已经提交、业务还没处理完进程就崩溃的情况，重启后从新 offset 开始消费，这批消息就丢了。

正确做法是关闭自动提交，**业务处理成功后再手动提交**。处理完、提交前崩溃，重启后会重复消费，靠 [幂等](/basics/distributed/06-mq-idempotent) 解决。

RabbitMQ 消费时设置 `noAck: false`（手动确认），处理成功再 `ack`。处理失败时 `nack` 并决定是否重新入队；反复失败的消息不要无限重新入队，应该转入死信队列。quorum 队列有投递次数上限（`delivery-limit`），超过后消息会被丢弃，配置了死信交换机才会转入死信，所以一定要配死信。

### 对账兜底

上面的手段能把丢失的概率降到很低，但无法覆盖所有情况（比如代码 bug 漏发）。核心业务还要有对账：定时比对上下游数据（比如订单表和积分流水），发现缺失就补发消息或修复数据。

## 代码示例

RabbitMQ（amqplib），生产端等确认，消费端手动 ack：

```js
import amqp from 'amqplib'

const conn = await amqp.connect('amqp://localhost')

// 生产者：confirm channel + 持久化消息
const pubCh = await conn.createConfirmChannel()
// quorum 队列 + 死信交换机（order.dlx 需要另外声明并绑定死信队列）
await pubCh.assertQueue('order.created', {
  durable: true,
  arguments: { 'x-queue-type': 'quorum', 'x-dead-letter-exchange': 'order.dlx' },
})
pubCh.sendToQueue('order.created', Buffer.from(JSON.stringify({ orderId: 1001 })), { persistent: true })
await pubCh.waitForConfirms() // 有消息被 nack 时会抛出异常，调用方负责重试或落库补发

// 消费者：手动确认，并限制未确认消息的数量
const subCh = await conn.createChannel()
await subCh.prefetch(10)
await subCh.consume('order.created', async (msg) => {
  try {
    await handleOrderCreated(JSON.parse(msg.content.toString())) // 业务处理要幂等
    subCh.ack(msg) // 处理成功后才确认
  } catch (err) {
    subCh.nack(msg, false, false) // 不重新入队，转入死信交换机
  }
}, { noAck: false })
```

## 面试官可能追问

::: details acks=all 和 min.insync.replicas 是什么关系？
`acks=all` 是生产者说"要等所有同步副本确认"，但同步副本有几个是动态的；`min.insync.replicas` 是主题说"同步副本至少要有几个，否则拒绝写入"。两个配合起来才能保证每条确认过的消息至少在 N 个副本上。`min.insync.replicas` 一般不要设成等于副本数，否则任何一个副本故障，这个分区就无法用 `acks=all` 写入了。
:::

::: details 什么是 unclean 选举？为什么要关掉？
所有 ISR 副本都宕机时，如果允许不在 ISR 里的落后副本当选 Leader，分区能更快恢复可用，但落后的那部分消息就丢了。关掉它就是在可用性和一致性之间选了一致性：宁可分区暂时不可用，也等 ISR 里的副本恢复。日志类可以容忍丢失的主题可以单独打开。
:::

::: details 消费者处理很慢，会不会因为超时导致问题？
会。Kafka 消费者两次 `poll` 的间隔超过 `max.poll.interval.ms`，会被认为已经失效，触发 rebalance，分区分给别的消费者，而这批消息还没提交 offset，就会被重复消费。处理慢时可以减小每次拉取的数量（`max.poll.records`），或者把耗时操作移到独立的线程池，同时管理好 offset 提交。
:::

## 易错点

- 只配了 `acks=all` 没配 `min.insync.replicas`，ISR 只剩 Leader 时照样可能丢
- RabbitMQ classic 队列只设成 durable，消息没设 persistent，重启后消息还是会丢
- 消费者开着自动提交，或者先 ack 再处理
- 以为做到这些就是"恰好一次"，实际是"至少一次"，重复要靠幂等处理
