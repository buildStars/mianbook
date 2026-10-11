---
difficulty: 3
tags: [系统设计, 场景题, 高频]
---

# 设计一个实时排行榜

::: tip 一句话回答
实时排行榜的核心是 **Redis ZSet**：`ZINCRBY` 加分，`ZREVRANGE` 取前 N 名，`ZREVRANK` 查自己的名次，复杂度都是 O(log N) 级别。**同分排序**靠把时间编码进 score：score = 分数 × 2^28 + (2^28 − 1 − 达到该分数的时间)，先达到的排前面，总值不能超过 2^53，更新时要用 Lua 脚本原子地"解码、加分、重新编码"。**日榜、周榜、总榜**用不同的 key，按周期命名并设置过期时间。成员上千万时单个 ZSet 是大 Key，可以**按用户分片**再合并，或者只精确维护头部、其余用**分段统计给出近似排名**。Redis 不是数据源：分数流水落库，Redis 可以重建，**发奖以数据库里的快照为准**。
:::

## 详细解析

### 第一步：澄清需求

- **场景**：游戏或活动的积分榜，分数只增不减
- **功能**：实时更新分数；查前 100 名；查自己的名次和分数；查自己前后各 5 名；日榜、周榜、总榜；同分时先达到的排前面
- **量级估算**（假设值）：
  - 总榜 1000 万玩家，日活 200 万；每人每天得分 50 次：1 亿次更新/天，平均约 1160 次/秒，峰值按 10 倍算约 1.2 万次/秒
  - 内存：每个成员按 100 字节估算（成员 ID、score、跳表节点和哈希表的开销，实际用 `MEMORY USAGE` 测），1000 万 × 100 字节 ≈ 1 GB；日榜只有日活用户，约 200 MB
  - 1 GB 的 ZSet 已经是大 Key，删除、迁移、持久化都会受影响，见[大 Key 和热 Key](/basics/redis/09-big-hot-key)

### 第二步：整体架构

```text
游戏服务 / 业务服务 ──> 得分事件（消息队列，每个事件带唯一 ID）
                          ▼
                     排行榜服务（消费者）
                       1 写分数流水和用户总分到 MySQL，按事件 ID 去重
                       2 更新 Redis 的日榜、周榜、总榜（Lua 脚本，同分按时间排）
客户端 ──> 排行榜服务（查询）
            前 100 名：ZREVRANGE，结果在本地缓存 1 秒（榜首被所有人查看，是热 Key）
            我的名次：ZREVRANK + ZSCORE
            附近的人：ZREVRANK 得到名次 r，再 ZREVRANGE 取 r-5 到 r+5
定时任务：对账（Redis 和 MySQL 的总分）；周期结束时生成榜单快照，用于发奖
```

ZSet 的底层是跳表 + 哈希表，跳表节点记录了每层跨过的节点数，所以查名次也是 O(log N)，见 [Redis 的数据类型](/basics/redis/03-data-structures)和[跳表的原理](/basics/redis/11-skiplist)。

### 第三步：核心模块和数据模型

**榜单的 key**：

| 榜单 | key | 过期时间 |
| --- | --- | --- |
| 日榜 | `lb:g1:day:20261011` | 当天结束后再保留 3 天（假设），用于展示昨日榜单 |
| 周榜 | `lb:g1:week:2026-W41` | 本周结束后再保留 2 周 |
| 总榜 | `lb:g1:total` | 不过期 |

- 每次得分同时更新三个榜，用 Pipeline 一次发出；过期时间用 `EXPIREAT` 设成绝对时间，每次写入都设置同一个值，重复设置没有副作用
- 也可以只写日榜，周榜用 `ZUNIONSTORE` 合并 7 个日榜生成。省了写入，但合并大集合很耗时，会阻塞 Redis，只适合定时生成、不要求实时的榜单

**同分排序**：ZSet 同分时按成员的字典序排，和时间无关。要让先达到的排前面，把时间编进 score：

```text
score = 分数 × 2^28 + (2^28 − 1 − 距活动开始的秒数)
  分数高的 score 一定更大；分数相同时，时间越早，后半部分越大
  2^28 秒约 8.5 年，够一个榜单的周期
  score 是双精度浮点数，只能精确表示 2^53 以内的整数，所以分数不能超过 2^25 − 1（约 3355 万）
  分数更大时，减少时间的位数，比如时间只精确到分钟
```

