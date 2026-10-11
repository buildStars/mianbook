---
difficulty: 2
tags: [高频, 实践]
---

# 联合索引的最左前缀原则是什么？哪些情况会导致索引失效？

::: tip 一句话回答
联合索引 `(a, b, c)` 先按 a 排序，a 相同再按 b，b 相同再按 c，所以只有**从最左边的列开始连续匹配**才能用索引定位，单独查 b 或 c 用不上；遇到**范围条件**后，后面的列不能再用于定位。索引失效的本质是**条件没法利用索引的有序性**，比如对列做函数或运算、隐式类型转换、`LIKE '%x'`、OR 的一侧没有索引；`!=` 这类条件通常是因为匹配的行太多，**优化器估算全表扫描更便宜**。
:::

## 详细解析

### 联合索引是怎么排序的

```text
(a, b, c) 索引中的记录顺序：
(1, 1, 3) (1, 2, 1) (1, 2, 5) (2, 1, 2) (2, 3, 1) (3, 1, 1)

a 整体有序；a 相同时 b 才有序；a、b 都相同时 c 才有序
单看 b：1 2 2 1 3 1，是无序的，没法在索引上二分查找
```

像查字典：先按第一个字母排，再按第二个字母排。知道第一个字母能很快翻到，只知道第二个字母就只能从头翻到尾。

| 条件 | 能用于定位的列 | 说明 |
| --- | --- | --- |
| `a = 1` | a | 最左前缀 |
| `a = 1 AND b = 2 AND c = 3` | a、b、c | 全部用上 |
| `b = 2 AND a = 1` | a、b | 书写顺序无所谓，优化器会调整 |
| `b = 2` 或 `b = 2 AND c = 3` | 无 | 缺少最左边的列 |
| `a = 1 AND c = 3` | a | 跳过了 b，c 只能在索引里过滤 |
| `a = 1 AND b > 2 AND c = 3` | a、b | b 是范围条件，c 不能再用于定位 |
| `a IN (1, 2) AND b = 2` | a、b | IN 相当于多个等值条件 |
| `a = 1 ORDER BY b` | a，排序不需要 filesort | a 固定时 b 本身有序 |

范围条件包括 `>`、`<`、`>=`、`<=`、`BETWEEN` 和 `LIKE 'x%'`。范围之后的列为什么不能定位：`b > 2` 匹配的是 b = 3、4、5 等多个 b 值，每个 b 值下面的 c 各自有序，合在一起就无序了。不过 c 的条件也不是完全没用，[索引下推](/basics/mysql/02-clustered-index) 可以在回表之前用它过滤。

### 索引失效的常见情况

| 写法 | 为什么用不上 | 改写 |
| --- | --- | --- |
| `WHERE YEAR(create_time) = 2024` | 索引按列的原值排序，函数结果的顺序和它不一致 | `create_time >= '2024-01-01' AND create_time < '2025-01-01'` |
| `WHERE price * 2 > 100` | 对列做运算，和函数一样 | `price > 50` |
| phone 是 VARCHAR，`WHERE phone = 13800000000` | 字符串和数字比较时，MySQL 把每行的字符串转成数字再比，相当于对列用了函数 | 写成字符串 `'13800000000'` |
| `WHERE name LIKE '%om'` | 前导通配符没法确定从索引的哪个位置开始找 | 改成右模糊；后缀匹配可以额外存一个反转的列；全文检索用全文索引或搜索引擎 |
| `WHERE a = 1 OR d = 2`，d 没有索引 | d 的条件反正要全表扫描，优化器干脆整体全表扫描 | 给 d 也建索引，优化器可以分别查两个索引再合并（index_merge），或改写成 UNION |

还有两种情况常被说成"索引失效"，其实是优化器的选择：

- **优化器认为全表扫描更快**：比如 `status = 1` 匹配了表里大部分行，走二级索引要回表几十万次随机读，不如直接顺序扫描聚簇索引。没有固定的比例阈值，取决于统计信息和成本估算
- **`!=`、`NOT IN`、`IS NOT NULL`**：它们可以转成范围扫描，并不是一定不能用索引，只是匹配的行通常很多，回表代价高

字符集不一致的关联也容易踩坑：关联字段一边是 utf8mb3、一边是 utf8mb4，MySQL 会把 utf8mb3 那一侧转换成 utf8mb4 再比较，被转换的一侧上的索引就用不上了。

