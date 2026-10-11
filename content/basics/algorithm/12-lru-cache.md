---
difficulty: 2
tags: [高频, 手写题]
---

# 怎么手写一个 LRU 缓存？

::: tip 一句话回答
LRU（Least Recently Used，最近最少使用）是缓存满了时**淘汰最久没被访问的数据**，`get` 和 `put` 都要求 O(1)。JS 里最简洁的写法是利用 **Map 按插入顺序迭代**：访问时先 `delete` 再 `set`，把 key 移到末尾；超出容量时删掉 `map.keys().next().value`，也就是最旧的那个。面试官常要求不依赖 Map 的顺序，用**哈希表 + 双向链表**：哈希表 O(1) 找到节点，双向链表 O(1) 把节点移到头部或删掉尾部。
:::

## 详细解析

### LRU 用在哪里，面试时怎么切入

缓存容量有限，满了就要决定淘汰谁。LRU 假设"最近被访问过的数据，接下来更可能再被访问"，对有热点的访问模式通常有效：

- Vue 的 `<KeepAlive>` 设置 `max` 后，超出数量时按 LRU 卸载最久没访问的组件实例，见 [keep-alive 的原理](/basics/vue/14-keep-alive)
- Redis 内存达到 `maxmemory` 时可以按 `allkeys-lru` 淘汰，不过它是采样近似的 LRU，见 [Redis 过期删除和内存淘汰](/basics/redis/05-expire-eviction)
- MySQL InnoDB 的 Buffer Pool 用改进的 LRU：新读入的页先放进链表中部的 old 区，过一段时间再被访问才移到头部，避免全表扫描把热点页挤出去，见[一条 SQL 语句在 MySQL 里是怎么执行的](/basics/mysql/11-sql-execution)
- 前端缓存接口结果、图片等资源时，也常用 LRU 控制数量上限

面试时先确认需求：容量固定，`get(key)` 不存在返回 -1，存在则返回值并标记为最近使用；`put` 写入或更新，超出容量时淘汰最久没用的；两者都要 O(1)。再推导结构：O(1) 查找需要哈希表；O(1) 维护新旧顺序，需要一个能在任意位置删除、在头部插入的结构，就是双向链表。

### 解法 1：利用 Map 的插入顺序

**思路**：Map 的迭代顺序就是插入顺序，把"最近使用"等同于"最后插入"。`set` 一个已存在的 key 只会更新值、不会改变位置，所以必须先 `delete` 再 `set`。`get`、`put` 都是 O(1)（Map 的增删查平均 O(1)），空间 O(capacity)。

```js
class LRUCacheByMap {
  constructor(capacity) {
    this.capacity = capacity
    this.cache = new Map()
  }
  get(key) {
    if (!this.cache.has(key)) return -1
    const value = this.cache.get(key)
    this.cache.delete(key) // 删掉再插入，移到"最新"的一端
    this.cache.set(key, value)
    return value
  }
  put(key, value) {
    if (this.cache.has(key)) this.cache.delete(key)
    this.cache.set(key, value)
    if (this.cache.size > this.capacity) {
      // 迭代器的第一个 key 是最早插入的，也就是最久没被访问的
      this.cache.delete(this.cache.keys().next().value)
    }
  }
}
```

Vue 的 KeepAlive 也是靠 Set 的插入顺序记录访问顺序的。

### 解法 2：哈希表 + 双向链表

**思路**：链表头部放最近使用的节点，尾部放最久没用的；访问一个节点就把它摘下来插到头部，淘汰时删除尾部节点；哈希表存 `key → 节点`，O(1) 定位。`get`、`put` 都是 O(1)，空间 O(capacity)。三个设计点要能讲出原因：

- **双向**链表：从中间摘掉一个节点要改它前驱的 `next`，单链表找前驱是 O(n)
- 节点里**存 key**：淘汰尾节点时，要用它的 key 去哈希表里删除对应项
- **哑头尾节点**：真实节点永远夹在 `head` 和 `tail` 之间，插入删除都不用判断空指针

