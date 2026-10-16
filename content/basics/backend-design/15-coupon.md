---
difficulty: 3
tags: [系统设计, 场景题]
---

# 设计一个优惠券系统

::: tip 一句话回答
数据模型分两层：**券模板**（面额、门槛、有效期、总量、每人限领）和**用户券**（某个人领到的一张券，有自己的状态）。难点在两头：**发券**时防超发、防超领，热门券用 Redis 原子扣减库存，数据库用唯一约束兜底；**用券**时和订单保持一致，用**状态机** `未使用 → 锁定 → 已使用`，下单时锁定，支付成功转为已使用，订单取消或超时就**回退**为未使用。所有状态变更都用带前置状态的条件更新，保证幂等。
:::

## 详细解析

### 第一步：澄清需求

- **券的类型**：满减（满 100 减 20）、折扣（8 折，最多减 50）、无门槛；适用范围：全场、某品类、某些商品、某个店铺
- **发券方式**：用户主动领取（可能是秒杀式抢券）、系统批量发放（给 100 万老用户每人一张）、行为触发（注册送券、下单返券）
- **用券**：结算页列出可用的券并推荐最优；下单锁券；支付后核销；取消订单退券
- **约束**：总量不能超发；每人限领 N 张；有效期可以是固定时间段，也可以是领取后 N 天
- **量级（假设值）**：日常领券几百次/秒；大促抢券峰值几万次/秒，集中在少数几个热门券模板上

### 第二步：整体架构

```text
运营后台 ──► 券模板管理（创建、审核、上下线）
                    │
用户 ──► 领券接口 ──► 券服务 ──► Redis（模板库存、每人已领数）
                        │  └──► MySQL（模板表、用户券表）
批量发券任务 ──► MQ ──► 发券消费者（分批写入）
                        │
订单服务 ──► 查询可用券 / 锁券 / 核销 / 退券
```

券服务对订单服务提供锁定、核销、回退三个接口，它们是一致性的关键。

### 第三步：核心模块和数据模型

```sql
CREATE TABLE coupon_template (
  id            BIGINT PRIMARY KEY,
  type          TINYINT NOT NULL,        -- 满减、折扣、无门槛
  threshold     INT NOT NULL,            -- 门槛金额，单位分
  discount      INT NOT NULL,            -- 减多少分，或折扣率
  scope         JSON NOT NULL,           -- 适用范围
  total         INT NOT NULL,
  issued        INT NOT NULL DEFAULT 0,  -- 已发数量
  per_user      INT NOT NULL,            -- 每人限领
  valid_type    TINYINT NOT NULL,        -- 固定时间段 / 领取后 N 天
  start_at      DATETIME, end_at DATETIME, valid_days INT,
  status        TINYINT NOT NULL
);

CREATE TABLE user_coupon (
  id           BIGINT PRIMARY KEY,
  user_id      BIGINT NOT NULL,
  template_id  BIGINT NOT NULL,
  seq          INT NOT NULL,             -- 该用户领这个模板的第几张，配合唯一键限领
  status       TINYINT NOT NULL,         -- 0 未使用 1 锁定 2 已使用 3 已过期
  order_id     BIGINT,
  expire_at    DATETIME NOT NULL,        -- 领取时就算好
  UNIQUE KEY uk_user_tpl_seq (user_id, template_id, seq),
  KEY idx_user_status (user_id, status, expire_at)
);
```

金额统一用整数的"分"存，避免浮点误差。

### 第四步：关键难点

**领券防超发、防超领**

普通券直接用数据库：`UPDATE coupon_template SET issued = issued + 1 WHERE id = ? AND issued < total`，影响行数为 1 才算抢到，再插入用户券，两步放在一个事务里。`(user_id, template_id, seq)` 唯一键挡住同一个人的重复领取，每人限 1 张时 `seq` 固定为 1。

热门券并发高，单行库存成为热点。做法和[秒杀](/basics/backend-design/02-seckill)类似：

