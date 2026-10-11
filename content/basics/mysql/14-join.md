---
difficulty: 2
tags: [高频, 原理, 性能优化]
---

# JOIN 是怎么执行的？大表 JOIN 怎么优化？

::: tip 一句话回答
MySQL 的 JOIN 以嵌套循环为基础：先从**驱动表**取出满足条件的行，再拿每一行的关联字段去**被驱动表**里找匹配的行。被驱动表的关联字段**有索引**时是 Index Nested-Loop Join，每行一次索引查找，代价很低；**没有索引**时，旧版本用 Block Nested-Loop（把驱动表的行攒进 join buffer 再批量扫描被驱动表），MySQL 8.0.18 起改用 **Hash Join**，8.0.20 起 BNL 被完全取代。"小表驱动大表"指的是**过滤后**结果集小的表做驱动表，优化器会自动选。大表 JOIN 的优化核心是**给被驱动表的关联字段建索引**，再配合先过滤、少取列、必要时拆到应用层组装。
:::

## 详细解析

### 驱动表和被驱动表

```sql
SELECT u.name, o.amount
FROM users u JOIN orders o ON o.user_id = u.id
WHERE u.city = 'hz';
```

执行时一张表在外层循环，叫**驱动表**；另一张在内层，叫**被驱动表**。传统格式的 EXPLAIN 里，排在前面的是驱动表。内连接的顺序由优化器按成本决定，和 SQL 里的书写顺序无关；`LEFT JOIN` 一般以左表为驱动表，但如果 WHERE 条件过滤掉了右表为 NULL 的行，优化器会把它转成内连接再选顺序。

### Index Nested-Loop Join

被驱动表的关联字段上有索引时：

```text
for 驱动表 users 中每一行 u（先用 idx_city 找出 city = 'hz' 的行）:
    在 orders 的 idx_user_id 上查 user_id = u.id     ← 一次 B+ 树查找
    把匹配的行和 u 拼起来，放进结果集
```

代价约等于：驱动表行数 × 被驱动表一次索引查找（再加上回表）。驱动表过滤后只有 100 行，就只做 100 次索引查找，被驱动表有多大影响不大。EXPLAIN 里被驱动表的 type 是 `ref`，关联的是主键或唯一索引时是 `eq_ref`。

### 没有索引：从 BNL 到 Hash Join

被驱动表的关联字段没有索引，每一行驱动表都要全表扫描一次被驱动表，代价是两表行数的乘积，不可接受。MySQL 的处理随版本变化：

| 版本 | 算法 | 做法 |
| --- | --- | --- |
| 8.0.18 之前 | Block Nested-Loop | 把驱动表的若干行（只存要用到的列）放进 join buffer，扫一遍被驱动表，每行和 buffer 里的所有行比较，扫描次数降到"驱动表行数 ÷ buffer 能放的行数" |
| 8.0.18、8.0.19 | Hash Join | 关联条件是等值、且用不上索引时，改用哈希连接；其他情况仍是 BNL |
| 8.0.20 起 | Hash Join | BNL 被移除，原来用 BNL 的地方都改用 Hash Join，非等值连接、外连接、半连接、反连接也能用 |

Hash Join 分两步：

```text
1. 构建：读其中一侧，按关联字段建哈希表，放在 join buffer 里
   内连接时由优化器选的连接顺序决定，理想情况下是过滤后数据量（按字节数，不是行数）较小的一侧
   外连接、半连接固定用内侧的表构建，比如 LEFT JOIN 的右表
2. 探测：扫描另一侧，每一行按关联字段算哈希，到哈希表里找匹配
```

两张表各扫描一遍，代价从"行数相乘"降到"行数相加"。哈希表的内存上限是 `join_buffer_size`（默认 256KB），放不下就分批写到磁盘文件里，变慢但能完成。传统 EXPLAIN 的 Extra 显示 `Using join buffer (hash join)`，`EXPLAIN FORMAT=TREE` 显示 `Inner hash join`。

有索引时也不一定是一次一行地查：开启 BKA（Batched Key Access，默认关闭）后，MySQL 把驱动表的一批关联值攒在 join buffer 里，通过 MRR 接口批量交给引擎，引擎按主键顺序回表读取，随机读变得接近顺序读。

### "小表驱动大表"到底指什么

- 比的是**按 WHERE 过滤后、真正参与关联的行数**，不是表的总行数。一张 1000 万行的表加上条件只剩 100 行，它就是"小表"
- Index Nested-Loop 的循环次数等于驱动表的行数，驱动表越小，查索引的次数越少
- 内连接走 Hash Join 时，优化器尽量让较小的一侧建哈希表，内存占用少，不容易落盘；没被改写成内连接的 LEFT JOIN 则固定用右表建哈希表，右表很大时容易落盘
- 优化器会根据统计信息自动选顺序。确认它选错了，才用 `STRAIGHT_JOIN` 或 `JOIN_ORDER` 提示固定顺序

更关键的是**被驱动表上有没有能用的索引**，它往往直接决定了顺序：下面的例子里，`orders.user_id` 没有索引时，优化器宁可让 10 万行的 `orders` 做驱动表，因为这样被驱动表 `users` 可以按主键查找。

