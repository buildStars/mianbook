---
difficulty: 3
tags: [高频, 原理, 手写题]
---

# ZSet 为什么用跳表？跳表的原理是什么？

::: tip 一句话回答
ZSet 元素少时用 **listpack** 紧凑存储，超过阈值（默认 128 个元素，或某个成员超过 64 字节）后改用 **跳表 + 哈希表**：哈希表按成员 O(1) 查分数，跳表按"分数 + 成员"排序，插入、删除、求排名、范围查询平均都是 O(log n)。跳表是在有序链表上加了多层索引，每个节点的层数随机生成，Redis 源码里每多一层的概率是 **1/4**、最多 **32 层**。不用平衡树，是因为跳表做**范围查询**只要沿最底层链表往后走，**实现简单**，还能通过概率调节**内存**；B+ 树主要为减少磁盘 I/O 而设计，放在内存里这个优势不明显。
:::

## 详细解析

### skiplist 编码的结构

编码的切换条件见 [数据类型和底层实现](/basics/redis/03-data-structures)。数据量大时，一个 ZSet 由两个结构组成（以 Redis 7.2、8.0 源码的 `server.h` 为准）：

```text
zset
├─ dict：member → score，ZSCORE、判断成员是否存在都是 O(1)
└─ zskiplist：header、tail、length、level（当前最高层数）
     └─ zskiplistNode
          ├─ ele、score：成员和分数，ele 和 dict 共用同一个 SDS 字符串，不存两份
          ├─ backward：后退指针，每个节点只有一个，指向第 0 层的前一个节点，ZREVRANGE 倒序遍历用
          └─ level[]：每层一个 { forward 前进指针, span 跨度 }
```

`ZADD` 先查 dict 判断成员是否存在、旧分数是多少，再去跳表里插入或调整位置；`ZSCORE` 只查 dict；`ZRANGE`、`ZRANGEBYSCORE`、`ZRANK` 走跳表。较新的版本（8.6）为了省内存，把成员字符串直接嵌进跳表节点、dict 只存节点指针，两个结构的分工不变。

### 查找过程

跳表的示意图见 [数据类型和底层实现](/basics/redis/03-data-structures)。查找从头节点的最高层开始：下一个节点比目标小就向右走，否则下降一层，直到第 0 层。比较时先比分数，分数相同再比成员的字典序，所以同分的成员也有确定的顺序。把一路走过的 span 加起来就是排名，`ZRANK` 因此也是 O(log n)。

### 随机层数

`zslRandomLevel` 从 1 层开始，每次以 1/4 的概率多加一层，直到失败或到达上限（`ZSKIPLIST_P` 为 0.25，`ZSKIPLIST_MAXLEVEL` 为 32）：

- 节点至少有 k 层的概率是 (1/4)^(k-1)，每往上一层节点数大约变成 1/4，平均查找 O(log n)
- 每个节点平均有 1/(1 - 1/4) ≈ 1.33 个前进指针，比平衡树每个节点 2 个子指针还少
- 4 的 32 次方等于 2^64，32 层足够用；n 个节点时最高层一般在 log4(n) 附近

### 插入、删除和改分数

1. **插入**：像查找一样从最高层往下走，记下每层最后一个比新节点小的节点 `update[i]` 和它的排名；随机出层数，在每一层把新节点接在 `update[i]` 后面，并更新 span
2. **删除**：同样先找出每层的前驱，让它们的指针跳过被删节点；最高层空了就把 level 降下来
3. **改分数**（对已有成员 `ZADD`、`ZINCRBY`）：新分数仍在前后两个节点之间就原地修改，否则删掉旧节点再插入

### 为什么不用平衡树或 B+ 树

| | 跳表 | 红黑树、AVL 树 | B+ 树 |
| --- | --- | --- | --- |
| 查找、插入、删除 | 平均 O(log n) | 最坏 O(log n) | O(log n) |
| 范围查询 | 定位起点后沿第 0 层往后走 | 中序遍历，要回溯父节点或借助栈 | 沿叶子链表走，同样方便 |
| 插入、删除的调整 | 只改相邻节点的指针 | 旋转、变色 | 节点分裂、合并，数组内移动元素 |
| 求排名 | 加一个 span 字段 | 每个节点维护子树大小 | 每个子节点维护计数 |

