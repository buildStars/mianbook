---
difficulty: 2
tags: [高频, 原理, 手写题]
---

# 一致性哈希是什么？解决了什么问题？

::: tip 一句话回答
普通的 `hash(key) % N` 分片，节点数一变，几乎所有 key 的位置都会变，缓存集群扩容一台就相当于大面积失效。一致性哈希把节点和 key 都映射到一个 **0 ~ 2^32-1 的哈希环**上，key 顺时针找到的第一个节点就是它的归属。增删一个节点，只影响它和前一个节点之间那一段的 key，迁移量约为 **1/N**。节点少时分布会不均匀，用**虚拟节点**解决：每个物理节点在环上放上百个点。Redis Cluster 没用一致性哈希，而是用固定的 **16384 个哈希槽**。
:::

## 详细解析

### 取模的问题

4 台缓存节点用 `hash(key) % 4` 分片，扩容到 5 台后变成 `% 5`。一个 key 要保持原位，需要 `hash % 4 === hash % 5`，只有约 1/5 的 key 满足，也就是**约 80% 的 key 换了节点**。对缓存来说，这些请求都会未命中，压力全部打到数据库上，类似一次 [缓存雪崩](/basics/redis/01-cache-problems)。

### 哈希环

```text
                  0 / 2^32
                 ┌───●───┐
         节点 C ●          ● 节点 A
                │   环    │      key1 ──顺时针──> 节点 A
         节点 D ●          │      key2 ──顺时针──> 节点 B
                 └───●───┘
                   节点 B

新增节点 E 放在 A 和 B 之间：
  只有原本落在 (A, E] 区间的 key 从 B 移到 E，其他 key 不动
删除节点 B：
  原本属于 B 的 key 顺延给下一个节点 C，其他 key 不动
```

1. 对节点的标识（IP、名称）计算哈希，放到环上
2. 对 key 计算哈希，从这个位置顺时针找到的第一个节点就是目标节点；超过最大值就回到 0
3. 增删节点只影响相邻区间，其他节点上的数据不需要迁移

### 数据倾斜和虚拟节点

节点少时，几个点在环上的位置很可能不均匀，某个节点负责的区间特别大。另外，一个节点下线后，它的全部数据都压到顺时针的下一个节点上，容易把它也压垮。

**虚拟节点**：每个物理节点在环上放很多个点（比如 `cache-a#0` 到 `cache-a#159`），key 先找到虚拟节点，再映射回物理节点。点多了分布就均匀了；一个节点下线时，它的数据会分散到多个节点上。还可以按机器性能分配不同数量的虚拟节点，实现加权。

用下面的实现做个测试：4 个节点、10 万个 key，每个节点只放 1 个点时，最多的节点分到约 34%，最少的只有约 12%，相差近 3 倍；每个节点 160 个虚拟节点时，各节点都在 23%～27% 之间（结果和哈希函数、节点名有关，仅作示意）。

### 和 Redis Cluster 哈希槽的对比

| 维度 | 一致性哈希 | 哈希槽（Redis Cluster） |
| --- | --- | --- |
| 映射方式 | key → 环上位置 → 顺时针第一个节点 | `CRC16(key) % 16384` → 槽 → 节点 |
| 分配方式 | 由节点的哈希值决定，不能直接指定 | 槽和节点的对应关系可以手动调整 |
| 扩缩容 | 自动影响相邻区间 | 显式迁移指定的槽，可控、可以逐步进行 |
| 均衡性 | 依赖虚拟节点 | 按槽数量分配，天然均衡 |

哈希槽多了一层"槽 → 节点"的映射表，换来对数据分布的精确控制。Cluster 的细节见 [Redis 高可用](/basics/redis/08-high-availability)。

### 应用场景

