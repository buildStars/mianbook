---
difficulty: 2
tags: [高频, 原理]
---

# Redis 有哪些数据类型？底层是怎么实现的？

::: tip 一句话回答
常用的五种是 **String、List、Hash、Set、ZSet**，另外还有 Bitmap、HyperLogLog、GEO、Stream 等。每种类型会按数据量选择不同的底层编码：**数据少时用紧凑的连续内存（listpack、intset）节省内存**，超过阈值后转成哈希表、跳表这类查找更快的结构。String 用 SDS 实现，List 数据多时用 quicklist，ZSet 数据多时用**跳表 + 哈希表**：哈希表按成员查分数，跳表按分数排序、支持范围查询。Redis 7.0 用 listpack 全面替代了 ziplist。
:::

## 详细解析

### 类型和底层编码

`TYPE key` 看到的是数据类型，`OBJECT ENCODING key` 看到的是底层编码，一种类型可能对应多种编码：

| 类型 | 底层编码 | 切换条件 |
| --- | --- | --- |
| String | int、embstr、raw | 能表示成整数的用 int；不超过 44 字节的字符串用 embstr；更长的用 raw |
| List | listpack → quicklist | 数据少时直接用一个 listpack；超过单个节点的大小限制后转成 quicklist：双向链表，每个节点是一个 listpack，兼顾内存和两端插入的效率 |
| Hash | listpack → hashtable | 字段数、每个字段名和值的长度都不超过阈值时用 listpack |
| Set | intset → listpack → hashtable | 元素全是整数、且数量不超过阈值时用 intset；不全是整数，但元素个数和长度都不超过阈值时用 listpack；否则用 hashtable |
| ZSet | listpack → skiplist | 元素不超过 128 个、每个成员不超过 64 字节（默认值）时用 listpack，否则用跳表 + 哈希表 |

阈值都可以配置，如 `hash-max-listpack-entries`、`zset-max-listpack-entries`、`set-max-intset-entries`、`set-max-listpack-entries`、`list-max-listpack-size`。List 和 Set 的 listpack 编码是 Redis 7.2 加入的：7.0 里 List 不管大小都是 quicklist，不全是整数的 Set 直接用 hashtable。

**为什么小数据用紧凑编码**：哈希表、跳表的每个元素都要额外的指针和结构体，数据少时这些开销比数据本身还大。listpack 把所有元素依次放在一块连续的内存里，没有指针，对 CPU 缓存也友好。代价是查找和插入是 O(n)，所以只在元素少、元素小的时候使用，超过阈值就转换。

### String：SDS

Redis 没有直接用 C 字符串，而是实现了 SDS（Simple Dynamic String），结构里记录了已用长度和已分配的容量：

- 取长度是 O(1)，C 字符串要遍历到 `\0` 才知道
- 二进制安全：按长度而不是 `\0` 判断结尾，可以存图片、序列化后的数据
- 追加时空间不够会预分配额外空间（新长度小于 1MB 时按两倍分配，否则多分配 1MB），减少反复申请内存

### ZSet：跳表 + 哈希表

```text
L3: 1 ─────────────────────────────────> 50
L2: 1 ────────────> 20 ────────────────> 50
L1: 1 ──> 10 ──> 20 ──> 30 ──> 40 ──> 50

查找 30：从最高层开始，下一个节点比目标大就下降一层，否则向右走
L3：1 的下一个是 50，太大，下降 → L2：走到 20，下一个 50 太大，下降 → L1：20 的下一个就是 30
```

跳表是在有序链表上加了多层"快速通道"，每个节点的层数随机生成（Redis 中每多一层的概率是 1/4），查找、插入、删除的平均复杂度都是 O(log n)。节点里还记录了每层指针跨过了多少个节点，所以 `ZRANK` 求排名也是 O(log n)。ZSet 同时维护一个哈希表，`ZSCORE` 按成员查分数是 O(1)。

为什么用跳表而不用红黑树：

- **范围查询简单**：`ZRANGEBYSCORE` 找到起点后，沿最底层的链表往后走就行；红黑树要做中序遍历，实现更复杂
- **实现和调试简单**：插入、删除只需要修改相邻节点的指针，不需要旋转和重新着色
- **内存可调**：通过升层概率控制每个节点的平均指针数，Redis 的取值下平均约 1.33 个，比平衡树每个节点 2 个指针还少
- **性能相当**：复杂度都是 O(log n)；数据在内存里，也不需要像 B+ 树那样为减少磁盘 I/O 做设计（对比 [MySQL 为什么用 B+ 树](/basics/mysql/01-b-plus-tree)）

