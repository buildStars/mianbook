---
difficulty: 1
tags: [对比, 高频]
---

# Redis 和 Memcached 有什么区别？为什么现在多用 Redis？

::: tip 一句话回答
两者都是内存 KV 缓存。Memcached 只有**字符串**一种类型，**多线程**，用 **slab** 管理内存，**不持久化**，集群靠客户端分片，定位就是纯缓存。Redis 有 List、Hash、ZSet 等**丰富数据结构**，支持 **RDB/AOF 持久化**、主从、哨兵和 **Cluster**，还能做分布式锁、排行榜、消息队列。大多数项目除了缓存还有这些需求，所以多选 Redis；只做简单大并发 KV 缓存时，Memcached 依然好用。
:::

## 详细解析

### 对比

| 维度 | Memcached | Redis |
| --- | --- | --- |
| 数据类型 | 只有字符串 | String、List、Hash、Set、ZSet、Stream 等 |
| 持久化 | 不支持，重启数据全丢 | RDB、AOF |
| 高可用和集群 | 服务端没有复制；分布式靠客户端一致性哈希 | 主从复制、哨兵、Cluster |
| 线程模型 | 多线程处理请求 | 命令执行单线程，网络 I/O 可以开多线程 |
| 内存管理 | slab 预分配 | 按需分配（jemalloc），有多种淘汰策略 |
| 原子操作 | incr/decr、CAS | 每个命令都原子，还有事务和 Lua 脚本 |
| 其他 | 无 | Pub/Sub、过期事件、Bitmap、HyperLogLog、GEO |

### 线程模型

Memcached 用多个 worker 线程处理连接，单实例就能用满多核，纯 KV 读写的吞吐很高。Redis 的命令执行是单线程的，避免了锁，单核就很快；要用多核可以在一台机器上部署多个实例或用 Cluster（详见 [Redis 为什么快](/basics/redis/02-why-fast)）。

### 内存管理

Memcached 的 slab 机制把内存按大小分成多个等级（slab class），每个等级切成固定大小的 chunk。存一个对象时放进刚好装得下的那个等级。

- 好处：分配和回收很快，不会产生外部碎片
- 坏处：chunk 比对象大的部分浪费掉了（内部碎片）；某个等级满了会在本等级内淘汰，即使别的等级还有空闲

Redis 按实际大小分配，碎片问题由分配器和主动碎片整理处理；内存满了按 `maxmemory-policy` 淘汰（见 [过期与淘汰](/basics/redis/05-expire-eviction)）。

### 为什么现在多用 Redis

- 一套组件覆盖缓存、计数器、排行榜、分布式锁、简单队列，少维护一种中间件
- 持久化和复制让它可以存一些"丢了也能重建，但重建很贵"的数据
- 数据结构直接在服务端操作，比如往 List 追加、给 ZSet 加分，不用"取出来改完再写回"

Memcached 仍然合适的场景：只要纯 KV 缓存、value 比较小、要单实例吃满多核，或者团队已有成熟的 Memcached 集群。

## 面试官可能追问

::: details Memcached 的 value 有大小限制吗？
有，默认单个 item 最大 1 MB，可以通过启动参数调大，但调大会影响 slab 的划分，一般不建议存大对象。Redis 的 String 理论上限 512 MB，但实际大 value 会阻塞主线程，同样不建议（见 [大 Key 和热 Key](/basics/redis/09-big-hot-key)）。
:::

::: details Memcached 怎么做分布式？
服务端节点之间互不通信，由客户端用一致性哈希决定 key 存哪个节点。节点宕机后上面的数据直接丢失，请求落到其他节点重新回源。没有复制，所以也没有主从切换。
:::

::: details Redis 是单线程，为什么还能比多线程的 Memcached 快或差不多？
瓶颈主要在网络和内存，不在 CPU 计算。Redis 用 I/O 多路复用、纯内存操作，单线程也很快。只论简单 KV 的单实例吞吐，多线程的 Memcached 可能更高；但 Redis 可以多实例横向扩展，差距在实际业务里通常不是决定因素。
:::

## 易错点

- 说"Redis 完全单线程"不准确：命令执行单线程，持久化、异步删除、网络 I/O 都可以有其他线程
- Memcached 不支持持久化，也没有服务端复制，不要和 Redis 混为一谈
- slab 解决的是外部碎片，带来的是内部碎片，别说反
