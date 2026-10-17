---
difficulty: 3
tags: [原理]
---

# Page Cache 是什么？write 返回成功数据就落盘了吗？

::: tip 一句话回答
Page Cache 是内核用空闲内存缓存的文件数据，按页组织。**`write` 返回成功只说明数据拷进了 Page Cache**，对应的页被标成脏页，由内核后台线程稍后写回磁盘；这时断电或内核崩溃，数据就丢了。要确认落盘得调用 **`fsync`**（数据和元数据都刷，并让磁盘刷新自身缓存），只关心数据可以用 **`fdatasync`**。`O_DIRECT` 只是绕过 Page Cache，本身**不保证持久化**。数据库的 redo log、消息队列的刷盘策略，都是在"每次 fsync 的安全"和"批量刷盘的性能"之间选择。
:::

## 详细解析

### 读写路径

```text
读：read() → 查 Page Cache → 命中：直接拷贝给用户
                           → 未命中：从磁盘读到 Page Cache（顺带预读后面的页）→ 拷贝给用户
写：write() → 拷贝到 Page Cache，页标记为脏 → 返回成功
                    ↓ 稍后
            内核回写线程把脏页写到磁盘
```

所以同一个文件刚写完马上读，读到的是 Page Cache 里的新数据，不需要等落盘。`free` 输出里的 buff/cache 主要就是 Page Cache，内存紧张时干净页可以直接丢弃，脏页要先写回才能回收。它和 mmap、sendfile 的关系见[零拷贝](/basics/os/07-zero-copy)，页和缺页的机制见[虚拟内存](/basics/os/03-virtual-memory)。

### 脏页什么时候写回

| 触发条件 | 相关参数（默认值） |
| --- | --- |
| 脏页存在时间超过阈值 | `vm.dirty_expire_centisecs`（3000，即 30 秒） |
| 回写线程定期醒来检查 | `vm.dirty_writeback_centisecs`（500，即 5 秒） |
| 脏页占比超过后台阈值，开始后台回写 | `vm.dirty_background_ratio`（10） |
| 脏页占比超过上限，写进程被阻塞、自己参与回写 | `vm.dirty_ratio`（20） |
| 内存回收、`sync`/`fsync` 调用、卸载文件系统 | — |

比例按"可用于缓存的内存"计算。后台阈值保证平时平滑回写；写入速度长期超过磁盘速度时会撞到 `dirty_ratio`，这时 `write` 也会卡住，这是写入延迟突然变高的常见原因。

```bash
# Dirty 是当前脏页量，Writeback 是正在写回的量
grep -E 'Dirty|Writeback:' /proc/meminfo
sysctl vm.dirty_ratio vm.dirty_background_ratio
```

### fsync、fdatasync、O_DIRECT、O_SYNC

| 方式 | 作用 |
| --- | --- |
| `fsync(fd)` | 把该文件的脏数据和元数据（大小、修改时间等）写到设备，并要求设备刷新写缓存，返回后才算持久化 |
| `fdatasync(fd)` | 只保证数据和读回数据必需的元数据（比如文件变长后的大小），跳过修改时间这类元数据，少一次元数据写 |
| `O_SYNC` / `O_DSYNC` | 打开文件时指定，每次 `write` 都像紧跟了一次 `fsync` / `fdatasync` |
| `O_DIRECT` | 绕过 Page Cache，直接在用户缓冲区和设备之间传数据，对缓冲区地址和长度有对齐要求；数据可能还在磁盘自身的缓存里，要持久化仍需 `fsync` 或配合 `O_DSYNC` |
| `sync()` | 让系统把所有脏数据安排写回 |

还有两个容易漏的点：新建或重命名文件后，要对**所在目录**也做一次 `fsync`，目录项才持久化；`fsync` 返回错误后，内核可能已经把那些脏页标成干净的，再调一次 `fsync` 成功也不代表数据写进去了。PostgreSQL 因此改成遇到 `fsync` 失败直接崩溃、从日志恢复。

### 数据库和消息队列为什么关心刷盘

每次提交都 `fsync` 最安全，但一次 `fsync` 要等设备确认，写放大和延迟都高。所以各系统给出可选策略：

- **MySQL**：`innodb_flush_log_at_trx_commit=1` 每次提交都刷 redo log；设成 2 只写到 Page Cache，每秒刷一次，MySQL 进程崩溃不丢，操作系统崩溃或断电最多丢约 1 秒，见 [MySQL 的日志](/basics/mysql/09-logs)
- **Redis AOF**：`appendfsync always / everysec / no`，默认 everysec，见 [RDB 和 AOF](/basics/redis/04-persistence)
- **Kafka**：默认不主动 `fsync`，交给操作系统回写，可靠性主要靠多副本，见 [Kafka 为什么吞吐高](/basics/distributed/12-kafka-throughput)
- **组提交**：把多个事务的日志攒成一批，只做一次 `fsync`，兼顾安全和吞吐

### 丢数据的边界

| 故障 | 已 `write` 未 `fsync` | 已 `fsync` |
| --- | --- | --- |
| 进程崩溃、被 `kill -9` | 不丢，数据在 Page Cache 里，内核会写回 | 不丢 |
| 内核崩溃、断电 | 可能丢 | 不丢，前提是磁盘如实刷新缓存 |

还在用户态缓冲区里的数据（比如 C 的 `fwrite` 缓冲、应用的日志缓冲）连 `write` 都没调用，进程一崩就丢。

## 面试官可能追问

::: details 为什么数据库常用 O_DIRECT？
数据库有自己的缓冲池，再经过 Page Cache 就缓存了两份，浪费内存；而且内核的回写时机和淘汰策略数据库控制不了。InnoDB 可以用 `innodb_flush_method=O_DIRECT` 写数据文件，绕过 Page Cache，但仍会 `fsync` 保证元数据和设备缓存落盘。
:::

::: details 怎么清掉 Page Cache？清了有什么影响？
`sync; echo 1 > /proc/sys/vm/drop_caches` 丢弃干净的 Page Cache，脏页不会被丢，所以先 `sync`。它常用于压测前模拟冷启动。线上随便清会让后续读全部打到磁盘，延迟突增，而且 Page Cache 本来就会在内存紧张时自动回收，"cache 占满内存"并不是问题。
:::

::: details fsync 慢怎么优化？
减少调用次数：批量提交、组提交，把多次写合并成一次 `fsync`。用追加写的日志文件，顺序 I/O 比随机写快得多。只需要数据时用 `fdatasync`，提前分配好文件大小避免每次都改元数据。硬件层面，带掉电保护的 SSD 或 RAID 卡可以让设备缓存刷新变快。
:::

## 易错点

- 把 `write` 成功当成落盘：它只是进了 Page Cache
- 以为 `O_DIRECT` 等于持久化：它只绕开 Page Cache，不负责设备缓存和元数据
- 新建文件只 `fsync` 文件本身，忘了 `fsync` 目录，断电后文件可能不见
- 进程被 `kill -9` 就以为数据丢了：已经 `write` 进内核的数据不会因为进程退出而丢失
