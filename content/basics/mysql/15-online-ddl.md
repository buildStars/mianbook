---
difficulty: 3
tags: [高频, 实践, 场景题]
---

# 大表怎么加字段、加索引？Online DDL 是怎么回事？

::: tip 一句话回答
DDL 最大的风险往往不是执行慢，而是**元数据锁（MDL）**：DDL 执行过程中（尤其是最后提交新表定义时）要短暂拿排他 MDL，如果前面有长事务占着这张表的 MDL，DDL 就要排队，而排队中的排他锁会**挡住之后所有的读写**，业务瞬间大面积卡住。MySQL 的 Online DDL 用 `ALGORITHM` 选执行方式：**INSTANT** 只改元数据（8.0.12 起支持加列），**INPLACE** 在引擎内部重建或建索引、执行期间允许读写，**COPY** 拷贝整张表、期间阻塞写入；`LOCK` 控制允许的并发程度。只能 COPY 的操作或者需要限流的超大表，用 **gh-ost**、**pt-online-schema-change**：建影子表、同步增量、最后原子切换。上线前先查长事务、设置较短的 `lock_wait_timeout`、在低峰执行。
:::

## 详细解析

### DDL 为什么危险：MDL 排队

所有访问表的语句都要先拿这张表的 MDL：读写拿共享 MDL，互相兼容；DDL 要排他 MDL。事务里拿到的 MDL 要到**事务结束**才释放，不是语句结束。

```text
会话 1：BEGIN; SELECT * FROM t LIMIT 1;    -- 拿到共享 MDL，事务一直没提交
会话 2：ALTER TABLE t ADD COLUMN c INT;     -- 要排他 MDL，等待会话 1
会话 3：SELECT * FROM t WHERE id = 1;       -- 排在会话 2 后面，也被阻塞
会话 4、5、6……                               -- 全部堆积，连接池很快被占满
```

排他锁请求的优先级高于共享锁，所以会话 3 即使和会话 1 并不冲突，也要排在等待中的 DDL 后面。`SHOW PROCESSLIST` 里会看到大量 `Waiting for table metadata lock`。`lock_wait_timeout` 控制等 MDL 的超时时间，默认是 31536000 秒（一年），等于无限等待。它和行锁的超时 `innodb_lock_wait_timeout`（默认 50 秒）是两回事。表级、行级锁的其他内容见 [InnoDB 有哪些锁](/basics/mysql/07-locks)。

### Online DDL 的 ALGORITHM 和 LOCK

| ALGORITHM | 做法 | 执行期间的读写 | 典型操作 |
| --- | --- | --- | --- |
| INSTANT | 只改数据字典里的元数据，不动数据 | 瞬间完成，只需短暂的排他 MDL | 加列、删列、改列名、设置默认值 |
| INPLACE | 在 InnoDB 内部完成，有的要重建表，有的只建索引 | 大多允许并发读写 | 加二级索引、加主键、扩展 VARCHAR |
| COPY | 建新表，逐行拷贝，再替换原表 | 允许读，阻塞写 | 修改列的数据类型、删除主键 |

`LOCK` 可以是 `NONE`（允许读写）、`SHARED`（只允许读）、`EXCLUSIVE`（读写都阻塞），不写就是 `DEFAULT`，尽量给出最大的并发。显式写上 `ALGORITHM` 和 `LOCK` 的好处是：操作不支持指定的方式时直接报错，不会悄悄退化成锁表的方式。

INPLACE 不等于全程无锁：初始化时拿可升级的共享 MDL；准备执行时可能短暂升级成排他 MDL；执行期间允许读写；最后提交新表定义时再升级成排他 MDL。所以上面 MDL 排队的问题同样存在。执行期间别人的修改记在临时的 online log 里，最后回放；修改太多超过 `innodb_online_alter_log_max_size`（默认 128MB）时 DDL 失败。

### MySQL 8.0 常见操作的支持情况

| 操作 | 方式 | 说明 |
| --- | --- | --- |
| 加列 | INSTANT | 8.0.12 起支持并且是默认方式，但只能加在最后；8.0.29 起可以加在任意位置 |
| 删列 | INSTANT（8.0.29 起） | 之前是 INPLACE，要重建表 |
| 改列名 | INSTANT（8.0.28 起） | 被其他表的外键引用时只能 INPLACE |
| 设置、删除默认值 | INSTANT | 只改元数据 |
| 加二级索引 | INPLACE | 不重建表，允许并发读写，大表上耗时长 |
| 删除索引、改索引名 | INPLACE | 只改元数据 |
| 扩展 VARCHAR 长度 | INPLACE 或 COPY | 存长度的字节数不变才能 INPLACE：改前改后都在 255 字节以内，或者本来就在 256 字节以上 |
| 修改列的数据类型 | COPY | 阻塞写入，大表必须用工具 |
| 加主键 | INPLACE | 重建整张表，代价很高 |

INSTANT 加列、删列有限制：每张表最多累积 64 个行版本，用完后只能用 INPLACE 或 COPY，重建表（如 `OPTIMIZE TABLE`）后清零；不能和不支持 INSTANT 的操作写在同一条 ALTER 里；压缩表、带全文索引的表不支持。VARCHAR 的长度按字节算：utf8mb4 下 `VARCHAR(63)` 最多 252 字节，改成 `VARCHAR(64)` 就跨过了 255 字节，只能 COPY。

