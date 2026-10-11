---
difficulty: 2
tags: [高频, 场景题, 对比]
---

# Bitmap、HyperLogLog、GEO 适合哪些场景？

::: tip 一句话回答
**Bitmap** 用 String 的每一位记录一个整数 ID 的是/否状态，适合**签到、在线状态、日活统计**，还能用 `BITOP` 做多天的交集、并集；前提是 ID 连续且不太大，内存按最大 ID 算，1 亿个 ID 约 12MB。**HyperLogLog** 做**去重计数的估算**，适合 UV 统计，每个 key 最多约 12KB、标准误差 0.81%，但只能拿到数量，取不出元素，也不能判断某个元素在不在。**GEO** 底层是 **ZSet**，把经纬度编码成 52 位的 GeoHash 当作 score，用 `GEOSEARCH` 查**附近的人、附近的门店**，距离按球面公式算，最坏有 0.5% 的误差。
:::

## 详细解析

### Bitmap：一个 ID 一位

Bitmap 不是独立的类型，而是对 String 按位操作，String 最大 512MB，所以偏移量范围是 0 到 2^32 - 1。常用命令：

- `SETBIT key offset 0|1` 设置某一位，返回原来的值；`GETBIT` 读某一位，超出长度的位都当作 0
- `BITCOUNT key [start end [BYTE|BIT]]` 统计 1 的个数，按位指定范围的 `BIT` 选项是 7.0 加的
- `BITPOS key 0|1` 找第一个 0 或 1 的位置
- `BITOP AND|OR|XOR|NOT destkey key ...` 对多个 Bitmap 做位运算，结果存到 destkey

| 场景 | key 和 offset 的设计 | 统计方式 |
| --- | --- | --- |
| 用户签到 | `sign:{用户ID}:{年月}`，offset = 日期 - 1 | `BITCOUNT` 算本月签到天数，`GETBIT` 查某天是否签到 |
| 日活、在线状态 | `active:{日期}`，offset = 用户 ID | `BITCOUNT` 得到日活；`BITOP AND` 多天得到连续活跃的用户 |
| 布隆过滤器 | 位数组 + 多个哈希函数，见 [缓存穿透](/basics/redis/01-cache-problems) | 有现成的 `BF.ADD`、`BF.EXISTS` 就不用自己实现：之前要装 RedisBloom 模块，Redis 8 起官方发行版已经集成 |

**内存估算**：占用只取决于最大的 offset，和 1 的个数无关。假设用户 ID 从 1 连续分配到 1 亿，一天的日活 Bitmap 约 1 亿 / 8 = 1250 万字节，约 12MB；就算只有一个用户、ID 是 1 亿，也要分配这么多。所以 ID 稀疏（如雪花 ID）时不能直接当 offset，要先映射成连续的整数，或者改用 Set、HyperLogLog。第一次设置一个很大的 offset 时，Redis 要一次分配中间所有的内存，可能阻塞一会儿；`BITCOUNT`、`BITOP` 是 O(N) 的，Bitmap 很大时官方建议拆成多个 key，或放到从节点上算。

### HyperLogLog：12KB 估算去重数量

`PFADD key 元素...` 添加，`PFCOUNT key` 得到估算的去重数量，`PFMERGE dest key...` 合并多个（求并集）。

原理：对每个元素算 64 位哈希，低 14 位决定落到 16384 个寄存器中的哪一个，剩下的位从低位数第一个 1 出现在第几位，寄存器只保留见过的最大值。元素越多，越可能见到很长的连续 0，用所有寄存器的值就能估算出基数。每个寄存器 6 位，16384 × 6 / 8 = 12288 字节，加上 16 字节的头部，这就是"最多约 12KB"的来历；标准误差 1.04 / √16384 ≈ 0.81%。元素少时大部分寄存器是 0，Redis 用压缩这些 0 的稀疏编码，占用远小于 12KB，超过 `hll-sparse-max-bytes`（默认 3000 字节）才转成 12KB 的稠密编码。

局限：不存原始元素，所以**取不出元素、不能判断某个元素是否存在、不能删除元素**；能算并集，不能直接算交集。多个 key 一起 `PFCOUNT` 要临时合并，比单个 key 慢得多。`TYPE` 返回 string。

### GEO：基于 ZSet 的附近查询

- `GEOADD key 经度 纬度 成员`：**经度在前**。纬度有效范围是 ±85.05112878 度，两极附近无法索引
- `GEOSEARCH key FROMLONLAT 经度 纬度 BYRADIUS 3 km ASC COUNT 20 WITHDIST`：按圆形查找，也可以 `BYBOX` 按矩形、`FROMMEMBER` 以某个成员为中心。6.2 起用它代替已废弃的 `GEORADIUS`、`GEORADIUSBYMEMBER`
- `GEODIST` 两点距离、`GEOPOS` 取坐标、`GEOHASH` 取 GeoHash 字符串

原理：经度、纬度各 26 位交叉组合成 52 位整数，double 的尾数正好能无损表示，存为 ZSet 的 score。GeoHash 越靠前的位越相同，位置越接近，所以查询时算出覆盖目标区域的 9 个格子（中心格加周围 8 格），对每个格子做 score 范围查询，再按实际距离过滤。距离用 Haversine 公式按球体计算，地球不是正球体，官方说明最坏误差约 0.5%。

