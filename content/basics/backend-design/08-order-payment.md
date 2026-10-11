---
difficulty: 3
tags: [系统设计, 场景题]
---

# 设计一个订单和支付系统

::: tip 一句话回答
订单的核心是**状态机**：待支付、已支付、已发货、已完成、已取消、退款中、已退款，每次流转都用**带原状态的条件更新**（`UPDATE ... WHERE status = 'UNPAID'`），按影响行数判断是否成功，并发和重复请求自然被挡住。下单用**请求号 + 唯一索引**保证幂等。订单和**支付单**分开：创建支付单、跳转第三方、等**异步回调**；回调要**验签**、核对金额，**幂等**处理，迟迟收不到回调就**主动查询**补偿。库存一般**下单预占、支付确认、超时释放**。跨服务的一致性用本地消息表或事务消息做**最终一致**，每天和渠道**对账**兜底。金额一律用**整数分**。
:::

## 详细解析

### 第一步：澄清需求

- **范围**：下单、支付、取消、发货、确认收货、退款；接哪些支付渠道。先不考虑拆单（一笔订单多个商家）和分次支付
- **一致性**：钱和订单状态不能错，宁可慢一点，也不能多扣、少扣、重复发货

量级估算（假设值）：每天 100 万笔订单，平均 100 万 / 86400 ≈ 12 单/秒，大促峰值按 50 倍算约 580 单/秒（秒杀另见[秒杀系统](/basics/backend-design/02-seckill)）。每单连同明细按 2 KB 算，每天约 2 GB、一年约 730 GB，订单要长期保存，需要规划分库分表和归档。

### 第二步：整体架构

```text
用户 ──> 订单服务 ──预占库存──> 库存服务
           │ 创建订单（待支付），超时未支付由延时任务取消
           ▼
         支付服务 <────────> 第三方支付
           │ ① 创建支付单，调用渠道的下单接口
           │ ② 接收异步回调：验签、核对、幂等更新
           │ ③ 迟迟没有回调：主动调用查询接口
           ▼ 支付成功：支付单、订单状态、本地消息在一个事务里提交
         MQ ──> 发货、积分、通知（各自幂等）；对账服务每天和渠道账单逐笔核对
```

### 第三步：核心模块和数据模型

**订单状态机**（每次流转都把"从哪个状态来"写进 `WHERE`，影响 0 行说明状态已经变了，返回错误而不是覆盖）：

```text
        支付成功             发货            确认收货 / 超时自动确认
待支付 ─────────> 已支付 ─────────> 已发货 ─────────────────────> 已完成
  │                 │                 │                            │
  │ 超时 / 用户取消   └─── 申请退款 ────┴───── 售后期内申请退款 ───────┘
  ▼                                   ▼
已取消                               退款中 ──退款成功──> 已退款
                                      └── 驳回或撤销：回到申请前的状态
```

```sql
-- 发货：只有已支付的订单能发货
UPDATE orders SET status = 'SHIPPED', shipped_at = NOW() WHERE order_no = ? AND status = 'PAID';
-- 申请退款：记下申请前的状态，驳回时还原。MySQL 单表 UPDATE 从左到右赋值，后面的赋值读到的是新值
-- （和标准 SQL 不同），所以 status_before_refund 必须写在 status 前面，写反了会存成 REFUNDING
UPDATE orders SET status_before_refund = status, status = 'REFUNDING'
WHERE order_no = ? AND status IN ('PAID', 'SHIPPED', 'COMPLETED');
```

**数据模型**（金额都是 BIGINT，单位为分）：

