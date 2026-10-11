---
difficulty: 2
tags: [高频, 原理]
---

# 事务的 ACID 分别是靠什么实现的？

::: tip 一句话回答
在 InnoDB 中，**原子性**靠 undo log：修改前先记下怎么撤销，回滚时按 undo log 反向恢复；**持久性**靠 redo log：提交时先把修改顺序写入 redo log 并刷盘（WAL），数据页稍后再写，崩溃后用 redo log 重做；**隔离性**靠锁和 MVCC。**一致性**是目的而不是某个机制，由前三者加上数据库约束和正确的业务逻辑共同保证。
:::

## 详细解析

### 对应关系

| 特性 | 含义 | 实现 |
| --- | --- | --- |
| 原子性（Atomicity） | 事务里的操作要么全部生效，要么全部撤销 | undo log |
| 一致性（Consistency） | 事务前后数据都满足约束和业务规则 | 原子性、隔离性、持久性 + 约束 + 应用逻辑 |
| 隔离性（Isolation） | 并发执行的事务互不干扰 | 锁 + MVCC |
| 持久性（Durability） | 提交后的数据不会因为崩溃而丢失 | redo log + 崩溃恢复 |

### 原子性：undo log

InnoDB 修改一行之前，先把撤销这次修改需要的信息写进 undo log：

- INSERT：记下新行的主键，回滚时把它删掉
- UPDATE：记下被修改列的旧值，回滚时改回去
- DELETE：先只给记录打上删除标记，回滚时去掉标记

执行 ROLLBACK，或者数据库崩溃重启时发现有未提交的事务，InnoDB 都会按 undo log 反向撤销。undo log 还用来构建数据的历史版本，供 [MVCC](/basics/mysql/06-mvcc) 读取。

### 持久性：redo log 和 WAL

最直接的做法是提交时把改过的数据页都写回磁盘，但这样很慢：一个事务可能改了分散在各处的多个 16KB 的页，都是随机写；而且一页里可能只改了几个字节，却要写整页。

InnoDB 用的是 **WAL（Write-Ahead Logging，先写日志）**：

1. 修改发生在内存的缓冲池（Buffer Pool）里，被改过但还没写回磁盘的页叫脏页
2. 同时生成 redo log，记录"哪个页的哪个位置改成了什么"，先放在内存的 redo log buffer 里
3. 提交时把 redo log 写入磁盘。redo log 是顺序追加的，体积又小，比随机写数据页快得多
4. 脏页由后台线程择机刷盘。已经刷盘的进度叫 checkpoint，checkpoint 之前的 redo log 就可以被覆盖重用
5. 崩溃重启后，从 checkpoint 开始重放 redo log，把已提交但还没刷盘的修改恢复出来

### redo log 的刷盘策略

`innodb_flush_log_at_trx_commit` 决定提交时 redo log 怎么落盘：

| 取值 | 提交时的行为 | 可能丢失的数据 |
| --- | --- | --- |
| 1（默认） | 写入并 fsync 到磁盘 | 不会丢失已提交的事务 |
| 2 | 只写到操作系统的页缓存，每秒 fsync 一次 | MySQL 进程崩溃不丢；操作系统崩溃或断电可能丢约 1 秒 |
| 0 | 不写，由后台线程每秒写入并 fsync | MySQL 进程崩溃就可能丢约 1 秒 |

对数据安全要求高的库用 1，并配合 `sync_binlog = 1`，也就是常说的"双 1"配置，原因见 [两阶段提交](/basics/mysql/09-logs)。0 和 2 只适合能容忍少量丢失的场景，比如批量导入数据时临时调整。这里的"约 1 秒"是大致范围，后台线程的调度可能有延迟，不能当成精确保证。

### 隔离性和一致性

- **隔离性**：写和写之间靠行锁互斥，普通 SELECT 靠 MVCC 读快照、不加锁。不同隔离级别的差别见 [事务隔离级别](/basics/mysql/05-isolation-levels)
- **一致性**：数据库能保证主键、唯一、外键、NOT NULL、CHECK（MySQL 8.0.16 起才真正生效）这些约束；但"转账前后总额不变"这类业务规则，数据库并不知道，要靠应用把扣款和入账放在同一个事务里。所以说 A、I、D 是手段，C 是目的

## 代码示例

```sql
CREATE TABLE account (
  id BIGINT PRIMARY KEY,
  balance DECIMAL(12, 2) NOT NULL,
  CONSTRAINT chk_balance CHECK (balance >= 0)
);

START TRANSACTION;
UPDATE account SET balance = balance - 100 WHERE id = 1;
UPDATE account SET balance = balance + 100 WHERE id = 2;
COMMIT;
```

如果 1 号账户余额不足，第一条 UPDATE 会因为违反 CHECK 约束报错。这时**只有这条语句被撤销**，事务仍然开着，应用要捕获错误并执行 ROLLBACK（Node.js + mysql2）：

```js
const conn = await pool.getConnection()
try {
  await conn.beginTransaction()
  await conn.query('UPDATE account SET balance = balance - ? WHERE id = ?', [100, 1])
  await conn.query('UPDATE account SET balance = balance + ? WHERE id = ?', [100, 2])
  await conn.commit()
} catch (err) {
  await conn.rollback() // 任何一步失败，都撤销整个事务
  throw err
} finally {
  conn.release()
}
```

## 面试官可能追问

::: details 事务里一条 SQL 报错，前面执行成功的语句会自动回滚吗？
一般不会。主键冲突、违反约束、锁等待超时这类错误，InnoDB 只撤销出错的那条语句，事务还开着，前面的修改还在，需要应用显式 ROLLBACK。例外是死锁，InnoDB 会回滚整个事务。锁等待超时默认也只撤销当前语句，开启 `innodb_rollback_on_timeout` 后才回滚整个事务。
:::

::: details 有了 redo log，为什么还需要 doublewrite buffer？
redo log 记录的是"在某个页上做了什么修改"，重放的前提是磁盘上的这个页本身是完好的。InnoDB 的页是 16KB，操作系统和磁盘一次原子写入的单位通常更小，断电时可能只写了半个页，这个页就损坏了，redo log 也救不回来。doublewrite 先把要刷盘的脏页写到一块专门的区域，再写到数据文件中的实际位置；如果实际位置的页写坏了，恢复时用 doublewrite 里的完整副本还原，再重放 redo log。
:::

::: details redo log 写满了会怎样？
redo log 的总大小是固定的，循环使用（MySQL 8.0.30 起由 `innodb_redo_log_capacity` 控制总容量）。checkpoint 之前的部分对应的脏页已经刷盘，可以被覆盖。如果写入太快，redo log 快要追上 checkpoint，InnoDB 就必须先加紧刷脏页、推进 checkpoint，这期间写入会明显变慢甚至停顿。所以写入量大的库要给 redo log 足够的容量。
:::

## 易错点

- 一致性不是由某个日志或锁实现的，它是事务要达到的目标
- undo log 负责回滚和 MVCC，redo log 负责崩溃后恢复已提交的修改，两者不要混淆
- 语句报错不等于事务回滚，应用代码里一定要处理 ROLLBACK
- WAL 是先写日志、后写数据页，不是不写数据页
