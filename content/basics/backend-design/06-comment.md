---
difficulty: 3
tags: [系统设计, 场景题]
---

# 设计一个评论系统

::: tip 一句话回答
数据模型用**两级楼层**：根评论挂在评论对象（文章、视频）下，所有回复都挂在所属的根评论下，用 `root_id` 和 `parent_id` 表示，不做无限嵌套。列表分**按时间**和**按热度**两种：按时间用 `id` 做**游标分页**；按热度预先算好**热度分**，把前几百条放进 Redis ZSet。**点赞和计数**先写 Redis，再经消息队列**批量合并后异步落库**，计数允许短时间不准。审核按风险选**先审后发**或**先发后审**；删除用软删除，有回复的根评论显示"已删除"占位。整体读多写少，靠缓存扛读，按评论对象分库分表扛数据量，再用限频和重复内容检测**防刷**。
:::

## 详细解析

### 第一步：澄清需求

- **评论对象**：文章、视频、商品都能评论吗？用 `subject_type + subject_id` 统一表示，评论服务做成通用的
- **层级**：只有两级（根评论 + 楼中楼回复），还是要无限嵌套？
- **排序**：按时间、按热度，作者置顶、精选
- **互动和治理**：点赞、回复数、"回复了你"的通知；审核、举报、删除、作者关闭评论、防刷

量级估算（以下数字都是假设）：

- 日活 1000 万，每人每天打开 20 个带评论的页面：2 亿次 / 86400 秒 ≈ 2300 QPS，峰值按平均的 5 倍算约 1.2 万 QPS
- 每天新增 500 万条评论：平均约 58 QPS，峰值约 300 QPS，读写比约 40 : 1
- 每条评论连同索引按 1 KB 算，每天约 5 GB，一年约 1.8 TB，单表撑不住，要分库分表
- 每天 5000 万次点赞：平均约 580 QPS，是发评论的 10 倍，不能每次都直接更新数据库里的计数

### 第二步：整体架构

```text
客户端 ──> 网关（鉴权、限流）──> 评论服务
                                   │ 读：Redis（首页评论、热评 ZSet、计数）→ 未命中查 MySQL
                                   │ 写：同步规则审核 → MySQL（按 subject_id 分库分表）→ 发 MQ 事件
                                   ▼
MQ ──> 审核服务（模型 + 人工，结果回写评论状态）
   ──> 计数服务（回复数、点赞数合并后批量落库，更新热度分）
   ──> 通知服务（"有人回复了你"）、搜索索引、数据统计
```

### 第三步：核心模块和数据模型

**为什么只做两级**：无限嵌套要递归查询，深层回复难展示、难分页，手机上也挤不下。两级结构下，根评论按页查，每条根评论下先展示前几条回复，点"查看更多"再分页拉取这条根评论下的全部回复。回复别人的回复时，用 `parent_id` 记录直接回复的是哪一条，界面显示"回复 @某人"。

```sql
CREATE TABLE comment (
  id           BIGINT PRIMARY KEY,         -- 分布式 ID，趋势递增，按 id 排序约等于按时间排序
  subject_type TINYINT NOT NULL,
  subject_id   BIGINT NOT NULL,            -- 评论对象，也是分片键
  root_id      BIGINT NOT NULL DEFAULT 0,  -- 0 表示根评论；回复指向所属的根评论
  parent_id    BIGINT NOT NULL DEFAULT 0,  -- 直接回复的那一条
  user_id      BIGINT NOT NULL,
  content      VARCHAR(2000) NOT NULL,
  like_count   INT NOT NULL DEFAULT 0,
  reply_count  INT NOT NULL DEFAULT 0,     -- 只对根评论有意义
  status       TINYINT NOT NULL,           -- 1 可见，其他为待审核、隐藏、审核拒绝
  created_at   DATETIME NOT NULL,
  KEY idx_list (subject_id, root_id, status, id)
);
-- 另有 comment_subject（对象的评论总数、是否关闭评论）、comment_like（comment_id + user_id 唯一）
```

一个联合索引服务两个查询：`root_id = 0` 查对象下的根评论，`root_id = 某条根评论` 查它的回复。分页用游标而不是 `OFFSET`，原因见[深分页](/basics/mysql/10-deep-pagination)；ID 生成见[分布式 ID](/basics/distributed/03-distributed-id)。

**按热度排序**：热度分综合点赞数、回复数和发布时间，新评论有机会冒头，老的高赞评论慢慢下沉。热度分变化频繁，不适合放进数据库索引：

- 每个对象的前 N 条根评论（如 500 条）放在 ZSet `hot:{subject_id}` 里，member 是评论 ID，score 是热度分
- 点赞、回复事件到达时重算热度分并 `ZADD`，再用 `ZREMRANGEBYRANK hot:{subject_id} 0 -501` 只保留分数最高的 500 条
- 热评只展示前 N 条，再往后按时间排序；ZSet 丢了，可以从数据库按点赞数重新加载

### 第四步：关键难点

**点赞和计数**：

1. 点赞先写 `comment_like`，唯一索引防止重复点赞；"我是否点过赞"按一页评论的 ID 批量查
2. 点赞数在 Redis 里 `HINCRBY`，页面直接读，实时性好
3. 同时发一条点赞事件到 MQ，计数服务按批合并：同一条评论的多次点赞合成一次 `UPDATE`（见代码示例）
4. 计数允许短时间不准，定期用 `comment_like` 的实际行数校正

爆款内容下的评论计数是[热 Key](/basics/redis/09-big-hot-key)，可以加本地缓存，或者把一个计数拆成多个 key 分散写入。

**内容审核**：两种策略按风险选，规则和模型怎么组合见[内容安全审核](/engineering/security/08-content-moderation)。