不能直接 `ZINCRBY` 加"分数 × 2^28"：后半部分还停留在第一次得分的时间，而不是达到当前分数的时间。要用 Lua 脚本读出旧 score、解出分数、加分、按当前时间重新编码，整个过程是原子的（见代码示例）。

**数据库**：`score_log`（事件 ID 唯一、用户、加分、时间）和 `user_score`（用户、总分、达到总分的时间）。数据库是数据源，Redis 只是为了实时查询而维护的视图。

### 第四步：关键难点

**超大规模：分片与近似排名**：

| 方案 | 做法 | 优点 | 缺点 | 适用场景 |
| --- | --- | --- | --- | --- |
| 单个 ZSet | 所有用户放在一个 key | 简单，名次精确 | 千万级以上是大 Key，只能放在一个节点 | 百万级以内 |
| 按用户分片 | 按用户 ID 哈希到 N 个 ZSet | 分散内存和请求 | 前 N 名要合并各分片；查名次要问遍所有分片 | 千万级，要精确名次 |
| 头部精确 + 分段近似 | ZSet 只保留前 1 万名（写入后用 `ZREMRANGEBYRANK` 裁掉多出的）；全体用户按分数段计数 | 内存小、查询快 | 头部以外的名次是近似值 | 亿级，只有头部需要精确 |

- 分片后取前 N 名：每个分片 `ZREVRANGE 0 N-1`，合并后取前 N
- 分片后查名次：在每个分片上 `ZCOUNT key (myScore +inf` 统计比我高的人数（myScore 是我编码后的 score），求和再加 1，用 Pipeline 一次发出
- 分段近似：用 Hash 记录每个分数段（比如每 100 分一段）有多少人，用户跨段时旧段减 1、新段加 1。名次 ≈ 更高分段的人数之和 + 本段人数 × 本段内比我高的比例（按均匀分布估算）。界面上显示"超过了 87% 的玩家"比显示一个不准的名次更合适

**持久化与对账**：
- Redis 的持久化（见 [RDB 和 AOF](/basics/redis/04-persistence)）只能减少丢失，不能代替数据库；Redis 数据丢了，从 `user_score` 分批 `ZADD` 重建
- 消息会重复投递：先按事件 ID 写数据库，写成功了再更新 Redis，重复的事件在数据库这一步就被拦下，见[重复消费与幂等](/basics/distributed/06-mq-idempotent)
- 写完数据库、更新 Redis 前进程崩溃，Redis 会少加一次分：定时对账，以数据库为准修正
- 周期结束时把最终榜单快照写入数据库，发奖按快照，不读实时的 Redis

**查自己的名次和附近的人**：`ZREVRANK` 返回从 0 开始的名次，不在榜上时返回 nil，界面上显示"未上榜"；附近的人取 `max(0, r - 5)` 到 `r + 5`。这两步不是原子的，中间名次可能变化，对排行榜来说可以接受。

### 第五步：扩展与优化

- **热点**：前 100 名被大量用户同时查看，在服务本地缓存 1 秒，或者定时算好后推到缓存
- **好友榜**：好友数量有限，取出好友列表后批量 `ZSCORE`（或 Redis 6.2 起的 `ZMSCORE`）查分数，在应用里排序
- **多维排序**：分数相同再比等级、再比时间，都可以编码进 score，前提是总位数不超过 53 位

## 代码示例

关键的 Redis 命令（不考虑同分排序时）。`ZREVRANGE` 从 Redis 6.2 起被标为过时，新代码可以写成 `ZRANGE key 0 9 REV WITHSCORES`，效果相同：

