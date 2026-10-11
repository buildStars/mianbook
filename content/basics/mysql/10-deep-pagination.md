---
difficulty: 2
tags: [性能优化, 场景题]
---

# 深分页为什么慢？怎么优化？

::: tip 一句话回答
`LIMIT 1000000, 10` 没法直接跳到第 100 万行，MySQL 要按顺序**读出前 1000010 行，再丢掉前 100 万行**；如果是按二级索引排序又 `SELECT *`，这 100 多万行每一行都要**回表**。优化有三种思路：**延迟关联**，先在覆盖索引上查出 10 个主键再回表；**游标分页**，记住上一页最后一条记录，用 `WHERE id > ? LIMIT 10` 直接定位；从业务上**限制最大页数**。游标分页最快，但不能跳页，而且排序键必须唯一（不唯一就加上主键）。
:::

## 详细解析

### 为什么慢

```sql
SELECT * FROM orders WHERE user_id = 1001
ORDER BY create_time DESC, id DESC LIMIT 1000000, 10;
```

假设有 `(user_id, create_time)` 联合索引，执行过程是：

1. 存储引擎沿索引顺序找到下一条匹配的记录，回表取出整行，交给 Server 层
2. Server 层发现这一行还在前 100 万行之内，丢掉，再要下一行
3. 重复 1000010 次，最后 10 行才返回给客户端

LIMIT 是在 Server 层处理的，存储引擎不知道哪些行最终会被丢掉，所以被丢弃的 100 万行也都完整地回了表。回表是随机 I/O，代价远高于顺序扫描索引。如果优化器估算回表太贵，还可能改成全表扫描加排序，同样很慢。

### 方案一：延迟关联

```sql
SELECT o.* FROM orders o
JOIN (
  SELECT id FROM orders WHERE user_id = 1001
  ORDER BY create_time DESC, id DESC LIMIT 1000000, 10
) t ON o.id = t.id
ORDER BY o.create_time DESC, o.id DESC;
```

子查询只用到 `user_id`、`create_time` 和 `id`，二级索引就能覆盖（二级索引里带着主键），扫描 100 万条索引记录都不用回表；外层只对最终的 10 个主键回表。外层要再写一次 ORDER BY，因为 JOIN 不保证保留子查询的顺序。排序里带上 `id`，`create_time` 相同的记录顺序才固定，偏移量分页同样需要，否则翻页时可能重复或漏掉。

它没有改变"扫描再丢弃"的本质，只是让丢弃的代价变小，偏移量继续增大还是会变慢。覆盖索引和回表的原理见 [聚簇索引和二级索引](/basics/mysql/02-clustered-index)。

### 方案二：游标分页

不用偏移量，而是记住上一页最后一条记录的位置，从那里接着往后查：

```sql
-- 第一页
SELECT * FROM orders WHERE user_id = 1001
ORDER BY create_time DESC, id DESC LIMIT 10;

-- 下一页：上一页最后一条是 create_time = '2024-06-01 10:00:00'，id = 8848
SELECT * FROM orders
WHERE user_id = 1001
  AND (create_time < '2024-06-01 10:00:00'
       OR (create_time = '2024-06-01 10:00:00' AND id < 8848))
ORDER BY create_time DESC, id DESC LIMIT 10;
```

索引直接定位到上次停下的位置，再往后读 10 条，不管翻到第几页，代价都差不多。

`create_time` 可能重复，只用它做游标的话，同一时刻的多条记录正好被分到两页时，就会漏掉或重复，所以要加上 `id` 组成唯一的排序键。二级索引本身带着主键，`(user_id, create_time)` 实际上就是按 `(user_id, create_time, id)` 排好序的，这个排序能直接利用索引。

局限：

- 不能跳到任意一页，只能上一页、下一页，适合信息流、"加载更多"这类交互
- 排序字段必须唯一（或者加上主键），并且要有对应的索引
- 支持按多个字段、按用户选择的字段排序时，游标条件会变得复杂

### 方案三：从业务上限制

很少有用户真的需要翻到第 1 万页。可以限制最多翻 100 页，引导用户用筛选条件缩小范围；全文搜索这类场景交给搜索引擎，搜索引擎同样限制深分页，例如 Elasticsearch 默认最多只能取前 10000 条，更深的翻页要用 `search_after`，也是游标的思路。

## 代码示例

接口返回下一页的游标，前端原样带回来（Node.js + mysql2）：

```js
// cursor 编码了上一页最后一条记录的 create_time 和 id，第一页不传
async function listOrders(userId, cursor, size = 20) {
  let sql = 'SELECT id, amount, status, create_time FROM orders WHERE user_id = ?'
  const params = [userId]
  if (cursor) {
    const { time, id } = JSON.parse(Buffer.from(cursor, 'base64url').toString())
    const t = new Date(time)
    sql += ' AND (create_time < ? OR (create_time = ? AND id < ?))'
    params.push(t, t, id)
  }
  sql += ' ORDER BY create_time DESC, id DESC LIMIT ?'
  params.push(size + 1) // 多查一条，用来判断还有没有下一页

  const [rows] = await pool.query(sql, params)
  const list = rows.slice(0, size)
  const last = list.at(-1)
  const nextCursor = rows.length > size
    ? Buffer.from(JSON.stringify({ time: last.create_time, id: last.id })).toString('base64url')
    : null
  return { list, nextCursor }
}
```

## 面试官可能追问

::: details 翻页过程中有新数据插入，两种分页有什么区别？
偏移量分页按"第几条"取数据，前面插入一条新记录，后面的记录都往后挪一位，下一页的第一条就是上一页的最后一条，出现重复；有删除时则会漏掉数据。游标分页按"某条记录之后"取，不受前面插入、删除的影响，结果更稳定，信息流类的产品基本都用它。
:::

::: details 必须支持跳页，还要翻得很深，怎么办？
先确认需求是否真的存在，多数情况下限制最大页数就够了。必须支持时，可以用延迟关联降低代价；如果按自增主键排序且中间没有删除，可以直接由页号算出起始 ID，用 `WHERE id > ?` 定位，但只要 ID 不连续就会不准。数据量更大时，可以交给搜索引擎，或者预先计算好分页结果。
:::

::: details 分页还要显示总数，COUNT(*) 也很慢怎么办？
InnoDB 没有保存表的总行数，因为在 MVCC 下，不同事务同一时刻看到的行数可能不同，`COUNT(*)` 只能实际去扫描。可以只显示"约 xx 条"，用 EXPLAIN 的 rows 或 `information_schema.TABLES` 里的估算值；按用户维度的计数可以单独维护计数表或放进 Redis；也可以干脆不显示总数，只提供"加载更多"。
:::

## 易错点

- 延迟关联只是减少了回表，偏移量很大时仍然要扫描大量索引记录
- 游标分页的排序键必须唯一，`create_time` 这类可能重复的字段要加上 `id`
- 延迟关联的外层查询要重新写 ORDER BY
- 游标最好编码后交给前端，服务端解析后用参数化查询，不要让前端直接拼 SQL 条件