Redis 作者解释过这个选择，大意是三点：内存占用可以通过概率调节；`ZRANGE` 这类操作按链表遍历，缓存局部性不比平衡树差；实现和调试简单，带 span 的 O(log n) `ZRANK` 就是靠一个不大的补丁加上的。B+ 树的优势是树矮、减少磁盘 I/O（见 [MySQL 为什么用 B+ 树](/basics/mysql/01-b-plus-tree)），内存里没有这个瓶颈。跳表的代价是性能依赖随机数，最坏情况会退化，但概率极低。

## 代码示例：简化的跳表

省略了 span 和后退指针，保留 Redis 的概率、层数上限和"分数 + 成员"的排序规则：

```js
const MAX_LEVEL = 32
const P = 0.25

const node = (level, score, member) => ({ score, member, next: new Array(level).fill(null) })
// 先比分数，分数相同再比成员的字典序
const less = (n, score, member) => n.score < score || (n.score === score && n.member < member)

export class SkipList {
  constructor(random = Math.random) {
    this.head = node(MAX_LEVEL, -Infinity, '') // 头节点不存数据
    this.level = 1
    this.length = 0
    this.random = random
  }
  // update[i]：第 i 层最后一个"小于目标"的节点
  findPrev(score, member) {
    const update = []
    let x = this.head
    for (let i = this.level - 1; i >= 0; i--) {
      while (x.next[i] && less(x.next[i], score, member)) x = x.next[i]
      update[i] = x
    }
    return update
  }
  // 调用方保证 member 不存在（Redis 先查 dict）
  insert(score, member) {
    const update = this.findPrev(score, member)
    let level = 1
    while (this.random() < P && level < MAX_LEVEL) level++ // 随机层数
    for (let i = this.level; i < level; i++) update[i] = this.head // 新增的层从头节点连起
    this.level = Math.max(this.level, level)
    const n = node(level, score, member)
    for (let i = 0; i < level; i++) {
      n.next[i] = update[i].next[i]
      update[i].next[i] = n
    }
    this.length++
  }
  delete(score, member) {
    const update = this.findPrev(score, member)
    const x = update[0].next[0]
    if (!x || x.score !== score || x.member !== member) return false
    for (let i = 0; i < this.level; i++) if (update[i].next[i] === x) update[i].next[i] = x.next[i]
    while (this.level > 1 && !this.head.next[this.level - 1]) this.level-- // 最高层空了就降层
    this.length--
    return true
  }
  // 类似 ZRANGEBYSCORE：O(log n) 定位到第一个 >= min 的节点，再沿第 0 层往后走
  rangeByScore(min, max) {
    const result = []
    for (let x = this.findPrev(min, '')[0].next[0]; x && x.score <= max; x = x.next[0]) result.push([x.member, x.score])
    return result
  }
}
```

## 面试官可能追问

::: details Redis 的跳表和 Pugh 论文里的标准跳表有什么不同？
源码注释里列了三点：允许分数重复；排序时不只比较分数，分数相同还要比较成员；第 0 层有后退指针，相当于双向链表，方便 `ZREVRANGE` 从尾部往前遍历。另外每层指针带了 span，用来在 O(log n) 内算出排名。
:::

::: details 有了跳表，为什么还要一个 dict？
跳表按分数排序，只知道成员时没法定位，只能从头遍历，是 O(n)。dict 让 `ZSCORE` 和 `ZADD` 判断成员是否存在都变成 O(1)，改分数时也是先从 dict 拿到旧分数，再到跳表里定位旧节点。成员字符串在两个结构里共用，多出来的主要是哈希表条目的开销。
:::

::: details 为什么概率取 1/4，而不是 1/2？
p 越小，每个节点的平均指针数越少（1/2 时是 2 个，1/4 时约 1.33 个），层数也越少，但每层要向右走的步数变多。按 Pugh 的分析，期望查找代价大约是"以 1/p 为底的 log n，再除以 p"，p 取 1/2 和 1/4 时都约等于 2·log2(n)。所以 1/4 用更少的内存换来差不多的查找速度，代价是耗时的波动大一些。Pugh 在论文里也建议取 1/4，除非特别在意耗时的波动。
:::

## 易错点

- 当前源码的层数上限是 32、概率是 1/4。常见的"最多 64 层"只是 5.0 的取值（6.0 改回 32），"概率 1/2"是教科书里的常用值，都不是 Redis 现在的实现
- ZSet 小数据时不是跳表，而是 listpack（7.0 之前是 ziplist）
- 跳表的排序依据是"分数 + 成员"，同分的成员按字典序排，不是按插入顺序
- 跳表的 O(log n) 是平均复杂度，平衡树才是最坏 O(log n)