```bash
redis-cli ZINCRBY lb:g1:total 30 user:1001             # 加 30 分，返回新的分数
redis-cli ZREVRANGE lb:g1:total 0 9 WITHSCORES         # 前 10 名，带分数
redis-cli ZREVRANK lb:g1:total user:1001               # 名次，从 0 开始；不在榜上返回 nil
redis-cli ZSCORE lb:g1:total user:1001                 # 分数
redis-cli ZREVRANGE lb:g1:total 37 47 WITHSCORES       # 假设名次是 42，取前后各 5 名
redis-cli ZCOUNT lb:g1:total:0 '(8053332114455' +inf   # 分片时：这个分片里比我高的人数，"(" 表示不含边界
redis-cli EXPIREAT lb:g1:day:20261011 1791993600       # 日榜在北京时间 2026-10-15 00:00 过期
```

同分按时间排序的加分脚本（Lua），以及查询时把 score 解码成分数（JavaScript）：

```lua
-- KEYS[1]：榜单 key；ARGV[1]：用户 ID；ARGV[2]：本次加的分；ARGV[3]：活动开始的 Unix 秒数
local R = 268435456 -- 2^28
-- 先调用 TIME 再写入：Redis 5 起脚本默认按效果复制，允许这样做；更早的版本要先调用 redis.replicate_commands()
local now = tonumber(redis.call('TIME')[1]) - tonumber(ARGV[3]) -- 距活动开始的秒数，用 Redis 服务器的时间
local old = tonumber(redis.call('ZSCORE', KEYS[1], ARGV[1])) or 0 -- 不在榜上时 ZSCORE 返回 false
local points = math.floor(old / R) + tonumber(ARGV[2])
-- score 直接以数字传给 redis.call，不要先 tostring：Lua 默认的格式只保留 14 位有效数字
redis.call('ZADD', KEYS[1], points * R + (R - 1 - now), ARGV[1])
return points
```

```js
const TIME_RANGE = 2 ** 28
const MAX_POINTS = Math.floor(Number.MAX_SAFE_INTEGER / TIME_RANGE) // 2^25 - 1

function encodeScore(points, seconds) {
  if (points < 0 || points > MAX_POINTS) throw new RangeError('分数超出可编码范围')
  if (seconds < 0 || seconds >= TIME_RANGE) throw new RangeError('时间超出可编码范围')
  return points * TIME_RANGE + (TIME_RANGE - 1 - seconds)
}

function decodeScore(score) {
  const points = Math.floor(score / TIME_RANGE)
  return { points, seconds: TIME_RANGE - 1 - (score - points * TIME_RANGE) }
}

console.log(encodeScore(100, 10) > encodeScore(100, 20)) // true：同为 100 分，先达到的排前面
console.log(encodeScore(101, 999) > encodeScore(100, 0)) // true：分数高的永远在前
console.log(decodeScore(Number('8053332114455'))) // { points: 30000, seconds: 1000 }：Redis 返回的 score 是字符串
```

## 面试官可能追问

::: details 为什么不直接用 MySQL 的 ORDER BY 做排行榜？
取前 100 名，在分数上建索引、`ORDER BY score DESC LIMIT 100` 还能接受；但查"我排第几"要 `COUNT(*) WHERE score > 我的分数`，要扫描所有比我高的行，用户多了就很慢。分数频繁更新也意味着频繁维护索引。ZSet 查名次是 O(log N)，更新也是 O(log N)，更适合实时榜单。
:::

::: details 周期结束发奖，怎么保证榜单准确、公平？
截止时刻之后，等一个宽限期，让还在消息队列里的得分事件处理完，再生成快照写入数据库，之后到达的事件不计入本期。快照生成前用数据库的分数流水对账一遍。头部玩家的分数再做一次反作弊审核，确认后按快照发奖。
:::

::: details 分数可以减少（扣分）时，这套设计还成立吗？
基本成立：给 Lua 脚本传入负的加分即可，但脚本里要检查扣完不能小于 0，因为编码要求分数非负。同分排序的语义变成"最后一次变动得早的排前面"，要和产品确认这个规则。分段近似统计在分数下降时，同样要把用户从旧分段移到新分段。
:::

## 易错点

- 以为同分时按时间先后排，实际上 ZSet 同分按成员的字典序排
- 把时间编进 score 后还用 `ZINCRBY` 加分，时间部分停留在第一次得分的时间
- 编码后的 score 超过 2^53，精度丢失，排序出错
- 把 Redis 当唯一的数据源，发奖直接读实时榜单