### 索引设计原则

1. **从查询出发**：为 WHERE、JOIN、ORDER BY、GROUP BY 中高频出现的列建索引，而不是每列各建一个
2. **等值在前，范围在后**：`WHERE user_id = ? AND status = ? AND create_time > ?` 建 `(user_id, status, create_time)`；多个等值列时，优先放能被更多查询复用的列，再考虑区分度
3. **看区分度**：`COUNT(DISTINCT col) / COUNT(*)` 越接近 1 越好。状态、性别这类区分度低的列单独建索引意义不大，但放在联合索引里配合其他列仍然有用
4. **兼顾排序和覆盖**：`WHERE user_id = ? ORDER BY create_time DESC LIMIT 20` 建 `(user_id, create_time)`，按索引顺序取到 20 条就停；常查的少量列加进索引可以避免回表
5. **控制数量和长度**：每个索引都会拖慢写入、占用空间；有了 `(a, b)` 就不需要再单独建 `(a)`；长字符串可以用前缀索引 `INDEX (email(10))`，但前缀索引用不了覆盖索引，也不能用于排序

## 代码示例

```sql
-- 对列用了函数，用不上 create_time 上的索引
EXPLAIN SELECT * FROM orders WHERE DATE(create_time) = '2024-06-01';
-- type: ALL

-- 改写成范围条件
EXPLAIN SELECT * FROM orders
WHERE create_time >= '2024-06-01' AND create_time < '2024-06-02';
-- type: range，key: idx_create_time

-- MySQL 8.0.13 起支持函数索引，查询中的表达式要和索引定义一致
ALTER TABLE orders ADD INDEX idx_create_date ((DATE(create_time)));
EXPLAIN SELECT * FROM orders WHERE DATE(create_time) = '2024-06-01';
-- type: ref，key: idx_create_date
```

## 面试官可能追问

::: details 联合索引 (a, b, c)，WHERE a = 1 AND c = 3 用到了几列？怎么看？
只用 a 定位，c 可以借助索引下推，在索引里过滤掉不满足的记录后再回表。可以看 EXPLAIN 的 `key_len`，它是用于定位的索引列的字节数之和：假设 a、b、c 都是 `INT NOT NULL`（各 4 字节），key_len 为 4 说明只用了 a，为 12 说明三列都用上了。
:::

::: details 不满足最左前缀，就一定不走索引吗？
不一定。如果查询的列都在这个联合索引里，优化器可能选择扫描整个索引（type 为 index）：索引比整张表小，扫它比扫全表便宜，但这只是扫得少一点，不是定位。另外 MySQL 8.0.13 引入了 Skip Scan：在 `(a, b)` 上查 `WHERE b = 2`，如果 a 的不同值很少，优化器可以对 a 的每个值分别查 `b = 2`，EXPLAIN 显示 `Using index for skip scan`。它有使用条件，比如查询只能用到索引中的列。
:::

::: details 为什么不给每个列都建一个单列索引？
每多一个索引，写入时就要多维护一棵 B+ 树，占用的磁盘和缓冲池也更多。而且多个单列索引一般只能用上一个：`WHERE a = 1 AND b = 2` 用 `(a, b)` 一次就能定位；index_merge 虽然能合并多个索引的结果，但代价往往比一个合适的联合索引高。
:::

::: details 怎么判断一个索引建得好不好？
看 EXPLAIN：type 最好能达到 range 及以上，rows 和实际返回的行数接近，Extra 里没有不必要的 `Using filesort`。上线后可以用 `sys.schema_unused_indexes` 找出从没用过的索引，用 `sys.schema_redundant_indexes` 找出冗余索引，定期清理。
:::

## 易错点

- WHERE 里条件的书写顺序不影响最左前缀，`b = 2 AND a = 1` 照样能用 `(a, b)`
- 隐式类型转换只在**字符串列和数字比较**时导致失效；INT 列和字符串常量比较，转换的是常量，索引仍然可用
- `LIKE 'abc%'` 可以用索引，但它属于范围条件，联合索引中后面的列不能再用于定位
- `!=`、`IS NULL`、`IS NOT NULL` 不是一定不走索引，要以 EXPLAIN 为准