### gh-ost 和 pt-online-schema-change

两个工具的思路一样：不在原表上直接改，而是做一张新结构的影子表，追平数据后再换过来。

```text
1. 按新结构建影子表
2. 按主键（或唯一键）分批把原表的存量数据拷进影子表
3. 同步拷贝期间原表的增量修改
4. 追平后短暂加锁，用原子的 RENAME 交换两张表，旧表留作备份或删除
```

| | pt-online-schema-change | gh-ost |
| --- | --- | --- |
| 增量同步 | 在原表上建 INSERT、UPDATE、DELETE 触发器，同步写到新表 | 不用触发器，像从库一样读 ROW 格式的 binlog，异步应用到影子表 |
| 对主库写入的影响 | 触发器和业务写在同一个事务里执行，写入变慢 | 拷贝和应用增量都可以随时限流、暂停 |
| 限制 | 原表已有触发器、有外键时都要额外处理 | 不支持外键和触发器 |
| 共同要求 | 表要有主键或唯一键，磁盘要能再放下一份表 | 同左 |

两者都能按负载和从库延迟限流，默认值不同：pt-osc 默认在 `Threads_running` 超过 25 或从库延迟超过 1 秒时暂停拷贝（触发器照常执行）；gh-ost 默认只按从库延迟（1.5 秒）限流，`Threads_running` 这类阈值要用 `--max-load` 自己配置。gh-ost 还能把切换推迟到人工确认，可以先在从库上完整演练一遍。

### 上线操作规范

1. 先确认操作的执行方式：查官方文档或在测试环境执行，显式写上 `ALGORITHM` 和 `LOCK`
2. 选业务低峰执行，确认磁盘空间足够（重建表需要再放下一份表）
3. 执行前查有没有长事务、长查询占着这张表
4. 在执行 DDL 的会话里把 `lock_wait_timeout` 设成几秒，拿不到 MDL 就快速失败、稍后重试，而不是一直排队堵住业务
5. 关注从库：DDL 要在主库执行完才会在从库开始，大表的 INPLACE 操作会让从库延迟和 DDL 的耗时相当
6. 灰度：分库分表的场景先改一个分片，观察没问题再批量执行

## 代码示例

```sql
-- 1. 查运行超过 60 秒的事务
SELECT trx_mysql_thread_id, trx_started, trx_query
FROM information_schema.innodb_trx
WHERE trx_started < NOW() - INTERVAL 60 SECOND;

-- 2. 拿不到元数据锁就在 5 秒后报错，不要无限期排队
SET SESSION lock_wait_timeout = 5;

-- 3. 显式指定方式，不支持时直接报错
ALTER TABLE orders ADD COLUMN remark VARCHAR(255) NULL, ALGORITHM = INSTANT;
ALTER TABLE orders ADD INDEX idx_user_time (user_id, create_time), ALGORITHM = INPLACE, LOCK = NONE;

-- 4. DDL 卡住时，看谁在等、谁挡住了它
SELECT waiting_pid, waiting_query, blocking_pid, blocking_lock_type
FROM sys.schema_table_lock_waits;
```

## 面试官可能追问

::: details INSTANT 加列为什么能瞬间完成？
它只在数据字典里记下新列的定义和默认值，已有的行在物理上并没有这一列。读取旧行时，InnoDB 根据行记录里的信息知道它是加列之前写入的，缺的列直接用元数据里的默认值补上；之后新插入或更新的行才按新格式存储。代价是要维护行版本：每条 INSTANT 加列、删列的 ALTER 语句都会让版本数加 1（一条语句加多列也只算一次），每张表最多 64 个，可以在 `information_schema.INNODB_TABLES` 的 `TOTAL_ROW_VERSIONS` 列查看。
:::

::: details 线上加字段已经把业务堵住了，怎么办？
先 KILL 掉正在等待的 DDL 会话，排队的排他锁一撤，后面堆积的读写马上就能继续执行，这是最快的止血办法。再用 `sys.schema_table_lock_waits` 或 `information_schema.innodb_trx` 找出占着 MDL 的长事务，确认是否可以结束它。最后按上面的规范设置 `lock_wait_timeout`，择机重试。
:::

::: details 都有 Online DDL 了，为什么还要用 gh-ost？
Online DDL 没法暂停，也没法限制它的 I/O 和 CPU，大表执行时可能拖慢线上业务；执行期间的修改太多会超出 online log 的上限而失败，前面花的时间全部白费；它在从库上要等主库执行完才开始，并且从库在执行 DDL 期间，后面的修改都要等它完成才回放，延迟会和 DDL 的耗时一样长。修改列类型这类只能 COPY 的操作还会阻塞写入。gh-ost 可以限流、暂停、控制切换时机，代价是多占一份磁盘，整体耗时更长。
:::

## 易错点

- INSTANT 和 INPLACE 都不是完全无锁，执行中都要短暂拿排他 MDL，长事务同样会让它们排队、堵住业务
- `lock_wait_timeout` 管元数据锁，`innodb_lock_wait_timeout` 管行锁，前者默认一年
- VARCHAR 扩展能否 INPLACE 按字节算，utf8mb4 下每个字符按 4 字节计
- gh-ost、pt-osc 最后切换表时也要拿 MDL，同样要避开长事务
