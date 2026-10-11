---
difficulty: 3
tags: [高频, 原理, 场景题]
---

# MySQL 主从复制的原理是什么？主从延迟怎么处理？

::: tip 一句话回答
主库提交事务时写 **binlog**；从库的 **I/O 线程**连上主库，由主库的 binlog dump 线程把 binlog 发过来，写进本地的 **relay log**；从库的 **SQL 线程**（多线程复制时是协调线程加多个 worker）读 relay log 回放。默认是**异步复制**，**半同步**要等至少一个从库确认收到才算提交；**GTID** 给每个事务一个全局唯一 ID，切换主库时不用再找 binlog 位点。延迟常见的原因是**大事务**、**从库回放能力不足**和**从库负载高**；读写分离时，关键读走主库、写后短时间读主库，或者让从库**等到对应的 GTID** 再读。
:::

## 详细解析

### 复制的流程

```text
主库：事务提交 → 写 binlog → binlog dump 线程
                                   │ 网络
                                   ▼
从库：I/O 线程（receiver）→ 写入 relay log
        → SQL 线程（applier）读 relay log 回放，写入从库数据
          多线程复制时：coordinator 线程按依赖关系分发给 worker 1..N 并行回放
```

1. 主库提交事务时写 binlog，提交过程见 [两阶段提交](/basics/mysql/09-logs)
2. 从库执行 `START REPLICA` 后，I/O 线程连接主库，主库为它启动一个 binlog dump 线程，把 binlog 事件发送过来
3. I/O 线程把收到的事件写进 relay log
4. SQL 线程读 relay log 并回放。MySQL 8.0.27 起 `replica_parallel_workers` 默认是 4，从库默认就是多线程回放

MySQL 8.0.22 起，`START SLAVE`、`SHOW SLAVE STATUS` 这类语句改名为 `START REPLICA`、`SHOW REPLICA STATUS`，输出里的延迟字段也从 `Seconds_Behind_Master` 改叫 `Seconds_Behind_Source`；MySQL 8.4 已经不再支持旧语句。

复制用的 binlog 格式默认是 ROW，记录每一行修改前后的值，从库回放的结果是确定的；STATEMENT 格式下 `UUID()` 这类结果不确定的语句会让主从不一致，三种格式的对比见 [binlog 的格式](/basics/mysql/09-logs)。MySQL 8.0.34 起 `binlog_format` 变量已标为弃用，方向是只保留 ROW，新搭建的复制都应该用 ROW。

### 异步、半同步和 GTID

| 方式 | 主库提交时等什么 | 主库宕机时 |
| --- | --- | --- |
| 异步（默认） | 不等从库 | 切到从库后，已提交但还没传过去的事务会丢失 |
| 半同步 | 至少一个从库确认已收到并写入 relay log（数量可配置，默认 1） | 默认的 `AFTER_SYNC` 模式下，已提交的事务至少在一个从库的 relay log 里 |
| 组复制（MGR） | 事务要在组内多数成员间达成一致 | 可以自动选出新主库，部署和限制更多 |

半同步等待超时（`rpl_semi_sync_source_timeout`，默认 10 秒）后会**自动退化为异步**，有从库追上后再恢复，所以它保证的是"尽量不丢"，不是绝对不丢。

**GTID**（全局事务 ID）的格式是 `源服务器 UUID:事务序号`，比如 `3E11FA47-71CA-11E1-9E33-C80AA9429562:23`。开启 `gtid_mode = ON` 和 `enforce_gtid_consistency = ON` 后，每个从库都记录自己执行过哪些 GTID，主从切换时，从库连上新主库用 `SOURCE_AUTO_POSITION = 1` 自动协商从哪里继续，不用人工去找 binlog 文件名和位点。

### 延迟的原因和处理

| 原因 | 说明 | 处理 |
| --- | --- | --- |
| 大事务 | 事务提交后才写 binlog，假设主库上一个删除执行了 10 分钟，从库收到后还要再执行差不多 10 分钟 | 大批量操作拆成小批次；大表 DDL 用 gh-ost 这类工具（见 [Online DDL](/basics/mysql/15-online-ddl)） |
| 回放能力不足 | 主库多线程并发写，从库回放的并行度跟不上 | 开启并行复制，调大 `replica_parallel_workers` |
| 表没有主键 | ROW 格式下从库要先找到被修改的行，没有主键和合适的索引时可能要扫描整张表 | 每张表都要有主键 |
| 从库负载高 | 从库上跑报表等大查询，或者机器配置比主库差 | 报表放专门的从库；从库配置不低于主库 |
| 网络 | 跨机房传输慢 | 同机房部署从库 |

监控延迟看 `SHOW REPLICA STATUS` 的 `Seconds_Behind_Source`：它是从库当前时间减去正在回放的事件在主库上的时间戳。SQL 线程没运行时它是 `NULL`；它只反映 relay log 已收到部分的回放进度，网络慢时 I/O 线程落后，它却可能显示 0。更准确的做法是用 pt-heartbeat 这类心跳表：主库定时写入当前时间，从库读出来和自己的时间比较。MySQL 8.0 的 `performance_schema.replication_applier_status_by_worker` 还记录了每个 worker 最近回放的事务在源库的提交时间和在从库回放完成的时间，两者相减就是这个事务实际的延迟。

