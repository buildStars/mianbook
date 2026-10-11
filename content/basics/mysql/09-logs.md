---
difficulty: 3
tags: [高频, 原理]
---

# redo log、undo log 和 binlog 有什么区别？为什么要两阶段提交？

::: tip 一句话回答
**redo log** 和 **undo log** 属于 InnoDB 引擎层：redo log 记录数据页的物理修改，用于崩溃恢复、保证持久性；undo log 记录修改前的旧值，用于回滚和 MVCC。**binlog** 属于 Server 层，是逻辑日志，用于主从复制和按时间点恢复。提交时按 **redo log prepare → 写 binlog → redo log commit** 的顺序进行两阶段提交，保证两份日志里要么都有这个事务、要么都没有，否则崩溃后主库和从库（或用 binlog 恢复出来的库）的数据会不一致。
:::

## 详细解析

### 三种日志对比

| | redo log | undo log | binlog |
| --- | --- | --- | --- |
| 所属层 | InnoDB 引擎层 | InnoDB 引擎层 | Server 层，与存储引擎无关 |
| 作用 | 崩溃恢复，保证持久性 | 事务回滚、MVCC 读旧版本 | 主从复制、按时间点恢复 |
| 记录内容 | 物理日志：对哪个数据页做了什么修改 | 逻辑日志：怎么把数据改回去 | 逻辑日志：SQL 语句或行修改前后的值 |
| 写入方式 | 固定大小，循环写，对应脏页已经刷盘的部分可以被覆盖 | 存在 undo 表空间，不再需要后由 purge 线程清理 | 追加写，一个文件写满换下一个，不覆盖 |
| 写入时机 | 事务执行过程中不断写入 redo log buffer | 每次修改数据之前 | 执行时先写线程自己的 binlog cache，提交时一次性写入文件 |

redo log 的刷盘策略见 [ACID 是怎么实现的](/basics/mysql/04-transaction-acid)，undo log 在 MVCC 中的作用见 [MVCC 是怎么实现的](/basics/mysql/06-mvcc)。

binlog 有三种格式：STATEMENT 记录 SQL 原文，日志小，但 `UUID()`、`SYSDATE()`、不带 ORDER BY 的 `UPDATE ... LIMIT` 这类结果不确定的语句，在从库上执行的结果可能和主库不同；ROW 记录每一行修改前后的值，准确，但批量更新时日志很大；MIXED 由 MySQL 自动选择。MySQL 5.7.7 起默认是 ROW。

### 为什么要两份日志

binlog 属于 Server 层，所有引擎都能用，早期默认的 MyISAM 引擎没有崩溃恢复能力；InnoDB 是另一家公司开发、后来才接入 MySQL 的引擎，用自己的 redo log 实现了崩溃恢复。两者分工不同，谁也替代不了谁：

- binlog 不能用于崩溃恢复：它记录的是逻辑操作，不知道哪些修改已经写进了数据页、哪些还没有
- redo log 不能用于复制和归档：它是 InnoDB 私有的物理日志，循环写会覆盖旧内容，保存不了完整的历史

### 两阶段提交

开启 binlog 时，InnoDB 和 binlog 通过内部的 XA 事务协调提交：

```text
执行 UPDATE：修改缓冲池中的页，写 undo log，写 redo log（在内存中）
        │
提交 ┌─ 1. prepare：redo log 写入 prepare 状态和事务的 XID，刷盘
     ├─ 2. 写 binlog（带着同一个 XID），刷盘
     └─ 3. commit：在 redo log 中把事务标记为已提交
```

**如果不用两阶段提交**，两份日志各写各的，中间一旦崩溃就会不一致：

- 先写 redo log 再写 binlog：redo log 写完后崩溃，重启后主库靠 redo log 恢复了这次修改，但 binlog 里没有，从库和用 binlog 恢复出来的库都少了这笔数据
- 先写 binlog 再写 redo log：binlog 写完后崩溃，主库上这个事务没有提交、被回滚了，但 binlog 里有，从库反而多出了这笔数据

### 崩溃恢复时怎么判断

重启时 InnoDB 扫描 redo log，按事务的状态处理：

1. 已经有 commit 标记：事务已提交，恢复它
2. 只有 prepare：拿 XID 去 binlog 里找。binlog 里有这个事务完整的记录，说明 binlog 已经写好、可能已经传给了从库，就**提交**；找不到，说明 binlog 没写完，就**回滚**
3. 还没到 prepare：事务没进入提交流程，用 undo log 回滚

判断的标准是 **binlog 有没有写成功**：binlog 写成功才算真正提交，主库和从库就能保持一致。也正因为如此，第 3 步的 commit 标记不需要立即刷盘。

## 面试官可能追问

::: details 两阶段提交每次提交要刷两次盘，性能怎么保证？
靠**组提交**（group commit）：多个并发事务的 redo log 和 binlog 合并成一次 fsync。MySQL 把 binlog 的提交分成 flush、sync、commit 三个阶段，每个阶段排队的一批事务由一个线程统一处理。还可以用 `binlog_group_commit_sync_delay` 让 sync 前稍等一会儿，凑更多事务一起刷盘，用一点延迟换吞吐。
:::

::: details 什么是"双 1"配置？
`innodb_flush_log_at_trx_commit = 1` 让每次提交都把 redo log 刷盘，`sync_binlog = 1` 让每次提交都把 binlog 刷盘，两者在 MySQL 8.0 中都是默认值。只有两份日志都及时刷盘，崩溃后才不会丢失已提交的事务，主从也不会不一致。为了性能调大其中任何一个，就要接受崩溃时丢失少量数据的风险。
:::

::: details 误删了数据，怎么恢复到误操作之前？
用"全量备份 + binlog"：先恢复最近一次全量备份，再用 `mysqlbinlog` 重放从备份时间点到误操作之前的 binlog，跳过误操作的那部分。所以 binlog 要保留足够长的时间，MySQL 8.0 用 `binlog_expire_logs_seconds` 控制，默认 30 天。ROW 格式记录了行修改前后的值，也可以借助工具把误操作反向生成回滚语句。redo log 是循环写的，做不到这些。
:::

::: details binlog 除了主从复制，还能用来做什么？
Canal 这类工具会把自己伪装成 MySQL 的从库，订阅 ROW 格式的 binlog，把数据变更同步到 Elasticsearch、数据仓库，或者用来删除缓存，见 [缓存和数据库的一致性](/basics/redis/06-cache-consistency)。这类做法叫变更数据捕获（CDC），好处是业务代码不用改。
:::

## 易错点

- 两阶段提交的"两阶段"指 redo log 的 prepare 和 commit，binlog 写在两者之间
- redo log 是循环写的，不能用来恢复任意时间点的数据，那要靠全量备份加 binlog
- undo log 本身的修改也会写 redo log，崩溃恢复时先靠 redo log 恢复 undo log，再用 undo log 回滚未提交的事务
- STATEMENT 格式下 `NOW()` 是安全的，因为 binlog 会记录语句的执行时间；`UUID()`、`SYSDATE()` 才会导致主从不一致
