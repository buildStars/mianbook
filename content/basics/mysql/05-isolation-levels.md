---
difficulty: 2
tags: [高频, 原理]
---

# 事务隔离级别有哪些？分别解决了什么问题？

::: tip 一句话回答
SQL 标准定义了四个隔离级别：**读未提交**、**读已提交**、**可重复读**、**串行化**，后三个依次解决了**脏读**、**不可重复读**、**幻读**，隔离越强，并发性能越差。InnoDB 默认是可重复读：普通 SELECT（快照读）在整个事务里读同一个 **MVCC** 快照；`SELECT ... FOR UPDATE` 这类当前读用**临键锁**锁住扫描范围，阻止别人插入。所以 InnoDB 的可重复读在大多数情况下不会出现幻读。
:::

## 详细解析

### 三种读问题

以 `account` 表中 id = 1、余额 100 的行为例，A、B 是两个并发的事务：

| 问题 | 过程 | 本质 |
| --- | --- | --- |
| 脏读 | B 把余额改成 200 但没提交，A 读到 200，随后 B 回滚 | 读到了别人**未提交**的数据 |
| 不可重复读 | A 读到 100；B 改成 200 并提交；A 再读得到 200 | 同一行**两次读到的内容**不同 |
| 幻读 | A 查 `balance > 50` 得到 2 行；B 插入一行余额 80 的记录并提交；A 再查得到 3 行 | 同一个范围**两次查到的行数**不同，多出了"幻影行" |

不可重复读针对的是已有的行被修改或删除，幻读针对的是范围内有新行插入。

### 四个级别对比

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | InnoDB 的实现 |
| --- | --- | --- | --- | --- |
| 读未提交（READ UNCOMMITTED） | 可能 | 可能 | 可能 | 直接读最新数据，不用 MVCC |
| 读已提交（READ COMMITTED） | 不会 | 可能 | 可能 | 每条 SELECT 生成一个新的 ReadView |
| 可重复读（REPEATABLE READ） | 不会 | 不会 | 标准允许出现，InnoDB 基本避免 | 第一次 SELECT 时生成 ReadView，之后一直复用；当前读加临键锁 |
| 串行化（SERIALIZABLE） | 不会 | 不会 | 不会 | 普通 SELECT 也加共享锁（自动提交模式下单独执行的 SELECT 除外） |

ReadView 怎么判断数据是否可见，见 [MVCC 是怎么实现的](/basics/mysql/06-mvcc)。不管哪个级别，写操作都会加排他锁，两个未提交的事务不能同时修改同一行。

### 可重复读下怎么处理幻读

InnoDB 的读分两种：

- **快照读**：普通 SELECT，读 ReadView 对应的历史版本，不加锁。整个事务复用同一个 ReadView，别人后来插入并提交的行对它不可见，所以快照读不会出现幻读
- **当前读**：`SELECT ... FOR UPDATE`、`SELECT ... FOR SHARE`、UPDATE、DELETE，读最新提交的版本并加锁。可重复读下扫描范围时加**临键锁**（记录锁 + 间隙锁），别的事务没法往这个范围里插入新行，所以当前读也不会出现幻读

锁的细节见 [InnoDB 有哪些锁](/basics/mysql/07-locks)。问题出在两种读混用的时候：

| 时间 | 事务 A | 事务 B |
| --- | --- | --- |
| 1 | `BEGIN; SELECT * FROM account WHERE balance > 50;` 得到 2 行 | |
| 2 | | `INSERT INTO account VALUES (3, 80); COMMIT;` |
| 3 | `SELECT * FROM account WHERE balance > 50;` 仍然是 2 行 | |
| 4 | `SELECT * FROM account WHERE balance > 50 FOR UPDATE;` 得到 3 行 | |

第 1 步是快照读，没有加锁，所以 B 能插入；第 4 步是当前读，读的是最新数据，就看到了新行。如果 A 第一次查询就用 `FOR UPDATE`，B 的插入会被阻塞到 A 结束。

### 查看和设置隔离级别

```sql
SELECT @@transaction_isolation;  -- MySQL 8.0 的变量名，旧的 tx_isolation 已被移除
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;  -- 只对当前会话生效
```

## 面试官可能追问

::: details InnoDB 的可重复读能完全避免幻读吗？
不能完全避免。除了上面快照读和当前读混用的情况，还有一种：A 先快照读得到 2 行；B 插入一行并提交；A 执行 `UPDATE account SET ... WHERE balance > 50`，这是当前读，会把 B 插入的那行也一起更新，这一行的最新版本就成了 A 自己修改的；A 再快照读时，自己改过的版本对自己可见，结果变成了 3 行。需要严格避免时，在事务一开始就用当前读加锁，或者使用串行化。
:::

::: details 为什么 MySQL 默认可重复读，而很多业务改成读已提交？
历史原因和 binlog 有关。早期 binlog 只有 STATEMENT 格式，记录的是 SQL 原文。读已提交下，主库上并发事务的执行效果，和从库按提交顺序重放 SQL 的效果可能不一样，主从会不一致，所以 MySQL 选了可重复读作默认值，至今读已提交也不能和 STATEMENT 格式一起用。现在 binlog 默认是 ROW 格式，不再有这个问题，而读已提交基本不加间隙锁、死锁更少、并发更好，所以不少业务会改用它。Oracle、PostgreSQL 的默认级别就是读已提交。
:::

::: details 读已提交和可重复读在实现上差在哪？
都基于 MVCC，区别在 ReadView 的生成时机：读已提交**每条 SELECT** 都生成新的 ReadView，所以能看到其他事务已经提交的修改；可重复读在事务中**第一次 SELECT** 时生成，之后一直复用。加锁也不同：读已提交一般只加记录锁、不加间隙锁，更新时不满足 WHERE 条件的行，判断完就会释放锁。
:::

## 易错点

- 不可重复读是同一行的内容变了，幻读是范围里多了行，不要混为一谈
- 可重复读的快照是在第一次 SELECT 时生成的，不是在 BEGIN 时；想在开启事务时就生成，用 `START TRANSACTION WITH CONSISTENT SNAPSHOT`
- 隔离级别管的是读能看到什么，任何级别下的写写冲突都靠锁解决
