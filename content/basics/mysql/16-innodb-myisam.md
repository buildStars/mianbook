---
difficulty: 1
tags: [高频]
---

# InnoDB 和 MyISAM 有什么区别？

::: tip 一句话回答
核心区别有四点：InnoDB **支持事务**，MyISAM 不支持；InnoDB 是**行锁**，MyISAM 只有**表锁**；InnoDB 有 redo log，**崩溃后能自动恢复**，MyISAM 崩溃后可能要手动修表；InnoDB 用**聚簇索引**，数据就存在主键 B+ 树里，MyISAM 的索引和数据分开存。另外 InnoDB 支持外键，MyISAM 不支持。因为这些，InnoDB 早就是 MySQL 的默认引擎，新项目基本不再用 MyISAM。
:::

## 详细解析

### 对比

| 维度 | InnoDB | MyISAM |
| --- | --- | --- |
| 事务 | 支持，ACID | 不支持 |
| 锁粒度 | 行锁（加间隙锁等），读走 MVCC 不加锁 | 表锁，写时整张表被锁 |
| 崩溃恢复 | redo log + undo log 自动恢复 | 没有，可能需要 `REPAIR TABLE` |
| 外键 | 支持 | 不支持 |
| 索引结构 | 聚簇索引，二级索引存主键值 | 非聚簇，索引叶子存数据行的地址 |
| 文件 | 表空间文件（`.ibd`） | 数据 `.MYD`、索引 `.MYI` 分开 |
| `COUNT(*)` 无条件 | 要扫描索引 | 直接读存好的行数，很快 |
| 主键 | 必须有，没定义就自动生成隐藏的 | 可以没有 |

### 事务和崩溃恢复

InnoDB 用 undo log 实现回滚和 MVCC，用 redo log 保证已提交的事务不丢（见 [ACID 的实现](/basics/mysql/04-transaction-acid) 和 [三种日志](/basics/mysql/09-logs)）。MyISAM 每条语句写完就落到数据文件，没有日志，执行到一半宕机会留下损坏的表，也没法回滚。

### 锁和并发

MyISAM 读加共享表锁、写加排他表锁，写多的场景下读写互相阻塞，并发很差。它支持在表尾"并发插入"，能缓解一部分，但无法和行锁比。InnoDB 只锁需要的行，普通 SELECT 走快照读不加锁（见 [MVCC](/basics/mysql/06-mvcc) 和 [InnoDB 的锁](/basics/mysql/07-locks)）。

### 索引结构

```text
InnoDB 主键索引：叶子节点 = 整行数据
InnoDB 二级索引：叶子节点 = 主键值 ──> 回主键索引查整行

MyISAM 主键索引：叶子节点 = 行地址 ──> 去 .MYD 文件读
MyISAM 二级索引：叶子节点 = 行地址（和主键索引没区别）
```

所以 InnoDB 按主键查最快，二级索引要回表（见 [聚簇索引和二级索引](/basics/mysql/02-clustered-index)）；MyISAM 所有索引地位相同。

### 为什么默认是 InnoDB

业务数据几乎都需要事务和崩溃安全，Web 应用读写并发高，表锁扛不住。MyISAM 曾经的优势（全文索引、无条件 `COUNT(*)` 快、表文件小）要么 InnoDB 已经支持（全文索引），要么能用别的方式解决（见 [count 的区别](/basics/mysql/17-count)）。MySQL 8.0 的系统表也已经改用 InnoDB 存储。

## 面试官可能追问

::: details MyISAM 为什么能直接返回行数，InnoDB 不能？
MyISAM 只有表锁，同一时刻表的状态是唯一的，存一个总行数就行。InnoDB 有 MVCC，不同事务同一时刻看到的行数可能不同，没有一个对所有人都对的总数，只能按当前事务的可见性去数。
:::

::: details 什么场景还可以考虑 MyISAM？
几乎没有。以前用于只读的报表、日志表，但现在这些场景 InnoDB 一样能做，或者直接用专门的分析型数据库。它不安全的崩溃恢复是硬伤。
:::

::: details InnoDB 没定义主键会怎样？
它会选第一个非空的唯一索引作为聚簇索引；如果也没有，就生成一个 6 字节的隐藏行 ID。隐藏行 ID 不能被业务使用，所以建议总是显式定义一个自增或趋势递增的主键。
:::

## 易错点

- MyISAM 的 `COUNT(*)` 快只在**没有 WHERE 条件**时成立，带条件一样要扫描
- InnoDB 不是"只有行锁"，也有表级的意向锁，没走索引的更新会锁住大量行
- 两者都用 B+ 树做索引，区别在叶子节点存的是数据还是地址
