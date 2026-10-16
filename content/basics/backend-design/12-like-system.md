---
difficulty: 3
tags: [系统设计, 高频]
---

# 设计一个点赞系统

::: tip 一句话回答
点赞系统要存两类数据：**点赞关系**（谁赞了什么，用来防重复和展示"我赞过"）和**点赞计数**（每个内容多少个赞）。关系落库，用 `(user_id, target_id)` 唯一索引保证幂等；计数单独存，用 **Redis 原子自增**扛住高并发，再**异步批量**写回数据库。读多写多的热点内容，计数可以拆成多个分片求和。查询列表里每条是否被我赞过，用 Redis 集合或批量查关系表，不要逐条查库。计数允许短暂不准，但关系不能错。
:::

## 详细解析

### 第一步：澄清需求

- **功能**：点赞、取消点赞；显示点赞数；列表页显示"我是否赞过"；"我赞过的内容"列表；被赞时通知作者（可选）
- **对象**：文章、评论、视频，用 `target_type + target_id` 统一表示
- **一致性**：点赞数延迟几秒可以接受；同一人不能重复计数；取消后要能再赞
- **量级（假设值）**：日活 1000 万，每人每天点赞 10 次，写约 1200 次/秒，峰值按 10 倍约 1.2 万次/秒；读远多于写，每次刷列表都要读计数和点赞状态，峰值读几十万次/秒

### 第二步：整体架构

```text
客户端 ─► 点赞服务 ──① 写关系（Redis + MQ）
              │      ② 计数 INCR（Redis）
              │      ③ 发事件 ─► MQ ─► 落库消费者 ─► MySQL（关系表、计数表）
              │                     └─► 通知服务、推荐系统
              └─ 读：Redis 计数 / 状态，未命中回源 MySQL
```

写路径的关键是**先保证关系的幂等，再改计数**；落库、通知、推荐这些下游通过消息队列异步处理（选型见 [消息队列](/basics/distributed/04-mq-why)）。

### 第三步：核心模块和数据模型

```sql
-- 点赞关系：唯一索引保证一个人对一个内容只有一条
CREATE TABLE likes (
  id          BIGINT PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  target_type TINYINT NOT NULL,
  target_id   BIGINT NOT NULL,
  status      TINYINT NOT NULL DEFAULT 1,  -- 1 已赞，0 已取消
  updated_at  DATETIME NOT NULL,
  UNIQUE KEY uk_user_target (user_id, target_type, target_id),
  KEY idx_target (target_type, target_id, updated_at)
);

-- 点赞计数：和内容主表分开，避免热点行锁住内容表
CREATE TABLE like_counts (
  target_type TINYINT NOT NULL,
  target_id   BIGINT NOT NULL,
  cnt         BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (target_type, target_id)
);
```

Redis 里的结构：

| Key | 类型 | 作用 |
| --- | --- | --- |
| `like:cnt:{type}:{id}` | String | 点赞数，`INCR` / `DECR` |
| `like:users:{type}:{id}` | Set 或 ZSet | 最近点赞的用户，用于判断状态和展示"谁赞了" |
| `like:user:{uid}` | ZSet，score 是时间 | 用户赞过的内容，"我的点赞"列表 |

**点赞流程**：用 Lua 脚本把"判断是否已赞 → 加入集合 → 计数加一"做成一个原子操作（写法见 [Pipeline 和 Lua](/basics/redis/12-pipeline-lua)），`SADD` 返回 0 说明已经赞过，直接返回成功，不再加计数。成功后发一条消息，消费者用 `INSERT ... ON DUPLICATE KEY UPDATE status = 1` 落库，消费天然幂等（见 [幂等](/basics/distributed/06-mq-idempotent)）。取消点赞对称处理。

### 第四步：关键难点

**计数写回数据库**：每次点赞都 `UPDATE like_counts SET cnt = cnt + 1`，热门内容会变成热点行，大量请求排队等同一把行锁（见 [MySQL 的锁](/basics/mysql/07-locks)）。改成消费者在内存里按 target 聚合，每隔一两秒或攒够一批，再一次性 `cnt = cnt + N` 写入。Redis 的计数是读的主数据源，数据库的值用于持久化和 Redis 丢数据后的恢复。

**热点内容**：某条内容爆了，单个计数 key 的 QPS 打到一台 Redis 上。可以把计数拆成 N 个分片 key（`cnt:{id}:0` ~ `cnt:{id}:N-1`），写时随机选一个，读时把 N 个加起来，再加一层本地缓存，读请求不用每次都去 Redis（更多见 [大 Key 和热 Key](/basics/redis/09-big-hot-key)）。

**大 V 的点赞集合太大**：一条内容几百万个赞，把所有点赞用户放进一个 Set 就是大 Key。只在 Redis 保留最近的一部分用于展示，判断"我是否赞过"改为查用户维度的数据：用户赞过的内容数量通常有限，或者用 `likes` 表的唯一索引查。

**列表页批量查状态**：一页 20 条内容，用一次 Pipeline 查 20 个 `SISMEMBER`，或者一次 `SELECT ... WHERE user_id = ? AND target_id IN (...)`，不要循环查 20 次。

**连点和刷赞**：客户端防抖；服务端按用户限频，同一个人短时间内反复点赞取消只记最后状态；异常账号的点赞走风控过滤。

### 第五步：扩展与优化

- **分库分表**：关系表按 `user_id` 分片，"我的点赞"查询在单分片内；"某内容被谁赞"走另一份按 `target_id` 分片的冗余表，或者只查 Redis（分片方法见 [分库分表](/basics/mysql/12-sharding)）
- **数据核对**：定期用关系表 `COUNT` 抽样核对计数表，修正偏差
- **展示优化**：超过一万显示成 "1.2 万"，前端可以先乐观更新数字，失败再回滚
- **通知合并**：短时间内大量点赞合并成"某某等 100 人赞了你"，见 [消息通知系统](/basics/backend-design/10-notification)

## 面试官可能追问

::: details Redis 挂了或者数据丢了，计数怎么恢复？
关系数据以 MySQL 为准，计数表是定期聚合写入的，Redis 丢了可以先从计数表重建缓存，再用关系表 `COUNT` 校准。恢复期间可以降级：只展示数据库里的计数，点赞请求直接写 MQ 排队，不依赖 Redis。
:::

::: details 为什么不直接在内容表里加一个 like_count 字段？
可以，量小时这是最简单的。问题是内容表是读最多的表，把高频写的计数放进去，热门内容的行锁会影响对这行的其他更新；缓存里的内容对象也会因为计数变化频繁失效。拆出单独的计数表或计数服务，读写互不干扰。
:::

::: details 点赞数要求绝对准确怎么办？
绝大多数场景不需要，用户感知不到几秒的延迟和极少量偏差。真要求准确（比如投票按票数发奖），就把关系表当唯一事实来源，用事务同时写关系和计数，接受更低的写吞吐，或者活动结束后用关系表重新统计一次作为最终结果。
:::

## 易错点

- 只存计数不存关系，无法防止重复点赞，也做不了"我是否赞过"
- 判断是否已赞和计数加一分成两步，并发下同一个人能加两次，必须原子执行或依赖唯一索引
- 每个点赞直接 `UPDATE` 数据库计数，热门内容的行锁成为瓶颈
- 把几百万点赞用户塞进同一个 Redis Set，造成大 Key