### 大表 JOIN 怎么优化

1. **被驱动表的关联字段建索引**，这是最有效的一步。两边字段的类型、字符集要一致，否则会发生类型转换，索引用不上（见 [索引失效](/basics/mysql/03-index-design)）
2. **先过滤再关联**：WHERE 条件尽量能用上驱动表的索引，参与关联的行越少越好
3. **只取需要的列**：被驱动表的列都在索引里时可以不回表；Hash Join 时 join buffer 也能放下更多行
4. **控制关联的表数**：表越多，优化器要评估的顺序越多，越容易选错。有的开发规范直接限制 JOIN 的表数
5. **拆到应用层**：先查出驱动表的结果，再用 `WHERE user_id IN (...)` 分批查另一张表，在内存里按 ID 组装。适合跨库、分库分表后无法 JOIN 的场景，也方便各自走缓存。要避免在循环里一行一行地查（N+1 查询）
6. **报表类的大 JOIN** 放到从库或数据仓库，不和线上业务抢资源

## 代码示例

在本机 MySQL 8.0.44 上用临时表测试：`users` 1000 行，`city = 'hz'` 的有 100 行；`orders` 10 万行。下面是 `EXPLAIN FORMAT=TREE` 的输出，省略了成本估算：

```text
-- 1. orders.user_id 有索引：users 过滤后驱动，orders 按索引查找（Index Nested-Loop）
-> Nested loop inner join
    -> Index lookup on u using idx_city (city='hz')
    -> Index lookup on o using idx_user_id (user_id=u.id)

-- 2. 删掉 idx_user_id：orders 全表扫描做驱动表，users 按主键查找
-> Nested loop inner join
    -> Table scan on o
    -> Filter: (u.city = 'hz')
        -> Single-row index lookup on u using PRIMARY (id=o.user_id)

-- 3. 两边的关联字段都没有索引（另一张报名表 signup 按 user_id 关联 orders）：Hash Join
-> Inner hash join (o.user_id = s.user_id)
    -> Table scan on o
    -> Hash
        -> Filter: (s.`channel` = 'app')
            -> Table scan on s
```

第 3 种情况里，`Hash` 下面的 `signup` 过滤后只剩 500 行，用来建哈希表；`orders` 扫描一遍去探测。`EXPLAIN ANALYZE` 显示第 1 种情况的内层循环执行了 100 次，第 2 种执行了 10 万次。

## 面试官可能追问

::: details COUNT(*)、COUNT(1) 和 COUNT(列) 有什么区别？
`COUNT(*)` 和 `COUNT(1)` 都是统计行数，官方文档明确说 InnoDB 对两者的处理方式相同，没有性能差别。`COUNT(列)` 统计的是该列**不为 NULL** 的行数，语义不同，结果可能更少。InnoDB 执行 `COUNT(*)` 时会选最小的二级索引来扫描，没有二级索引才扫聚簇索引；它不保存表的总行数，所以大表计数慢，替代方案见 [深分页和 COUNT](/basics/mysql/10-deep-pagination)。
:::

::: details LEFT JOIN 的条件写在 ON 里和写在 WHERE 里有什么区别？
ON 是关联条件：左表的行总会保留，右表没有满足 ON 的行时用 NULL 填充。WHERE 是关联完成之后的过滤：`LEFT JOIN orders o ON o.user_id = u.id WHERE o.status = 1` 会把右表为 NULL 的行过滤掉，结果和内连接一样，优化器也会直接把它转成内连接。想保留没有订单的用户，`o.status = 1` 要写进 ON。
:::

::: details 为什么很多团队限制甚至禁止 JOIN？
主要有三个原因：分库分表后不同库的表没法 JOIN，提前避免可以减少日后改造；多表 JOIN 的执行计划受统计信息影响大，数据量变化后可能突然变慢；大 JOIN 占用的 join buffer、临时表和 CPU 都在数据库上，而数据库是最难扩展的一层。但在单库里、关联字段有索引的 JOIN 通常比在应用层循环查询更快，不必一概禁止。
:::

::: details join_buffer_size 调大能解决问题吗？
只能缓解没有索引时的 JOIN：Hash Join 的哈希表能放进内存，就不用落盘。它是每个连接、每次关联都可能分配的内存，全局调得很大，并发高时内存会被吃光。官方建议全局值保持较小，只在需要做大 JOIN 的会话里调大，或者用 `SET_VAR` 提示只对单条语句生效。根本的办法还是建索引。
:::

## 易错点

- "小表驱动大表"比的是过滤后的行数，不是表的总行数，而且优化器会自动选，不需要按书写顺序去凑
- MySQL 8.0.20 起已经没有 Block Nested-Loop，没有索引的关联走 Hash Join，EXPLAIN 显示 `Using join buffer (hash join)`
- `COUNT(1)` 并不比 `COUNT(*)` 快，`COUNT(列)` 会跳过 NULL，结果可能不同
- 关联字段两边的类型或字符集不一致，被转换的一侧用不上索引