```sql
CREATE TABLE orders (
  order_no   VARCHAR(32) PRIMARY KEY,     -- 分布式 ID 生成，不用自增 ID
  user_id    BIGINT NOT NULL,
  request_id VARCHAR(64) NOT NULL,        -- 客户端生成的请求号，下单幂等用
  status     VARCHAR(16) NOT NULL, status_before_refund VARCHAR(16),
  total_amount BIGINT NOT NULL, pay_amount BIGINT NOT NULL,  -- 商品总额、优惠后实付
  expire_at  DATETIME NOT NULL, paid_at DATETIME, shipped_at DATETIME, created_at DATETIME NOT NULL,
  UNIQUE KEY uk_req (user_id, request_id)
);
CREATE TABLE payment (                    -- 支付单：一笔订单可能有多次支付尝试
  pay_no   VARCHAR(32) PRIMARY KEY,       -- 传给渠道的商户订单号
  order_no VARCHAR(32) NOT NULL,
  channel  VARCHAR(16) NOT NULL, amount BIGINT NOT NULL,
  status   VARCHAR(16) NOT NULL,          -- PAYING / SUCCESS / CLOSED
  channel_trade_no VARCHAR(64) UNIQUE, paid_at DATETIME,  -- 渠道的交易号、支付时间
  KEY idx_order (order_no)
);
-- 另有 order_item（下单时的商品快照）、refund（退款单）、outbox（本地消息表）
```

**下单幂等**：用户重复点击、客户端超时重试，都不能生成两笔订单。客户端进入确认页时生成 `request_id`，重试时带同一个；服务端插入时 `(user_id, request_id)` 唯一索引冲突，就查出已有订单直接返回。思路和 `Idempotency-Key` 一样，见 [RESTful 规范](/basics/network/17-restful)。

### 第四步：关键难点

**支付流程**：

1. 用户点击支付：确认订单仍是待支付，创建支付单（新的 `pay_no`），调用渠道的下单接口，拿到支付参数或跳转链接。用户付完款回到结果页，**前端拿到的结果不可信**，只用来显示"支付处理中"，状态以服务端为准
2. 渠道异步回调：验签（微信支付 v3 的报文还要解密）；核对 app_id、商户号、金额与支付单一致，并确认交易状态是支付成功（例如支付宝只有 `TRADE_SUCCESS`、`TRADE_FINISHED` 才算付款成功）；幂等更新支付单和订单；按渠道要求应答，例如支付宝返回字符串 `success`，微信支付 v3 返回 200 或 204 状态码
3. 没有收到成功应答，渠道会按递增的间隔重发通知；一段时间后仍没有回调，由定时任务调用渠道的**查询接口**主动确认。订单超时取消前也先查一次，确认没付款再调用渠道的关单接口

**回调的并发和乱序**：同一笔支付的多次通知可能同时到达；超时取消和支付成功可能撞在一起；用户还可能换个渠道又付了一次。处理原则：`SELECT ... FOR UPDATE` 锁住支付单，让同一笔支付的通知串行处理；订单状态用条件更新，钱收到了但订单已取消或已被另一笔支付付过，就生成退款任务，而不是丢掉这笔钱（见代码示例）。

**库存扣减时机**：

| 方案 | 做法 | 优点 | 缺点 | 适用场景 |
| --- | --- | --- | --- | --- |
| 下单预占 | 下单时锁定库存，支付后确认扣减，超时取消时释放 | 付款时一定有货 | 下单不付款会占住库存，要靠超时释放和限购 | 大多数电商、秒杀 |
| 支付时扣 | 支付成功才扣库存 | 未付款的订单不占库存 | 付了钱可能没货，只能退款，体验差 | 库存充足的商品、虚拟商品 |

预占用条件更新防超卖：`UPDATE inventory SET available = available - ?, locked = locked + ? WHERE sku_id = ? AND available >= ?`。超时释放用[延时任务](/basics/backend-design/07-delay-task)。

**分布式事务**：订单、库存、支付、积分分属不同服务，不用 2PC。订单改为已支付和写入"订单已支付"消息放在同一个本地事务里，发货、积分、通知各自消费并幂等处理，见[分布式事务](/basics/distributed/02-distributed-transaction)。

**对账**：每天下载渠道的对账单，和支付单逐笔比对：渠道成功、自己不是成功（漏处理的回调，补单）；自己成功、渠道没有（可疑，要查）；金额不一致。差异进入差错处理流程，自动修复或人工核查。

**金额用整数分**：浮点数不能精确表示 0.1（见[浮点数精度](/basics/javascript/20-float-precision)），金额用 BIGINT 存分，计算全用整数；必须带小数就用 DECIMAL。分摊优惠时把除不尽的余数给最后一项，保证明细加起来等于总额。