- 分布式缓存的客户端分片，例如 Memcached 客户端常用的 Ketama 算法
- 负载均衡中需要会话粘滞或提高本地缓存命中率时，例如 Nginx 的 `hash $request_uri consistent`（用的也是 Ketama），让同一个 URL 尽量转发到同一台后端，增删后端时只有少量 URL 换机器
- 分布式存储的数据分布，例如 Amazon 的 Dynamo 论文、Cassandra 的 token 环都基于一致性哈希（注意 AWS 的 DynamoDB 服务和 Dynamo 论文不是一回事）

## 代码示例：手写一致性哈希

排序数组存放虚拟节点，二分查找第一个大于等于 key 哈希值的点：

```js
import { createHash } from 'node:crypto'

// 取 MD5 的前 4 个字节作为 32 位无符号整数，环的范围是 0 ~ 2^32-1
const hash = (key) => createHash('md5').update(key).digest().readUInt32BE(0)

class ConsistentHash {
  constructor(nodes = [], replicas = 160) {
    this.replicas = replicas // 每个物理节点对应的虚拟节点数
    this.ring = [] // 按 hash 升序排列的 { hash, node }
    nodes.forEach((n) => this.addNode(n))
  }

  addNode(node) {
    for (let i = 0; i < this.replicas; i++) {
      this.ring.push({ hash: hash(`${node}#${i}`), node })
    }
    this.ring.sort((a, b) => a.hash - b.hash)
  }

  removeNode(node) {
    this.ring = this.ring.filter((v) => v.node !== node)
  }

  getNode(key) {
    if (this.ring.length === 0) return null
    const h = hash(key)
    // 二分查找第一个 hash >= h 的虚拟节点
    let lo = 0
    let hi = this.ring.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.ring[mid].hash < h) lo = mid + 1
      else hi = mid
    }
    // 超过最后一个节点就回到环的起点（顺时针绕一圈）
    return this.ring[lo % this.ring.length].node
  }
}

// 验证：加一个节点后，有多少 key 换了位置
const keys = Array.from({ length: 100000 }, (_, i) => `user:${i}`)
const ch = new ConsistentHash(['cache-a', 'cache-b', 'cache-c', 'cache-d'])
const before = keys.map((k) => ch.getNode(k))
ch.addNode('cache-e')
const moved = keys.filter((k, i) => ch.getNode(k) !== before[i]).length
console.log(`一致性哈希迁移比例：${(moved / keys.length * 100).toFixed(1)}%`) // 接近 1/5

const modMoved = keys.filter((k) => hash(k) % 4 !== hash(k) % 5).length
console.log(`取模迁移比例：${(modMoved / keys.length * 100).toFixed(1)}%`) // 约 80%
```

## 面试官可能追问

::: details 虚拟节点设多少个合适？
没有标准值，是均衡性和内存、查找开销之间的权衡。虚拟节点越多分布越均匀，但环越大，查找是 O(log M)，影响不大，主要是内存和节点变更时重新排序的开销。常见取值在一百到几百之间，可以用实际的 key 分布测一下各节点的标准差再定。
:::

::: details 一致性哈希的节点扩容后，数据怎么迁移？
对缓存来说通常不迁移：新节点上的 key 先未命中，从数据库加载即可，只要保证一次只加一台、避免大面积未命中。对存储系统来说要真正搬数据：新节点加入后，从顺时针下一个节点把属于自己区间的数据拷贝过来，拷贝期间读请求要能回退到旧节点，迁移完成后再切换。
:::

::: details 还有其他替代算法吗？
有。Jump Consistent Hash 不需要存储环，内存占用极小、分布均匀，但只适合节点编号连续、只在末尾增减节点的场景；Rendezvous Hashing（最高随机权重哈希）对每个 key 计算它和所有节点的组合得分，选最高的节点，实现简单，代价是每次查找要遍历全部节点。
:::

## 易错点

- 认为一致性哈希完全不用迁移数据，实际是迁移量从大部分降到了约 1/N
- 忘了虚拟节点，节点少时分布可能严重不均
- 把 Redis Cluster 说成使用一致性哈希，它用的是哈希槽
- 手写时忘了处理"超过环上最大值后回到起点"
