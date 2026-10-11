---
difficulty: 3
tags: [高频, 场景题, 性能优化]
---

# Redis 突然变慢了，怎么排查？

::: tip 一句话回答
先分清是**网络和客户端**慢还是 **Redis 本身**慢：在 Redis 机器上用 `redis-cli --intrinsic-latency` 测出系统的固有延迟，在应用机器上用 `redis-cli --latency` 测往返延迟，再和应用看到的耗时对比。确认是 Redis 慢，就用 **SLOWLOG** 找慢命令和大 Key，打开**延迟监控**后用 `LATENCY DOCTOR` 看是哪类事件拖慢了主线程。常见原因有：O(N) 命令和大 Key、持久化时的 **fork**、**AOF 刷盘**被磁盘拖住、内存到上限后的**淘汰**、**swap**、**大量 key 同时过期**、**内存碎片**和透明大页。排查时把现象和 `INFO` 里的指标对上，就能定位到具体原因。
:::

## 详细解析

### 第一步：确认慢在哪一段

- **客户端**：连接池耗尽、Node.js 事件循环被阻塞、频繁新建连接，都会让应用看到的耗时变长，但 Redis 本身并不慢
- **网络**：在应用机器上执行 `redis-cli --latency -h <host>`，它每秒发 100 次 PING 并统计最小、最大、平均延迟（毫秒）；`--latency-history` 每 15 秒输出一组，适合观察抖动的时间规律
- **机器本身**：在 Redis 所在机器上执行 `redis-cli --intrinsic-latency 100`，它不连接 Redis，只测 100 秒内进程最长有多久拿不到 CPU。虚拟机上被其他租户抢占时，这个值可能就有几毫秒，Redis 的延迟不可能比它更低
- **Redis 整体负载**：`INFO stats` 的 `instantaneous_ops_per_sec` 看请求量是否突增，`top` 看 redis-server 主线程是否接近 100% CPU；7.0 起 `INFO latencystats` 直接给出每种命令的 p50、p99、p999 延迟

### 第二步：用 Redis 自带的工具

**慢日志**：`SLOWLOG GET 10` 返回最近的慢命令，包括执行耗时（微秒）、命令参数（参数太多、太长时会截断）、客户端地址。超过 `slowlog-log-slower-than`（默认 10000 微秒，即 10 毫秒）的命令才会记录，最多保留 `slowlog-max-len` 条（默认 128）。它只统计**命令本身的执行时间**，不含网络传输和排队：一个请求排在慢命令后面等了 200 毫秒，它自己并不会出现在慢日志里。

**延迟监控**：默认关闭，`CONFIG SET latency-monitor-threshold 100` 后，主线程里超过 100 毫秒的事件会按类型记录下来：`command`（慢命令）、`fork`、`aof-write`、`aof-fsync-always`、`expire-cycle`（过期清理）、`eviction-cycle`（淘汰）、`active-defrag-cycle`（碎片整理）等。`LATENCY LATEST` 看各事件最近一次和历史最大的耗时，`LATENCY HISTORY fork` 看某个事件的时间序列，`LATENCY DOCTOR` 直接输出分析报告和建议。

### 常见原因

1. **慢命令和大 Key**：`KEYS *`、对大集合 `HGETALL`、`SMEMBERS`、`LRANGE 0 -1`，或者 `DEL` 一个几百万元素的集合，都会独占主线程，原因和对策见 [Redis 为什么快](/basics/redis/02-why-fast) 和 [大 Key 和热 Key](/basics/redis/09-big-hot-key)
2. **fork**：BGSAVE、AOF 重写、主从全量同步都要 fork，fork 要复制页表，在主线程里同步执行。官方文档的例子：24GB 的实例页表约 48MB，在一些老的 Xen 虚拟机上 fork 能慢到秒级。`INFO stats` 的 `latest_fork_usec` 是上次 fork 的耗时（微秒），见 [RDB 和 AOF](/basics/redis/04-persistence)
3. **透明大页**：fork 之后写时复制的单位从 4KB 变成 2MB，写入稍多就要复制大量内存，延迟和内存一起上涨。官方要求关闭（`echo never > /sys/kernel/mm/transparent_hugepage/enabled`）；6.2 起 `disable-thp` 默认开启，内核设置为 always 时 Redis 会为自己的进程关闭它
4. **AOF 刷盘**：`appendfsync always` 每次写都 fsync，磁盘慢就直接拖慢写命令；`everysec` 由后台线程 fsync，如果上一次 fsync 还没完成，主线程会先推迟写 AOF，推迟超过 2 秒就强行写入，这次写入可能被正在进行的 fsync 卡住，日志里会出现 "Asynchronous AOF fsync is taking too long"，`INFO persistence` 的 `aof_delayed_fsync` 会增加。和其他高 I/O 的进程混部、AOF 重写期间最容易发生，可以考虑 `no-appendfsync-on-rewrite yes`，代价是重写期间的数据安全性降低
5. **内存到达 maxmemory**：超过上限后，Redis 处理每条命令前都要先淘汰 key 腾出空间，淘汰在主线程里做，写入量大或者淘汰的是大 Key 时延迟明显上升，表现为 `evicted_keys` 持续增长、`eviction-cycle` 事件变多。可以开 `lazyfree-lazy-eviction` 让释放内存在后台进行，根本办法是扩容或减少数据，见 [过期删除和内存淘汰](/basics/redis/05-expire-eviction)
6. **swap**：Redis 的内存页被换到磁盘后，访问这些数据要等磁盘读回来。`INFO memory` 里 `used_memory_rss` 明显小于 `used_memory` 就要警惕，再看进程的 swap 用量和 `vmstat` 的 si、so 列确认；对策是给机器留足内存、不和吃内存的进程混部
7. **大量 key 同时过期**：主动过期在主线程执行，每轮有时间上限（默认 hz 10 时每轮最多约 25 毫秒），但只要抽到的 key 里过期的超过约 10%（6.0 之前是 25%）就继续抽下一批，直到时间用完。同一时刻过期的 key 太多时，延迟会周期性升高；过期的是大 Key 还会卡在释放内存上。给过期时间加随机值打散，并开启 `lazyfree-lazy-expire`
8. **内存碎片**：`mem_fragmentation_ratio` 是 RSS 和 `used_memory` 的比值，明显大于 1（比如 1.5 以上）且碎片字节数很大时说明碎片多，`allocator_frag_ratio` 才是更准确的碎片指标。可以 `CONFIG SET activedefrag yes` 在线整理（需要 Redis 自带的 jemalloc），整理本身也占 CPU，要观察 `active-defrag-cycle` 事件

