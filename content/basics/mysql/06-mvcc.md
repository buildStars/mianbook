---
difficulty: 3
tags: [高频, 原理]
---

# MVCC 是怎么实现的？

::: tip 一句话回答
MVCC（多版本并发控制）让普通读不加锁，读和写互不阻塞。InnoDB 每行记录有两个隐藏列：最后修改它的事务 ID（**trx_id**）和指向上一个版本的回滚指针（**roll_pointer**），旧版本保存在 undo log 里，串成一条**版本链**。快照读时生成一个 **ReadView**，记下当时还有哪些事务没提交，再沿着版本链找到第一个对自己可见的版本。读已提交每条 SELECT 都生成新的 ReadView，可重复读只在第一次 SELECT 时生成。
:::

## 详细解析

### 隐藏列和版本链

InnoDB 聚簇索引的每条记录，除了用户定义的列，还有：

- `DB_TRX_ID`（6 字节）：最后一次插入或修改这行的事务 ID，事务 ID 由 InnoDB 递增分配
- `DB_ROLL_PTR`（7 字节）：回滚指针，指向 undo log 中这行的上一个版本
- `DB_ROW_ID`（6 字节）：只有表没有主键、也没有合适的唯一索引时才用到

每次更新时，InnoDB 先把旧值写进 undo log，再修改记录，并让 roll_pointer 指向这条 undo log。修改多次后就形成了版本链：

```text
聚簇索引中的记录             undo log                  undo log
name='C', trx_id=300  ──>  name='B', trx_id=200  ──>  name='A', trx_id=100
（最新版本）
```

旧版本不是一份份完整的行拷贝。undo log 只记录被修改列的旧值，读旧版本时，从当前记录出发，按 undo log 一步步还原出来。

### ReadView 和可见性规则

ReadView 是快照读时生成的"快照"，包含四个信息：

| 字段 | 含义 |
| --- | --- |
| `m_ids` | 生成 ReadView 时，所有**活跃**（已开始、未提交）的读写事务 ID |
| `min_trx_id` | `m_ids` 中最小的 ID；没有活跃事务时等于 `max_trx_id` |
| `max_trx_id` | 生成 ReadView 时系统**下一个要分配**的事务 ID，不是 `m_ids` 中的最大值 |
| `creator_trx_id` | 生成这个 ReadView 的事务自己的 ID |

拿版本链上某个版本的 `trx_id` 按顺序判断：

1. `trx_id == creator_trx_id`：是自己改的，**可见**
2. `trx_id < min_trx_id`：修改它的事务在生成 ReadView 之前就提交了，**可见**
3. `trx_id >= max_trx_id`：修改它的事务在生成 ReadView 之后才开始，**不可见**
4. 介于两者之间：`trx_id` 在 `m_ids` 里，说明当时还没提交，**不可见**；不在，说明已经提交，**可见**

不可见就顺着 roll_pointer 找上一个版本，继续判断，直到找到第一个可见的版本。整条链都不可见，说明这行对当前事务来说不存在。InnoDB 的删除是给记录打删除标记，如果找到的可见版本带着删除标记，也当作不存在。

### 读已提交和可重复读的区别

两者的区别只在 **ReadView 的生成时机**。看一个例子（事务 ID 都是假设的）：

```text
初始：name = 'A'，trx_id = 50，早已提交

T1  事务 100：UPDATE ... SET name = 'B'（未提交）
T2  只读事务 R 第一次 SELECT，生成 ReadView：m_ids = [100]，min = 100，max = 101
    最新版本 trx_id = 100，在 m_ids 中，不可见
    上一个版本 trx_id = 50 < 100，可见，读到 'A'
T3  事务 100 提交
T4  事务 R 第二次 SELECT：
    读已提交：重新生成 ReadView，m_ids 为空，min = max = 101，100 < 101 可见，读到 'B'
    可重复读：复用 T2 的 ReadView，100 仍在 m_ids 中，不可见，还是读到 'A'
```

### 快照读和当前读

只有普通 SELECT 是快照读，走 MVCC。`SELECT ... FOR UPDATE`、`SELECT ... FOR SHARE`、INSERT、UPDATE、DELETE 是**当前读**：读最新提交的版本并加锁。读未提交直接读最新版本，串行化在事务里给普通 SELECT 也加锁，所以 MVCC 主要在读已提交和可重复读下起作用。两者对应的隔离效果见 [事务隔离级别](/basics/mysql/05-isolation-levels)。

## 面试官可能追问

::: details 可重复读下，UPDATE 为什么不用快照读？
如果 UPDATE 基于快照计算，会覆盖别人已经提交的修改。比如库存是 10，A 的快照里也是 10；B 扣减 1 并提交，库存变成 9；A 执行 `UPDATE stock SET num = num - 1 WHERE id = 1`，如果按快照计算会写成 9，B 的扣减就丢了。所以更新必须读最新版本并加锁：A 读到 9，写成 8。这也是为什么同一个事务里 UPDATE 之后再 SELECT，可能看到和之前快照不一样的结果。
:::

::: details 长事务对 MVCC 有什么影响？
undo log 里的旧版本，只要还可能被某个 ReadView 用到，就不能被 purge 线程清理。一个长时间不提交的事务，会让它开始之后其他事务产生的旧版本都无法清理，undo 占用的空间越来越大，版本链越来越长，其他事务的快照读要往回找的版本也越来越多，查询变慢。可以查 `information_schema.innodb_trx`，按 `trx_started` 找出运行时间长的事务；`SHOW ENGINE INNODB STATUS` 里的 History list length 持续增长也是信号。
:::

::: details MVCC 能解决写写冲突吗？
不能。MVCC 解决的是读和写之间的冲突：读不用等写，写也不用等读。两个事务同时修改同一行，后来的那个要等前一个提交或回滚、释放行锁，这是锁的工作。业务里"先查出来、在代码里计算、再写回去"的写法，查询用的是快照，还是会丢失更新，要用 `SELECT ... FOR UPDATE` 或者乐观锁（版本号）来防止。
:::

## 易错点

- `max_trx_id` 是生成 ReadView 时下一个要分配的事务 ID，不是活跃事务里最大的 ID
- 可重复读的 ReadView 在第一次快照读时生成，不是在 BEGIN 时
- 版本链上的旧版本是靠 undo log 还原出来的，数据页里并没有存多份完整的行
- 只有快照读用 MVCC，当前读总是读最新版本并加锁