| 策略 | 做法 | 优点 | 缺点 | 适用场景 |
| --- | --- | --- | --- | --- |
| 先审后发 | 审核通过才对其他人可见，审核中只有作者自己能看到 | 违规内容不外露 | 有延迟，人工审核成本高 | 新用户、敏感话题、高风险对象 |
| 先发后审 | 同步过一遍关键词规则就发布，模型和人工异步复审，命中后下架 | 体验好，实时 | 违规内容会短暂可见 | 信用好的老用户、普通内容 |

**删除**：一律软删除，保留审计和申诉的依据。有回复的根评论被删时，保留这一行、清空内容、打上删除标记，展示成"该评论已删除"，楼层不乱；没有回复的直接改成隐藏。根评论的回复数、对象的评论总数要相应减少。文章被删除时，它的评论由 MQ 事件触发后台任务分批处理，不在删除文章的请求里同步完成。

**防刷**：按用户和 IP 限制发评论的频率（见[限流](/basics/redis/10-rate-limit)）；同一用户短时间内发相同内容（按内容哈希判断）直接拒绝；新账号、风险账号要过验证码或先审后发；点赞同样限频，异常账号的点赞不计入热度分。

### 第五步：扩展与优化

- **分库分表**：按 `subject_id` 分片，同一对象的评论在一个分片上，列表查询不跨分片；"我发过的评论"按 `user_id` 另存一份，用 binlog 同步，见[分库分表](/basics/mysql/12-sharding)
- **缓存**：热门对象的第一页整页缓存，有新评论时删除缓存；超级热门的对象再加一层本地缓存
- **冷热分离**：很久没人访问的对象，评论归档到更便宜的存储，访问时再加载
- **通知**：回复、点赞的通知交给[消息通知系统](/basics/backend-design/10-notification)，点赞通知要合并（"某某等 20 人赞了你"）

## 代码示例

游标分页和批量取楼中楼（MySQL 8.0）：

```sql
-- 第一页：最新的 20 条根评论；下一页加上 AND id < 上一页最后一条的 id
SELECT id, user_id, content, like_count, reply_count, created_at
FROM comment
WHERE subject_id = ? AND root_id = 0 AND status = 1
ORDER BY id DESC LIMIT 20;

-- 这一页根评论各自的前 3 条回复，用窗口函数一次查出，不用查 20 次
SELECT * FROM (
  SELECT c.*, ROW_NUMBER() OVER (PARTITION BY root_id ORDER BY id) AS rn
  FROM comment c
  WHERE subject_id = ? AND root_id IN (101, 102, 103) AND status = 1  -- IN 里是这一页的根评论 ID
) t WHERE rn <= 3;
```

热度分和点赞计数的批量合并：

```js
// 热度分：点赞、回复越多越高，随时间衰减。权重和指数是示例值，要按业务数据调
export function hotScore({ likes, replies, createdAt }, now = Date.now()) {
  const hours = Math.max(0, (now - createdAt) / 3_600_000)
  return (likes + 2 * replies + 1) / (hours + 2) ** 1.5
}

// 一批点赞消息先按评论合并，写库次数从"每次点赞一次"降到"每批每条评论一次"
export function mergeLikeEvents(events) {
  const delta = new Map()
  for (const { commentId, type } of events) {
    delta.set(commentId, (delta.get(commentId) ?? 0) + (type === 'like' ? 1 : -1))
  }
  return [...delta].filter(([, d]) => d !== 0) // 点了又取消的互相抵消，不用写库
}

export async function flushLikes(conn, events) {
  for (const [id, d] of mergeLikeEvents(events)) {
    await conn.query('UPDATE comment SET like_count = GREATEST(like_count + ?, 0) WHERE id = ?', [d, id])
  }
}
```

## 面试官可能追问

::: details 热评的分数一直在变，翻页时会重复或漏掉怎么办？
进入页面时取一次热评 ID 列表的快照（前 N 条），后续翻页在这个快照里按位置取，分数怎么变都不影响已经确定的顺序；快照可以放在客户端，也可以按会话缓存在服务端。要求不高时，也可以容忍少量重复，客户端按评论 ID 去重。热评本身只展示有限条数，不需要无限翻页。
:::

::: details 一条热门评论下有几万条回复，怎么处理？
回复按根评论分页拉取，用的是同一个联合索引，加上游标，翻到多深都很快。根评论下默认只展示前几条回复和总数，点开才分页加载。这条根评论的回复数、点赞数是热点数据，计数走 Redis 和批量落库；它的回复列表首页也可以单独缓存。
:::

::: details 为什么不用文档数据库，把回复嵌在根评论的文档里？
回复会不断增长，文档越来越大，可能超过单个文档的大小上限（MongoDB 是 16 MiB）；同一个文档被大量并发更新，冲突也多；对嵌入的数组做分页和排序也不方便。评论更适合一条一行，靠索引组织成楼层。
:::

::: details 评论总数显示的和实际条数对不上，要紧吗？
一般不要紧。评论数只是展示用的，允许短时间不一致，很多产品显示的也是"1.2 万"这样的近似值。要保证的是最终能对上：计数服务批量落库，定期按实际行数校正；Redis 里的计数丢了，从数据库重新加载。
:::

## 易错点

- 用 `LIMIT offset, n` 分页，评论多了翻页越来越慢，有新评论插入时还会翻出重复的数据
- 每次点赞都同步 `UPDATE` 计数，热门评论的同一行被大量并发更新，行锁竞争严重
- 把频繁变化的热度分放进数据库索引排序，每次点赞都要更新索引
- 删除根评论时物理删除，连带删掉下面的回复，楼层乱了，审计和申诉也没有依据