### 按现象定位

| 现象 | 可能原因 | 怎么确认 |
| --- | --- | --- |
| 部分请求很慢，CPU 高 | 慢命令、大 Key | `SLOWLOG GET`、`redis-cli --bigkeys`、`INFO commandstats` |
| 周期性卡顿，和 BGSAVE 或 AOF 重写的时间吻合 | fork、透明大页 | `latest_fork_usec`、`LATENCY HISTORY fork`、THP 是否开启 |
| 写入量大时变慢，磁盘繁忙 | AOF fsync | `aof_delayed_fsync`、Redis 日志、`iostat` |
| 内存打满后写入变慢 | 淘汰 | `evicted_keys` 持续增长、`eviction-cycle` 事件 |
| 整点或固定时刻抖动 | 集中过期 | `expired_keys` 突增、`expire-cycle` 事件 |
| 偶发长时间卡顿，RSS 小于数据量 | swap | `used_memory_rss` 小于 `used_memory`、进程的 VmSwap |
| RSS 远大于数据量 | 内存碎片 | `mem_fragmentation_ratio`、`allocator_frag_ratio` |
| 只有某个应用慢，Redis 各项指标正常 | 网络或客户端 | 在不同机器上 `--latency` 对比，查连接池和事件循环 |

## 代码示例

```bash
# 1. 在 Redis 所在机器上测固有延迟，跑 100 秒，会占满一个 CPU 核
redis-cli --intrinsic-latency 100
# 2. 在应用机器上测到 Redis 的往返延迟，每 15 秒输出一组 min/max/avg
redis-cli -h 10.0.0.5 -p 6379 --latency-history
# 3. 最近 10 条慢命令
redis-cli SLOWLOG GET 10
# 4. 打开延迟监控（只记录超过 100 毫秒的事件），稍后查看诊断报告
redis-cli CONFIG SET latency-monitor-threshold 100
redis-cli LATENCY LATEST
redis-cli LATENCY DOCTOR
# 5. 关键指标
redis-cli INFO stats | grep -E 'latest_fork_usec|expired_keys|evicted_keys|instantaneous_ops_per_sec'
redis-cli INFO memory | grep -E 'used_memory_human|used_memory_rss_human|mem_fragmentation_ratio|allocator_frag_ratio'
redis-cli INFO persistence | grep -E 'aof_delayed_fsync|rdb_bgsave_in_progress|aof_rewrite_in_progress'
# 6. Redis 进程用了多少 swap（INFO 的每一行以 \r\n 结尾，要去掉 \r）
pid=$(redis-cli INFO server | grep '^process_id:' | cut -d: -f2 | tr -d '\r')
grep VmSwap /proc/$pid/status
```

## 面试官可能追问

::: details 慢日志里没有慢命令，客户端却经常超时，可能是什么原因？
慢日志只记录命令本身的执行时间。fork、AOF 写盘、过期清理、淘汰这些不属于某条命令的阻塞不会出现在里面，排在慢操作后面等待的请求也不会被记录。要用延迟监控看这些事件，同时排查网络（丢包、带宽被大 value 占满）、客户端连接池和 swap。还要注意慢日志默认只保留 128 条，高峰过去后可能已经被覆盖。
:::

::: details 怎么提前发现，而不是等用户反馈？
在客户端统计 Redis 调用的 p99 延迟和超时数，这是最贴近用户感受的指标；服务端监控慢日志条数、`latest_fork_usec`、`evicted_keys`、`expired_keys` 的增速、内存使用率、碎片率、`aof_delayed_fsync`，并对内存使用率设置告警。延迟监控可以常开，设置一个业务能接受的阈值，出问题时就有现场数据。
:::

::: details 开启多线程 I/O 能解决变慢吗？
只能解决一部分。`io-threads` 分担的是网络读写和协议解析，适合连接多、请求小、主线程 CPU 被网络 I/O 吃满的情况。慢命令、fork、AOF 刷盘、淘汰、过期清理都还在主线程里，开多少 I/O 线程都没用，细节见 [Redis 为什么快](/basics/redis/02-why-fast)。
:::

## 易错点

- `--intrinsic-latency` 必须在 Redis 服务器上运行，在客户端机器上测的是客户端机器自己
- 慢日志的阈值单位是微秒，记录的只是执行时间，不含排队和网络
- `mem_fragmentation_ratio` 小于 1 不代表没有碎片，而是可能有内存被换到了 swap
- 延迟监控默认关闭，等出了问题再打开就拿不到当时的数据，最好平时就开着
