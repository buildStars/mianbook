---
difficulty: 2
tags: [高频, 原理]
---

# 聚簇索引和二级索引有什么区别？什么是回表和覆盖索引？

::: tip 一句话回答
InnoDB 的表数据本身就按主键组织成一棵 B+ 树，这就是**聚簇索引**，叶子节点存整行数据；**二级索引**的叶子节点只存索引列和主键值。通过二级索引查到主键后，再回到聚簇索引取整行，叫**回表**；要查的列在二级索引里都有、不需要回表，叫**覆盖索引**，EXPLAIN 的 Extra 显示 `Using index`。主键推荐用自增值，因为新记录总是追加在最后，不会像随机 UUID 那样频繁页分裂。
:::

## 详细解析

### 两种索引存的是什么

B+ 树本身的结构见 [InnoDB 为什么用 B+ 树](/basics/mysql/01-b-plus-tree)。

| | 聚簇索引 | 二级索引 |
| --- | --- | --- |
| 数量 | 每张表只有一个 | 可以有多个 |
| 排序依据 | 主键 | 索引列，列值相同时再按主键 |
| 叶子节点存什么 | 整行数据（包括隐藏列） | 索引列的值 + 主键值 |
| 查询代价 | 一次查找拿到整行 | 需要索引以外的列时要回表 |

聚簇索引怎么选：有主键就用主键；没有就用第一个所有列都是 NOT NULL 的唯一索引；都没有，InnoDB 用一个隐藏的 6 字节行 ID 生成聚簇索引。

二级索引为什么存主键，而不是行的物理地址：页分裂、页合并时，数据行会移动位置。存主键的话，行移动了二级索引也不用改；代价是每次回表都要再查一次聚簇索引。

### 回表的过程和代价

以 `user` 表为例，`idx_name_age` 是 `(name, age)` 上的联合索引：

```text
SELECT * FROM user WHERE name = 'Tom';

1. 在 idx_name_age 中找到第一条 name = 'Tom' 的记录，拿到主键 id = 7
2. 拿 id = 7 到聚簇索引里从根节点往下查，取出整行        ← 回表
3. 沿 idx_name_age 的叶子节点继续往后读，下一条还是 'Tom' 就重复第 2 步
```

每条匹配的记录都要单独回表一次，而这些主键在聚簇索引里往往是分散的，回表就成了大量随机 I/O。匹配的行越多，回表越贵，所以当优化器估算要回表的行很多时，会直接选择全表扫描。

### 覆盖索引和索引下推

**覆盖索引**：查询用到的列都能在二级索引里拿到，就不用回表。二级索引里天然带着主键，所以 `SELECT id, name, age FROM user WHERE name = 'Tom'` 也是覆盖索引。常见做法是把高频查询要用的少量列加进联合索引，用索引变大换回表次数减少。

**索引下推**（Index Condition Pushdown，ICP，MySQL 5.6 引入）：

```sql
SELECT * FROM user WHERE name LIKE 'T%' AND age = 20;
```

`name LIKE 'T%'` 是范围条件，后面的 `age` 不能再用来在索引中定位（原因见 [最左前缀原则](/basics/mysql/03-index-design)）。

- 没有 ICP：存储引擎按 name 每找到一条记录就回表，把整行交给 Server 层，由 Server 层判断 `age = 20`
- 有 ICP：Server 层把 `age = 20` 下推给存储引擎，引擎直接用二级索引里的 age 值过滤，不满足的记录不回表

ICP 在 InnoDB 中只用于二级索引，目的是减少回表，EXPLAIN 的 Extra 显示 `Using index condition`。

### 主键为什么推荐自增

- **自增主键**：新记录总是追加到聚簇索引最右边的页，写满了就开一个新页，页基本是填满的
- **随机主键**（如 UUID）：插入位置随机，目标页满了就要**页分裂**：申请新页，把一部分记录搬过去。MySQL 官方文档的说法是，顺序插入时页大约 15/16 满，随机插入时只有 1/2 到 15/16 满。同样的数据占用更多页，缓冲池能缓存的有效数据也更少
- **主键长度**：每个二级索引都要存主键值，`CHAR(36)` 的 UUID 比 8 字节的 BIGINT 大得多，所有二级索引都会跟着变大

一定要用 UUID 时，MySQL 8.0 可以用 `UUID_TO_BIN(UUID(), 1)` 把它转成大致按时间递增的 16 字节二进制再存。

## 代码示例

```sql
CREATE TABLE user (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL,
  age INT NOT NULL,
  city VARCHAR(50) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_name_age (name, age)
) ENGINE = InnoDB;
```

几条查询的 EXPLAIN 结果（示意，只保留关键列）：

| 查询 | type | key | Extra | 说明 |
| --- | --- | --- | --- | --- |
| `SELECT * FROM user WHERE id = 7` | const | PRIMARY | | 只查聚簇索引 |
| `SELECT * FROM user WHERE name = 'Tom'` | ref | idx_name_age | | 需要回表 |
| `SELECT id, age FROM user WHERE name = 'Tom'` | ref | idx_name_age | Using index | 覆盖索引，不回表 |
| `SELECT * FROM user WHERE name LIKE 'T%' AND age = 20` | range | idx_name_age | Using index condition | 索引下推，减少回表 |

## 面试官可能追问

::: details 没有定义主键的表会怎样？
InnoDB 会找第一个所有列都是 NOT NULL 的唯一索引当聚簇索引；连这样的索引都没有，就用隐藏的 6 字节行 ID 生成一个。这个行 ID 用户查不到也用不上，而且分配它的计数器是所有无主键表共用的。所以建表时应该总是显式定义主键；MySQL 8.0.30 起还可以开启 `sql_generate_invisible_primary_key`，建表时没写主键就自动加一个不可见的自增主键。
:::

::: details 联合索引是 (name, age)，SELECT id FROM user WHERE name = 'Tom' 要回表吗？
不用。二级索引的叶子节点本来就存着主键值，`id`、`name`、`age` 都能直接从索引里拿到。也正因为主键会出现在每一个二级索引里，主键要尽量短。
:::

::: details 回表很多时，除了覆盖索引还有什么优化？
可以先用覆盖索引查出主键，再按主键取整行，比如深分页的延迟关联（见 [深分页怎么优化](/basics/mysql/10-deep-pagination)）。MySQL 还有 MRR（Multi-Range Read）优化：先把要回表的主键排好序，再去聚簇索引读取，把随机读变成接近顺序读，EXPLAIN 中显示 `Using MRR`，是否使用由优化器按成本决定。
:::

::: details 分布式环境下主键怎么生成？
单库用自增主键最简单。分库分表后各库的自增值会冲突，常见做法是雪花算法（时间戳 + 机器号 + 序列号）、号段模式（每次从数据库领一段 ID 在内存里分配），或者 UUIDv7 这类按时间排序的 ID。它们都是趋势递增的，插入时不会频繁页分裂。另外自增 ID 会暴露业务量、容易被遍历，对外展示时可以另外生成一个随机的业务编号。
:::

## 易错点

- `Using index` 表示覆盖索引，`Using index condition` 表示索引下推，两者不是一回事
- 覆盖索引不只看 WHERE，SELECT、ORDER BY 用到的列也都要在索引里
- InnoDB 中"主键索引"和"聚簇索引"通常指同一个东西，一张表只有一个
- 主键不是越随机越好，也不是越长越好：它影响页分裂，也影响所有二级索引的大小
