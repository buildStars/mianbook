---
difficulty: 2
tags: [高频, 原理]
---

# 一条 SQL 语句在 MySQL 里是怎么执行的？

::: tip 一句话回答
MySQL 分为 **Server 层**和**存储引擎层**。Server 层依次经过**连接器**（认证、管理连接）、**解析器**（词法和语法分析）、**优化器**（按成本选索引和 JOIN 顺序，生成执行计划）、**执行器**（按计划调用引擎接口取数据），MySQL 8.0 已经移除了查询缓存。查询到这里就结束了；更新还要在 InnoDB 里写 **undo log**、改 **Buffer Pool** 中的页、写 **redo log**，Server 层写 **binlog**，提交时走两阶段提交。改过的数据页先留在内存里，由后台线程择机刷盘。
:::

## 详细解析

### 整体架构

```text
客户端
  │ 建立 TCP 连接，认证账号
  ▼
Server 层
  连接器   认证账号、读取权限、管理连接
  解析器   词法分析、语法分析，生成语法树
  预处理   检查表和列是否存在、展开 *，解析出每个名字指向哪张表的哪一列
  优化器   改写 SQL，按成本选择索引和 JOIN 顺序，生成执行计划
  执行器   按执行计划调用存储引擎接口，过滤、排序、聚合后返回结果
  （binlog 由 Server 层负责）
  │ 通过统一的 handler 接口逐行读写
  ▼
存储引擎层（InnoDB）
  Buffer Pool、索引、行锁、MVCC、redo log、undo log
  │ 缺页时从磁盘读入，脏页由后台线程写回
  ▼
磁盘：表空间文件（.ibd）、redo log、undo 表空间、binlog 文件
```

- **连接器**：认证通过后，连接空闲超过 `wait_timeout`（默认 8 小时）会被服务端断开，所以连接池要做空闲检测
- **查询缓存**：MySQL 5.7 及以前可以开启查询缓存，相同的 SQL 命中就直接返回结果；MySQL 8.0 已经把它移除，原因见下面的追问
- **解析器**：词法分析识别出关键字、表名、列名，语法分析检查语句是否合法，`You have an error in your SQL syntax` 就是在这一步报的。之后的预处理阶段（源码里叫 prepare）打开表、检查列是否存在，`Table ... doesn't exist`、`Unknown column` 在这时报出；用服务端预处理语句时，这两个错误在 PREPARE 阶段就返回了，不用等到执行
- **优化器**：同一条 SQL 有多种执行方式，比如走哪个索引、多表关联谁先谁后。优化器根据统计信息估算成本，选代价最小的，EXPLAIN 看到的就是它的选择（见 [EXPLAIN 怎么看](/basics/mysql/08-slow-query)）
- **执行器**：MySQL 8.0 把执行器逐步改写成了迭代器模型，执行计划是一棵迭代器树，`EXPLAIN FORMAT=TREE` 输出里的每个节点就是一个迭代器。上层迭代器向下层要一行、判断条件、再要下一行，最底层的迭代器向引擎取数据，直到取完

### 查询和更新的区别

查询只读数据：页不在 Buffer Pool 就从磁盘读进来，结果返回给客户端，不产生日志。更新要保证能回滚、崩溃后不丢，流程长得多：

```text
UPDATE t SET c = c + 1 WHERE id = 2;

1. 执行器让 InnoDB 取 id = 2 这一行（当前读，加行锁），页不在 Buffer Pool 就先从磁盘读入
2. 执行器算出新值，调用引擎接口写回这一行
3. InnoDB 写 undo log，记下旧值，用于回滚和 MVCC
4. InnoDB 修改 Buffer Pool 里的数据页，这一页成了脏页
5. InnoDB 把这次页修改记到 redo log buffer
6. Server 层把这次修改记到当前线程的 binlog cache
7. 提交：redo log prepare → 写 binlog → redo log commit，返回客户端
8. 脏页之后由后台线程刷回磁盘
```

提交时落盘的是顺序写的 redo log 和 binlog，不是随机写的数据页，这就是 WAL。三种日志的分工和第 7 步两阶段提交的细节见 [redo log、undo log 和 binlog](/basics/mysql/09-logs)，redo log 的刷盘策略见 [ACID 是怎么实现的](/basics/mysql/04-transaction-acid)。

### Buffer Pool 和改进的 LRU

Buffer Pool 是 InnoDB 在内存里缓存数据页和索引页的区域，以页（默认 16KB）为单位管理，`innodb_buffer_pool_size` 默认 128MB。读写都先在这里进行，命中就不用访问磁盘。官方文档提到，专用的数据库服务器上常把多达 80% 的物理内存分给它。

内存满了要淘汰页，普通 LRU 有两个问题：

- **预读失效**：InnoDB 会预读相邻的页，如果这些页最后没用上，却排在了链表头部，会挤掉真正的热点页
- **扫描污染**：一次全表扫描或 mysqldump 读入大量只用一次的页，把热点页全部挤出去

InnoDB 把 LRU 链表分成两段：

```text
头部 ← young 区（约 5/8，热数据） | old 区（约 3/8） → 尾部（从这里淘汰）
                                  ↑
                         新读入的页插在 old 区头部（midpoint）
```