### 读写分离读到旧数据怎么办

1. **关键读走主库**：支付结果、库存这类必须最新的读，直接查主库
2. **写后一段时间读主库**：用户写完后的几秒内，他的读请求都路由到主库，比如在会话或缓存里记一个时间戳，时长参考监控到的延迟
3. **等待 GTID**：写完拿到事务的 GTID，读之前在从库执行 `WAIT_FOR_EXECUTED_GTID_SET(gtid, timeout)`，返回 0 说明已经回放，返回 1 说明超时，超时就改读主库
4. **剔除延迟大的从库**：中间件或代理定期检查延迟，超过阈值的从库暂时不分配读请求

## 代码示例

方案 3 的实现（Node.js + mysql2，主从都要开启 GTID）：

```js
// 在主库执行写事务，返回这个事务的 GTID
async function writeOnPrimary(primary, sql, params) {
  const conn = await primary.getConnection()
  try {
    await conn.query("SET SESSION session_track_gtids = 'OWN_GTID'")
    await conn.beginTransaction()
    await conn.query(sql, params)
    const [ok] = await conn.query('COMMIT') // 服务端在 COMMIT 的 OK 包里带回 GTID
    // stateChanges 是 mysql2 对 OK 包里会话跟踪信息的解析结果，源码里有，文档和类型定义里没写
    // 取不到时返回 null，后面的读请求直接走主库
    return ok.stateChanges?.gtids?.[0] || null
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

// 写后读：让从库最多等 1 秒，等不到或出错就读主库
async function readAfterWrite(primary, replica, gtid, sql, params) {
  if (gtid) {
    let conn
    try {
      conn = await replica.getConnection()
      const [[{ r }]] = await conn.query('SELECT WAIT_FOR_EXECUTED_GTID_SET(?, 1) AS r', [gtid])
      if (r === 0) {
        const [rows] = await conn.query(sql, params)
        return rows
      }
    } catch {
      // 从库连不上、没开 GTID 等情况，降级读主库
    } finally {
      conn?.release()
    }
  }
  const [rows] = await primary.query(sql, params)
  return rows
}
```

跨请求使用时，把 GTID 放进用户会话，后续请求带着它去从库读。等待会占用从库连接，超时时间要设得短。驱动拿不到 OK 包里的 GTID 时，也可以在提交后查主库的 `@@GLOBAL.gtid_executed`，让从库等这整个集合，会多等一些，但同样能读到自己的写入。

## 面试官可能追问

::: details 半同步的 AFTER_SYNC 和 AFTER_COMMIT 有什么区别？
`AFTER_SYNC`（默认）是主库写完并刷盘 binlog 后、在存储引擎提交之前等从库确认；`AFTER_COMMIT` 是引擎提交之后才等。`AFTER_COMMIT` 下，事务在主库已经提交，别的客户端已经能读到，如果这时主库宕机、从库又没收到，切换后这条已经被看到的数据就没了。`AFTER_SYNC` 保证所有客户端看到的已提交事务都已经到了至少一个从库，切换时不丢数据，前提是半同步没有因为超时退化成异步。
:::

::: details 并行复制怎么判断哪些事务可以并行回放？
`LOGICAL_CLOCK` 方式下，主库在 binlog 里给每个事务记录依赖信息（`last_committed` 和 `sequence_number`），从库据此判断：互相没有依赖的事务可以交给不同的 worker 同时执行。依赖有两种算法：COMMIT_ORDER 看提交时间，两个事务在主库上的提交阶段有重叠，说明它们当时没有锁冲突，从库也能并行；WRITESET 比较事务改过的行（主键、唯一键的哈希），没改同一行就能并行，即使主库上是先后提交的，并行度更高。MySQL 8.4 起，使用多线程从库时主库总是用 WRITESET 生成依赖信息，效果和以前把 `binlog_transaction_dependency_tracking` 设成 WRITESET 一样：没有主键或唯一键的表、外键父表上的修改这类算不出完整写集合的事务，仍按提交时间处理。`replica_preserve_commit_order` 默认开启，保证从库上的提交顺序和主库一致。
:::

::: details 主库宕机了怎么切换？
选一个数据最新的从库提升为主库：比较各从库已执行的 GTID 集合，选最全的；如果有从库收到了更多 relay log，先让它回放完。新主库关闭只读，其他从库用 `SOURCE_AUTO_POSITION = 1` 指向新主库，GTID 会自动补齐差的事务。应用的连接地址通过 VIP、DNS 或代理切换。这个过程可以交给 MHA、Orchestrator 这类工具，或者直接用 MGR、InnoDB Cluster 做自动切换。从库平时要开 `super_read_only`，防止被误写。
:::

## 易错点

- 半同步只保证从库**收到**了 binlog，不保证已经回放，读从库仍然可能读到旧数据
- `Seconds_Behind_Source` 为 0 不代表没有延迟，为 `NULL` 往往是复制线程停了，都要结合线程状态一起看
- binlog 是主库写的，relay log 是从库上的；从库能否把回放的事务再写进自己的 binlog（级联复制要用到）由 `log_replica_updates` 控制
- 并行复制对单个大事务没有帮助，大事务只能拆小