### 典型使用场景

| 类型 | 场景 |
| --- | --- |
| String | 缓存对象（JSON）、计数器（`INCR`）、分布式锁（`SET NX`） |
| List | 简单队列（`LPUSH` + `BRPOP`）、最新动态列表 |
| Hash | 对象的多个字段（用户资料、购物车），可以单独修改某个字段 |
| Set | 去重、标签、共同关注（`SINTER`）、抽奖（`SRANDMEMBER`、`SPOP`） |
| ZSet | 排行榜、延迟队列（score 存执行时间）、滑动窗口限流 |

其他类型：

- **Bitmap**：基于 String 按位操作（`SETBIT`、`BITCOUNT`），用 1 个 bit 记录一个用户的签到或在线状态
- **HyperLogLog**：基数统计（如 UV），每个 key 最多约 12KB，标准误差 0.81%，只能估算数量，不能取出元素
- **GEO**：基于 ZSet 存储经纬度，支持查询附近的点
- **Stream**：5.0 引入的消息流，支持消费者组和消息确认（ACK），比 List 更适合做消息队列

## 代码示例

```bash
127.0.0.1:6379> SET views 100
OK
127.0.0.1:6379> OBJECT ENCODING views
"int"
127.0.0.1:6379> SET title "hello"
OK
127.0.0.1:6379> OBJECT ENCODING title
"embstr"
127.0.0.1:6379> ZADD rank 100 tom 90 jerry
(integer) 2
127.0.0.1:6379> OBJECT ENCODING rank
"listpack"
127.0.0.1:6379> TYPE rank
zset
```

## 面试官可能追问

::: details embstr 和 raw 有什么区别？为什么是 44 字节？
embstr 把对象头（redisObject）和 SDS 放在同一块连续内存里，只需要分配一次内存；raw 要分配两次。Redis 以 64 字节为界：redisObject 占 16 字节，最小的 SDS 头占 3 字节，结尾的 `\0` 占 1 字节，剩下 64 - 16 - 3 - 1 = 44 字节留给内容。embstr 是只读的，修改它（比如 `APPEND`）后会变成 raw。
:::

::: details ziplist 为什么被 listpack 替代？
ziplist 的每个元素都记录了**前一个元素**的长度：前一个元素小于 254 字节时用 1 字节记录，否则用 5 字节。如果某个元素变长，后一个元素记录长度的字段可能要从 1 字节扩成 5 字节，它自己也变长了，又会影响再后面一个，这就是**连锁更新**，最坏情况是 O(n²)。listpack 的每个元素只记录自己的长度，从根本上避免了连锁更新。Redis 7.0 中 Hash、ZSet 和 quicklist 的节点都改用了 listpack。
:::

::: details 存对象用 String 还是 Hash？
String 存序列化后的 JSON，整体读写简单，适合总是整体读取的对象。Hash 可以单独读写某个字段，用 `HINCRBY` 原子地修改数值，适合字段多、经常局部更新的对象。Hash 不能给单个字段设置过期时间（Redis 7.4 起才支持字段级过期）；字段很多时还要注意别变成大 Key。
:::

::: details 用 List 做消息队列有什么问题？
`BRPOP` 取出消息后，消息就从列表里删除了，消费者处理到一半崩溃，消息就丢了；可以用 `BLMOVE` 在取出的同时放进一个备份列表，处理完再删除。List 也不支持多个消费者组各自消费同一份消息。这些问题 Stream 都有对应的机制；对可靠性要求高的场景，还是用 Kafka、RabbitMQ 这类专门的消息队列。
:::

## 易错点

- 数据类型和底层编码是两回事，被问到"底层实现"时，要说出编码和切换条件
- Bitmap 和 HyperLogLog 不是独立的类型，对它们执行 `TYPE` 返回的是 string
- Redis 7 里已经没有 ziplist 了，还回答"小数据用 ziplist"是旧版本的说法
- 紧凑编码的操作是 O(n)，不要为了省内存把阈值调得太大