- old 区的比例由 `innodb_old_blocks_pct` 控制，默认 37，约 3/8
- 新页先进 old 区。页第一次被访问后的 `innodb_old_blocks_time`（默认 1000 毫秒）内再被访问，不会移到 young 区；超过这个时间还被访问，才移到 young 区头部
- 全表扫描的页通常在很短时间内被连续访问几次，之后再也不用，就一直留在 old 区，很快被淘汰，热点页不受影响

### 脏页什么时候刷盘

刷脏页由后台的 page cleaner 线程负责，主要有这几种时机：

1. **平时持续地刷**：自适应刷新根据 redo log 的生成速度和当前的刷盘速度调整节奏。脏页比例超过 `innodb_max_dirty_pages_pct_lwm`（默认 10%）就开始预刷，达到 `innodb_max_dirty_pages_pct`（默认 90%）时会激进地刷
2. **redo log 快写满**：redo log 循环使用，要覆盖的那部分对应的脏页必须先刷盘、推进 checkpoint。使用率到 75% 开始异步刷，写满时必须立即刷盘腾出空间，写入会明显卡顿
3. **Buffer Pool 没有空闲页**：要从 LRU 尾部淘汰页，淘汰的是脏页就得先刷盘。page cleaner 每秒会扫描 LRU 尾部提前刷一批，用户线程因为没有空闲页而等待的次数记在 `Innodb_buffer_pool_wait_free`
4. **空闲和正常关闭**：系统空闲时后台也会刷。正常关闭时（`innodb_fast_shutdown` 为默认的 1 或 0），page cleaner 会把所有脏页写回磁盘再退出；设成 2 时只把 redo log 刷盘，相当于模拟一次崩溃，下次启动要做崩溃恢复

后台刷盘的速度以 `innodb_io_capacity` 为基准，MySQL 8.0 默认 200，8.4 改成了 10000。用 SSD 却还是 200 的话，脏页刷不过来，容易出现第 2 种情况，表现为写入时快时慢。

## 代码示例

```sql
-- Buffer Pool 命中率：1 - 从磁盘读的次数 / 逻辑读请求次数
SELECT 1 - disk.v / req.v AS hit_rate
FROM (SELECT VARIABLE_VALUE AS v FROM performance_schema.global_status
      WHERE VARIABLE_NAME = 'Innodb_buffer_pool_reads') AS disk,
     (SELECT VARIABLE_VALUE AS v FROM performance_schema.global_status
      WHERE VARIABLE_NAME = 'Innodb_buffer_pool_read_requests') AS req;

-- 脏页数和总页数
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_pages_%';
```

命中率是启动以来的累计值，看趋势比看单个数字更有用。线上命中率明显下降，通常说明热数据已经放不下，或者有大查询在扫描冷数据。

## 面试官可能追问

::: details 数据页还没刷盘 MySQL 就崩溃了，数据会丢吗？
不会丢已提交的事务。提交时 redo log 已经落盘（`innodb_flush_log_at_trx_commit = 1` 时），重启后 InnoDB 从 checkpoint 开始重放 redo log，把还没刷盘的修改恢复出来；没提交的事务用 undo log 回滚。所以数据页可以慢慢刷，不用在提交时写，详细过程见 [ACID 是怎么实现的](/basics/mysql/04-transaction-acid)。
:::

::: details 执行器和存储引擎是怎么配合的？WHERE 条件由谁判断？
执行器通过 handler 接口一行一行地向引擎要数据，引擎按执行计划选定的索引定位、返回记录，执行器判断 WHERE 中剩下的条件，满足的放进结果集。索引下推（ICP）会把一部分条件交给引擎，在回表前过滤（见 [索引下推](/basics/mysql/02-clustered-index)）。慢查询日志里的 `Rows_examined` 大致就是执行器从引擎读了多少行，它远大于 `Rows_sent` 说明扫描了很多无用的行。
:::

::: details 更新的数据页不在 Buffer Pool 里，一定要先从磁盘读进来吗？
聚簇索引页一定要读进来，因为要加锁、判断条件。对非唯一二级索引，InnoDB 可以先把修改记到 change buffer，等这个页以后被读入时再合并，省掉一次随机读；唯一索引要检查唯一性，必须读页，用不上 change buffer。MySQL 8.4 把 `innodb_change_buffering` 的默认值从 `all` 改成了 `none`，默认不再缓冲。
:::

::: details MySQL 8.0 为什么去掉查询缓存？
查询缓存以 SQL 文本为键缓存结果，表上任何一次写入都会让这张表相关的缓存全部失效，写多的业务里命中率很低；整个缓存由一把全局的锁保护，多核、高并发时反而成了瓶颈。所以它从 5.6 起默认关闭，5.7.20 标为弃用，8.0 直接移除。官方建议把缓存放到离应用更近的地方，比如应用层的 Redis 或 ProxySQL 这类代理，能自己决定粒度和过期策略。
:::

## 易错点

- 查询缓存在 MySQL 8.0 中已经移除，回答执行流程时不要再说"先查缓存"
- binlog 是 Server 层写的，redo log 和 undo log 属于 InnoDB，不要混在一起
- 提交成功不代表数据页已经写到磁盘，提交时刷的是 redo log
- 新读入的页先放在 old 区头部，而不是整个 LRU 链表的头部