### 第五步：扩展与优化

- **分库分表和归档**：按 `user_id` 分片，买家查自己的订单不跨分片；订单号里嵌入分片信息，按订单号也能直接定位；商家后台按商家查，用 binlog 同步一份按 `seller_id` 分片的数据，见[分库分表](/basics/mysql/12-sharding)。完成很久的订单迁到历史库
- **渠道治理**：某个渠道故障时在收银台隐藏它；监控各渠道的成功率和回调延迟

## 代码示例

支付回调的幂等处理（Node.js + mysql2）。`notify` 已经验签、解密，确认是支付成功的通知，金额已换算成整数分：

```js
export async function onPayNotify(pool, notify) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 锁住支付单：同一笔支付的并发通知在这里排队
    const [[pay]] = await conn.query('SELECT * FROM payment WHERE pay_no = ? FOR UPDATE', [notify.payNo])
    if (!pay) throw new Error(`支付单不存在：${notify.payNo}`)
    // 统一转成 BigInt 再比较：mysql2 的 BIGINT 按配置可能返回 Number 或字符串（supportBigNumbers）
    if (BigInt(pay.amount) !== BigInt(notify.amount)) throw new Error(`金额不一致：${notify.payNo}`) // 告警，转人工
    if (pay.status === 'SUCCESS') {
      await conn.commit()
      return 'DUPLICATE' // 重复通知，直接应答成功
    }
    await conn.query("UPDATE payment SET status = 'SUCCESS', channel_trade_no = ?, paid_at = ? WHERE pay_no = ?",
      [notify.channelTradeNo, notify.paidAt, notify.payNo])
    // 条件更新：只有待支付的订单才能变成已支付
    const [r] = await conn.query("UPDATE orders SET status = 'PAID', paid_at = ? WHERE order_no = ? AND status = 'UNPAID'",
      [notify.paidAt, pay.order_no])
    // 影响 0 行：订单已超时取消，或已被另一笔支付付过。钱已经收到，转入自动退款
    const topic = r.affectedRows === 1 ? 'order-paid' : 'refund-required'
    await conn.query('INSERT INTO outbox (id, topic, payload) VALUES (?, ?, ?)',
      [`${topic}:${notify.payNo}`, topic, JSON.stringify(notify)])
    await conn.commit()
    return topic
  } catch (err) {
    await conn.rollback()
    throw err // 应答失败，等渠道重发；主动查询任务也会补偿
  } finally {
    conn.release()
  }
}
```

## 面试官可能追问

::: details 用户说已经付款了，页面却一直显示待支付，怎么处理？
先看回调有没有到、有没有处理失败（验签失败、金额不一致都会告警）。系统层面要有补偿：结果页轮询服务端状态，提供"我已支付"按钮触发一次主动查询；定时任务对"已创建支付单、超过几分钟仍未成功"的记录调用渠道查询接口。查到已支付就走和回调相同的处理逻辑，两条路径共用一套幂等代码。
:::

::: details pay_no 为什么不直接用订单号？
一笔订单可能发起多次支付：用户换了渠道、第一次支付超时关闭后重新支付。渠道通常要求同一个商户订单号的参数不能变，复用订单号会冲突。所以每次支付生成新的 `pay_no`，订单和支付单是一对多；如果有两笔都支付成功，按代码示例的逻辑，后到的那笔自动退款。
:::

::: details 退款怎么设计？
单独建退款单，有自己的状态机（退款中、成功、失败），退款单号作为幂等键传给渠道，重复提交不会退两次。部分退款在订单上记录已退金额，用条件更新保证不超额：`UPDATE orders SET refunded = refunded + ? WHERE order_no = ? AND refunded + ? <= pay_amount`。渠道的退款结果同样是异步通知加主动查询，退款成功后再收回积分、优惠券等权益。
:::

## 易错点

- 把前端跳转回来的支付结果当成支付成功的依据，状态只能以服务端的回调和查询为准
- 回调只验签不核对金额、商户号，或者处理失败了仍然应答成功，渠道不再重发，这笔支付就漏了
- 状态流转不带原状态条件，超时取消把刚支付的订单覆盖成已取消