1. 券上线时把库存加载到 Redis
2. 用 Lua 脚本原子执行：检查用户已领数量 < 限领数、库存 > 0，然后库存减一、用户已领数加一
3. 成功后发 MQ，消费者异步写用户券表；数据库唯一键兜底防重
4. 前端按钮防重复点击，接口按用户限频（限流算法见 [Redis 限流](/basics/redis/10-rate-limit)，这里不展开）

Redis 扣了库存但消息没发出去，会出现"少发"。少发比超发好处理：定时对账，把 Redis 的扣减记录和数据库里实际发出的券对比，补发或还回库存。

**批量发券**：给 100 万人发券不能在一个请求里做。把用户列表拆成批次投递到 MQ，消费者每批写几百条；以 `(user_id, template_id, seq)` 唯一键保证重复消费不会多发；记录任务进度，失败可以断点续发。

**用券和订单的一致性**

```text
未使用 ──下单锁定──► 锁定 ──支付成功──► 已使用
  ▲                   │
  └──订单取消/超时────┘
未使用 ──到期──► 已过期
```

- 锁定：`UPDATE user_coupon SET status = 1, order_id = ? WHERE id = ? AND user_id = ? AND status = 0 AND expire_at > NOW()`
- 核销：`... SET status = 2 WHERE id = ? AND status = 1 AND order_id = ?`
- 回退：`... SET status = 0, order_id = NULL WHERE id = ? AND status = 1 AND order_id = ?`

每一步都带上前置状态和 `order_id`，重复调用影响 0 行，天然幂等；也防止 A 订单的回退把 B 订单锁的券放出来。订单超时取消由[延时任务](/basics/backend-design/07-delay-task)触发退券。下单时锁券和扣库存、创建订单跨了多个服务，用本地消息表或 TCC 这类方案保证最终一致（见 [分布式事务](/basics/distributed/02-distributed-transaction)），完整的下单流程见 [订单和支付系统](/basics/backend-design/08-order-payment)。

**结算页算最优券**：先用状态和有效期筛出用户的可用券，再按订单里的商品逐张判断适用范围和门槛，计算优惠金额，排序推荐。用户的券一般只有几十张，在内存里算即可；能否叠加使用要由规则明确定义。

### 第五步：扩展与优化

- **过期处理**：查询时用 `expire_at > NOW()` 判断即可，不必实时改状态；定时任务批量把过期的券标记为已过期，并在过期前发提醒
- **分库分表**：用户券表按 `user_id` 分片，"我的券"和下单锁券都在单个分片内
- **防刷**：领券接口校验设备、账号风险等级；大额券要求实名或绑定手机
- **数据统计**：领取率、核销率、带来的订单金额，为运营评估活动效果

## 面试官可能追问

::: details 订单支付了，但核销券的请求失败了怎么办？
支付成功是事实，券必须最终被核销。核销请求失败就重试，核销接口是幂等的，可以放心重试；同时有定时对账，找出"订单已支付但券仍是锁定"的记录补核销。反过来，券一直锁定但订单已经取消的，也由对账任务回退。
:::

::: details 一个订单拆成多个子订单，券怎么分摊？
按各子订单商品金额的比例把优惠分摊下去，最后一个子订单用总优惠减去前面已分摊的部分，避免四舍五入导致总额对不上。分摊结果要保存，部分退款时按分摊后的金额退，否则用户退一件商品可能拿回比实付更多的钱。
:::

::: details 券码兑换（输入一串码领券）怎么设计？
提前生成一批券码，和模板关联存表，码要随机、不可预测，不能用连续的自增号。兑换时用 `WHERE code = ? AND status = 0` 条件更新，成功才发券；兑换接口要按用户和 IP 限频，防止被暴力枚举。
:::

## 易错点

- 先查库存再扣减，分成两步，并发下必然超发；要用条件更新或 Redis 原子脚本
- 退券时只按券 ID 更新，不校验 `order_id` 和当前状态，可能把别的订单锁住的券放出来
- 金额用浮点数计算，折扣和分摊出现几分钱的误差
- 领取后 N 天有效的券，查询时现算过期时间，规则改了已发的券跟着变；应在领取时写死 `expire_at`