局限：一个城市的所有点放在一个 key 里容易变成大 Key，而且只在一个节点上，可以按城市或 GeoHash 前缀拆分；只支持圆形和矩形，不支持多边形和复杂的条件过滤（比如"附近 3 公里内营业中的餐厅"），复杂需求用 Elasticsearch、PostGIS 这类地理检索系统。删除成员没有 GEODEL，直接用 `ZREM`。

### 怎么选

| 需求 | 选择 | 原因 |
| --- | --- | --- |
| 每个用户一个是/否状态，ID 连续 | Bitmap | 每人 1 位，精确，还能做位运算 |
| 只要去重后的数量，能接受约 1% 的误差 | HyperLogLog | 不管多少元素都不超过约 12KB |
| 去重后还要知道是谁，或者数据量不大 | Set | 精确，能取出元素，内存随元素数增长 |
| 判断"是否出现过"，允许少量误判 | 布隆过滤器 | 比 Set 省内存，有误判、不能删除 |
| 按距离查附近的点 | GEO | ZSet 上的范围查询，O(log n) |

## 代码示例

```bash
# 签到：用户 1001 在 10 月 1、3、4 日签到，offset = 日期 - 1
127.0.0.1:6379> SETBIT sign:1001:202610 0 1
(integer) 0
127.0.0.1:6379> SETBIT sign:1001:202610 2 1
(integer) 0
127.0.0.1:6379> SETBIT sign:1001:202610 3 1
(integer) 0
127.0.0.1:6379> BITCOUNT sign:1001:202610
(integer) 3
127.0.0.1:6379> BITCOUNT sign:1001:202610 2 6 BIT    # 3 日到 7 日签到了几天（7.0+）
(integer) 2
127.0.0.1:6379> BITPOS sign:1001:202610 0            # 第一个没签到的是 2 日
(integer) 1

# 日活：offset = 用户 ID；两天都活跃的用户
127.0.0.1:6379> SETBIT active:20261010 1001 1
(integer) 0
127.0.0.1:6379> SETBIT active:20261011 1001 1
(integer) 0
127.0.0.1:6379> SETBIT active:20261011 1002 1
(integer) 0
127.0.0.1:6379> BITOP AND active:both active:20261010 active:20261011
(integer) 126
127.0.0.1:6379> BITCOUNT active:both
(integer) 1

# UV：HyperLogLog
127.0.0.1:6379> PFADD uv:home:20261011 u1 u2 u3 u1
(integer) 1
127.0.0.1:6379> PFADD uv:home:20261012 u3 u4
(integer) 1
127.0.0.1:6379> PFMERGE uv:home:2days uv:home:20261011 uv:home:20261012
OK
127.0.0.1:6379> PFCOUNT uv:home:2days
(integer) 4

# 附近的门店：距离中心约 0.34km、0.65km、11km
127.0.0.1:6379> GEOADD shops 116.397 39.908 shop:a 116.404 39.915 shop:b 116.480 39.990 shop:c
(integer) 3
127.0.0.1:6379> GEOSEARCH shops FROMLONLAT 116.400 39.910 BYRADIUS 2 km ASC COUNT 10
1) "shop:a"
2) "shop:b"
127.0.0.1:6379> TYPE shops
zset
```

`BITOP` 返回结果字符串的字节数：offset 1002 在第 126 个字节里。

## 面试官可能追问

::: details 统计一个月里连续签到的天数怎么做？
一种做法是用 `BITFIELD sign:1001:202610 GET u31 0` 一次取出前 31 位，得到一个整数，在客户端用位运算从今天往前数连续的 1。另一种是用 `BITPOS key 0` 找第一个没签到的日期，得到从月初开始的连续天数。跨月的连续签到要读两个 key，或者按"用户 + 年"建 key，offset 用一年中的第几天。
:::

::: details 统计 UV，用 Set、Bitmap、HyperLogLog 各有什么问题？
Set 精确，但每个访问者都要存一份，内存随 UV 线性增长，按页面、按天建 key 累积起来非常大。Bitmap 精确且省内存，但要求用户 ID 是连续整数，游客这类没有整数 ID 的访问者放不进去。HyperLogLog 不管多少访问者都不超过约 12KB，按天、按页面建 key 也不怕，代价是约 0.81% 的标准误差，适合看趋势的报表，不适合计费、结算这类要求精确的场景。
:::

::: details GEO 的"附近的人"要怎么支撑大量用户和频繁更新？
位置更新就是一次 `GEOADD`，本质是 ZSet 的更新，O(log n)，高频更新可以接受。量大时按城市或 GeoHash 前缀拆成多个 key，让数据分散到不同节点，查询时只查用户所在的格子及相邻格子对应的 key。下线或长时间不更新的用户要及时 `ZREM`，否则会查出过期的位置；也可以另外用一个按更新时间排序的 ZSet 定期清理。
:::

## 易错点

- Bitmap 的内存由最大 offset 决定，ID 很大或很稀疏时会白白占用大量内存
- HyperLogLog 是估算值，不能取出元素，也不能判断某个元素是否存在
- `GEOADD` 是经度在前、纬度在后，写反了会报错或者存成错误的位置
- Bitmap、HyperLogLog 的 `TYPE` 是 string，GEO 的 `TYPE` 是 zset，它们都不是独立的类型
