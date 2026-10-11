---
difficulty: 2
tags: [高频, 性能优化]
---

# 慢查询怎么优化？EXPLAIN 的结果怎么看？

::: tip 一句话回答
先用**慢查询日志**找出耗时长、扫描行数多的 SQL，再用 **EXPLAIN** 看执行计划：**type** 是访问方式，从好到差大致是 const、eq_ref、ref、range、index、ALL；**key** 是实际用到的索引；**rows** 是估算的扫描行数；**Extra** 里出现 `Using filesort`、`Using temporary` 要重点关注。优化的核心是**减少扫描和回表的行数**：建合适的联合索引、避免 `SELECT *`、改掉让索引失效的写法、拆分大查询。
:::

## 详细解析

### 定位慢 SQL

```sql
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;                  -- 超过 1 秒就记录，默认是 10 秒
SET GLOBAL log_queries_not_using_indexes = 'ON'; -- 可选：记录没有使用索引的查询
```

慢日志中的每条记录类似这样：

```text
# Query_time: 2.315042  Lock_time: 0.000105 Rows_sent: 10  Rows_examined: 1000000
SELECT * FROM orders WHERE user_id = 1001 AND status = 1 ORDER BY create_time DESC LIMIT 10;
```

`Rows_examined` 远大于 `Rows_sent`，说明扫描了大量用不上的行，这是最典型的优化信号。日志多时用 `mysqldumpslow` 或 `pt-query-digest` 按 SQL 模板汇总，先优化总耗时最高的几类。

### EXPLAIN 的关键列

| 列 | 含义 |
| --- | --- |
| type | 访问方式，见下表 |
| possible_keys / key | 可能用到的索引 / 实际选择的索引，key 为 NULL 表示没走索引 |
| key_len | 用到的索引长度，可以推断联合索引用了几列 |
| rows | 估算要扫描的行数，不是精确值 |
| filtered | 按条件过滤后剩下的行占的估算百分比 |
| Extra | 额外信息 |

type 从好到差：

| type | 含义 |
| --- | --- |
| const | 主键或唯一索引的等值查询，最多一行 |
| eq_ref | 关联查询中，被驱动表按主键或唯一索引匹配，每次只匹配一行 |
| ref | 普通索引的等值查询，可能匹配多行 |
| range | 索引范围扫描，如 `>`、`<`、`BETWEEN`、`IN`、`LIKE 'x%'` |
| index | 扫描整个索引树，比 ALL 稍好，但仍然是全扫描 |
| ALL | 全表扫描 |

Extra 的常见值：

- `Using index`：覆盖索引，不用回表
- `Using where`：存储引擎返回的行还要在 Server 层按 WHERE 过滤，单独出现不说明好坏
- `Using index condition`：用了索引下推，见 [聚簇索引和回表](/basics/mysql/02-clustered-index)
- `Using filesort`：没法利用索引的顺序，需要额外排序，数据多时会用到磁盘临时文件
- `Using temporary`：用了临时表，常见于没有合适索引的 GROUP BY、DISTINCT，以及需要去重的 UNION

EXPLAIN 不执行语句，给出的都是估算。MySQL 8.0.18 起可以用 `EXPLAIN ANALYZE`，它会**真正执行**语句，输出每一步的实际耗时和行数。

### 常见的优化手段

1. **建合适的索引**：按 WHERE 的等值列、范围列和 ORDER BY 设计联合索引，哪些写法会让索引失效见 [最左前缀和索引失效](/basics/mysql/03-index-design)
2. **避免 `SELECT *`**：只查需要的列，才有机会用上覆盖索引，也能减少网络传输
3. **改写子查询**：MySQL 5.6 起，优化器能把很多 `IN (子查询)` 自动转成半连接，不必见到子查询就改；但 select_type 为 `DEPENDENT SUBQUERY` 的相关子查询会对外层的每一行执行一次，可以改写成 JOIN
4. **拆分大操作**：一次删除几百万行会长时间持有锁、产生巨大的事务，改成按主键范围分批，每批几千行
5. **优化分页**：`LIMIT` 偏移量很大时，扫描和回表的代价都很高，见 [深分页怎么优化](/basics/mysql/10-deep-pagination)

## 代码示例

`orders` 表约 100 万行，只有主键索引：

```sql
EXPLAIN SELECT * FROM orders
WHERE user_id = 1001 AND status = 1
ORDER BY create_time DESC LIMIT 10;

-- 按"等值列在前、排序列在后"建联合索引
ALTER TABLE orders ADD INDEX idx_user_status_time (user_id, status, create_time);
```

加索引前后的 EXPLAIN（示意）：

| 阶段 | type | key | rows | Extra |
| --- | --- | --- | --- | --- |
| 优化前 | ALL | NULL | 约 100 万 | Using where; Using filesort |
| 优化后 | ref | idx_user_status_time | 约 30 | Backward index scan |

加索引后，`user_id` 和 `status` 等值定位到一小段索引，这一段里 `create_time` 本身就是有序的。InnoDB 可以反向扫描这段索引，直接按时间倒序取 10 条，不再需要排序，MySQL 8.0 的 Extra 会显示 `Backward index scan`。MySQL 8.0 还真正支持了降序索引，也可以直接建成 `(user_id, status, create_time DESC)`，正向扫描比反向扫描效率略高。

## 面试官可能追问

::: details EXPLAIN 看起来没问题，SQL 还是慢，可能是什么原因？
rows 是估算值，统计信息过时时偏差会很大，可以执行 `ANALYZE TABLE` 更新统计信息，再用 `EXPLAIN ANALYZE` 看实际的行数和耗时。也可能不是执行计划的问题：在等行锁（查 `sys.innodb_lock_waits`）或元数据锁（查 `sys.schema_table_lock_waits`）、缓冲池命中率低导致大量磁盘读、返回的结果集太大，或者服务器的 CPU、I/O 被别的查询占满了。
:::

::: details Using filesort 一定要消除吗？
不一定。filesort 不代表一定用了磁盘文件，结果集小时在内存（`sort_buffer_size`）里就排完了，很快。需要优化的是对大量行排序、却只取前几条的情况，比如 `ORDER BY create_time LIMIT 10` 要先把几十万行排一遍；这时让索引顺序和 ORDER BY 一致，按索引顺序读到 10 条就可以停止。
:::

::: details 优化器选错了索引怎么办？
先 `ANALYZE TABLE` 更新统计信息，很多选错都是因为统计信息不准。确认是优化器的问题后，可以用 `FORCE INDEX` 指定索引，但这会把执行计划写死，数据分布变化后反而可能变慢；更好的办法是调整 SQL 或索引，让正确的索引成本明显更低，比如删掉一个容易误导优化器的冗余索引。
:::

::: details 线上给大表加索引会锁表吗？
MySQL 5.6 起支持 Online DDL，InnoDB 添加二级索引时允许并发读写，只在开始和结束时短暂持有元数据锁。但如果有长事务或长查询占着这张表的元数据锁，DDL 会一直等，而排在它后面的读写请求又都在等它，业务会大面积阻塞。所以加索引要避开高峰、先检查有没有长事务；超大的表也可以用 gh-ost、pt-online-schema-change 这类工具。
:::

## 易错点

- type 为 index 不代表索引用得好，它是扫描整个索引，和 ALL 一样是全扫描
- `Using where` 不等于没走索引，要结合 type 和 key 一起看
- `EXPLAIN ANALYZE` 会真正执行语句，不要随手用在写操作上
- `SET GLOBAL long_query_time` 只对之后新建的连接生效，当前连接要用 `SET SESSION`