```js
class LRUCache {
  constructor(capacity) {
    this.capacity = capacity
    this.map = new Map() // key -> 链表节点 { key, value, prev, next }
    this.head = { next: null } // 哑头节点，head.next 是最近使用的
    this.tail = { prev: this.head } // 哑尾节点，tail.prev 是最久没用的
    this.head.next = this.tail
  }
  #remove(node) {
    node.prev.next = node.next
    node.next.prev = node.prev
  }
  #addToFront(node) {
    node.prev = this.head
    node.next = this.head.next
    this.head.next.prev = node
    this.head.next = node
  }
  get(key) {
    const node = this.map.get(key)
    if (!node) return -1
    this.#remove(node) // 移到头部：标记为最近使用
    this.#addToFront(node)
    return node.value
  }
  put(key, value) {
    let node = this.map.get(key)
    if (node) {
      node.value = value
      this.#remove(node)
    } else {
      node = { key, value, prev: null, next: null }
      this.map.set(key, node)
    }
    this.#addToFront(node)
    if (this.map.size > this.capacity) {
      const lru = this.tail.prev // 尾部就是最久没用的
      this.#remove(lru)
      this.map.delete(lru.key)
    }
  }
}

const cache = new LRUCache(2)
cache.put(1, 'a')
cache.put(2, 'b')
console.log(cache.get(1)) // 'a'，1 变成最近使用
cache.put(3, 'c') // 超出容量，淘汰最久没用的 2
console.log(cache.get(2)) // -1
```

LFU（Least Frequently Used）则淘汰**访问次数最少**的数据，次数相同再淘汰最久没用的。LRU 只看最近一次访问时间，一次性批量扫描大量冷数据时，冷数据都成了"最近使用"，会把真正的热点挤出去；LFU 对这种情况更稳，但实现更复杂，新数据访问次数少，也容易被过早淘汰。

## 面试官可能追问

::: details LFU 怎么做到 O(1)？
维护三样东西：`key → { value, freq }` 的哈希表；`freq → 这个频次下的 key 集合`，集合用 Map 或 Set，靠插入顺序让同频次内按 LRU 淘汰；当前最小频次 `minFreq`。访问一个 key 时把它从 `freq` 的集合移到 `freq + 1` 的集合，原集合空了且原频次等于 `minFreq` 时，`minFreq` 加 1。插入新 key 时，如果容量已满，先删除 `minFreq` 集合里的第一个 key，再以频次 1 插入，`minFreq` 重置为 1。顺序不能反：先插入再淘汰，新 key 可能是频次 1 里唯一的一个，刚放进去就被删掉。
:::

::: details 怎么给 LRU 加上过期时间？
每个节点额外存 `expireAt`。`get` 时先检查是否过期，过期就删掉并返回未命中，这是惰性删除。只靠惰性删除，过期却没人访问的数据会一直占着容量，可以再加一个定时任务分批清理，思路和 Redis 的惰性删除加定期删除一样。
:::

::: details Java 里怎么快速实现 LRU？
继承 `LinkedHashMap`，构造时第三个参数 `accessOrder` 传 `true`，让迭代顺序变成访问顺序，再重写 `removeEldestEntry`，在 `size() > capacity` 时返回 `true`，插入后就会自动删除最旧的项。它不是线程安全的，生产中一般直接用 Caffeine 这类缓存库。
:::

## 易错点

- 用 Map 实现时直接 `set` 已存在的 key，位置不会变，访问顺序就错了，必须先 `delete`
- `get` 命中时也要更新顺序，访问也算"使用"，只在 `put` 时调整顺序是错的
- `put` 已存在的 key 时要更新值并移到头部，不能当成新节点插入，否则链表里会有两个相同 key 的节点
- 链表节点不存 key，淘汰尾节点时就没法同步删除哈希表里的项
