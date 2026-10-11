---
difficulty: 3
tags: [高频, 原理]
---

# map 的底层是怎么实现的？为什么不是并发安全的？

::: tip 一句话回答
map 是哈希表，要分版本讲：Go 1.23 及之前是经典的**桶 + 溢出桶**结构，每个桶放 8 个键值对，装载因子过高时**渐进式扩容**；Go 1.24 起默认实现换成了基于 **Swiss Table** 的开放寻址哈希表，8 个槽位一组，用哈希值的一部分作为指纹批量比对。遍历顺序是**故意随机**的。map 为了性能没有内置锁，运行时检测到并发读写会直接 **fatal error** 终止程序，recover 也拦不住；并发场景用 `sync.RWMutex` 保护，读多写少且 key 相对稳定时可以用 `sync.Map`。
:::

## 详细解析

### Go 1.23 及之前：桶 + 溢出桶

```text
hmap（map 变量本质上是指向它的指针）
 ├─ count       元素个数，len(m) 直接返回它
 ├─ B           桶的数量是 2^B
 ├─ hash0       哈希种子，创建 map 时随机生成
 ├─ buckets ──> [桶 0] [桶 1] ... [桶 2^B-1]
 └─ oldbuckets  扩容期间指向旧的桶数组

桶（bmap），每个桶最多放 8 个键值对
 ├─ tophash [8]uint8   每个 key 哈希值的高 8 位，用来快速比对
 ├─ keys    [8]K       8 个 key 连续存放
 ├─ values  [8]V       8 个 value 连续存放（和 key 分开放，可以减少内存对齐的填充）
 └─ overflow ──> 溢出桶（桶满了以后，新元素放进溢出桶，串成链表）
```

- **查找**：计算 key 的哈希 → 用低 B 位选出桶 → 在桶里先比较 tophash，相同再比较完整的 key → 没找到就沿着溢出桶继续找
- **扩容条件**：平均每个桶的元素数（装载因子）超过 6.5 时，桶的数量**翻倍**；元素不多但溢出桶太多时（常见于大量增删之后），做一次**等量扩容**，把数据重新排列得更紧凑
- **渐进式扩容**：不一次性搬完所有数据，而是在之后每次写入和删除时顺带搬迁一两个旧桶，避免一次扩容造成长时间停顿；搬迁期间查找会先判断目标旧桶是否已经搬走，再决定去新桶还是旧桶里找

### Go 1.24 起：Swiss Table

新实现不再有溢出桶，改为**开放寻址**：

- 数据存放在"组"里，每组 8 个槽位，外加一个 8 字节的控制字。控制字的每个字节对应一个槽位，要么表示空、已删除，要么存着这个槽位上 key 哈希值的低 7 位，作为指纹
- 查找时，用哈希值的其余位确定从哪一组开始探测，把目标指纹和控制字的 8 个字节**一次性比较**（用位运算，部分平台用 SIMD 指令），只有指纹相同的槽位才去比较完整的 key。这一组没找到、但组里还有空槽，就说明 key 不存在；否则按探测序列去下一组找
- 扩容：大 map 由多个独立的表组成，通过一个目录根据哈希值定位到具体的表。单个表的大小有上限，需要扩容时只扩容或拆分这一个表，不会一次搬迁整个 map，每次扩容的耗时都有上限

面试时讲清两者的思路即可：旧实现是"桶 + 溢出桶链表 + 渐进式搬迁"，新实现是"按组比对指纹的开放寻址 + 按表拆分"，后者减少了指针跳转，对 CPU 缓存更友好。具体的字段和参数属于实现细节，还会随版本调整。

### 遍历顺序是随机的

语言规范没有规定 map 的遍历顺序，运行时还故意让每次 `for range` 从随机位置开始（旧实现是随机选起始桶和桶内偏移），防止代码依赖某种碰巧稳定的顺序。需要有序输出时先对 key 排序，比如 `slices.Sorted(maps.Keys(m))`（Go 1.23 起）。`fmt.Println` 打印 map 时会按 key 排序，看起来是有序的，但这只是 fmt 的处理。这一点和 JS 不同：JS 的 Map 按插入顺序遍历，Go 的 map 没有任何顺序保证。

### 为什么不是并发安全的

- **设计取舍**：大多数 map 只在一个 goroutine 中使用，或者本来就和其他数据一起被锁保护着，内置锁会让所有场景都付出开销
- **检测机制**：运行时在 map 上维护一个"正在写入"的标志，写操作开始时设置、结束时清除，其他读写操作发现它已被设置，就直接终止程序，报 `fatal error: concurrent map writes` 或 `concurrent map read and map write`
- **为什么直接崩溃**：并发写可能破坏哈希表的内部结构（比如扩容搬迁到一半），继续运行会产生难以排查的错误数据，不如立即暴露。这是 fatal error 而不是 panic，recover 捕获不了，见 [defer、panic、recover](/basics/go/06-defer-panic-recover)
- 这种检测只是尽力而为，不保证每次都能发现，开发和测试时要用 `-race` 检测数据竞争

## 代码示例

```go
package main

import (
	"fmt"
	"sync"
)

// 读写锁保护的 map：读可以并发，写互斥
type SafeMap[K comparable, V any] struct {
	mu sync.RWMutex
	m  map[K]V
}

func NewSafeMap[K comparable, V any]() *SafeMap[K, V] {
	return &SafeMap[K, V]{m: make(map[K]V)}
}

func (s *SafeMap[K, V]) Get(key K) (V, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.m[key]
	return v, ok
}

func (s *SafeMap[K, V]) Set(key K, val V) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[key] = val
}

func main() {
	sm := NewSafeMap[string, int]()
	var wg sync.WaitGroup
	for i := range 100 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sm.Set(fmt.Sprint(i%10), i) // 换成普通 map 直接并发写，很可能 fatal error
		}()
	}
	wg.Wait()
	_, ok := sm.Get("3")
	fmt.Println(ok) // true

	var cache sync.Map // 开箱即用，但 key 和 value 都是 any
	cache.Store("go", 1)
	v, loaded := cache.LoadOrStore("go", 2) // key 已存在：不写入，返回旧值
	fmt.Println(v.(int), loaded)            // 1 true
}
```

| 方案 | 适用场景 |
| --- | --- |
| `sync.RWMutex` + map | 通用做法：类型安全，能和其他字段一起保护，也方便做"先检查再写入"这类复合操作 |
| `sync.Map` | 读多写少且 key 相对稳定（比如只增不改的缓存），或者多个 goroutine 各自读写互不相交的 key |
| 分片加锁 | 写入频繁、锁竞争激烈时，按 key 的哈希把数据分到多个小 map，各自加锁 |

**不能对 map 元素取地址**：`&m["a"]` 会编译报错。扩容时元素会被搬到新的位置，之前取到的地址就失效了，所以语言直接禁止。同理，value 是结构体时 `m["a"].Age = 18` 也编译不过，要整体读出、修改、再写回，或者让 map 存指针，如 `map[string]*User`。

## 面试官可能追问

::: details map 的 key 可以是哪些类型？
key 必须是可比较的类型（支持 ==），slice、map、函数都不能作为 key；数组、字段都可比较的结构体可以。key 的类型是接口时编译能通过，但运行时放进去的动态类型如果不可比较（比如 `[]int`），会 panic。浮点数的 NaN 不等于自身，用它作 key 每次写入都会新增一个条目，而且再也查不出来。
:::

::: details 删除元素后内存会释放吗？
不会马上释放。delete 只是把对应的槽位标记为空，map 不会因为删除而缩容，曾经装过大量数据的 map，即使删光了，占用的内存也还在。需要释放时，新建一个 map 把剩余数据复制过去，让旧 map 整个被回收。
:::

::: details sync.Map 是怎么实现的？为什么不推荐默认使用？
Go 1.23 及之前，sync.Map 内部有两个 map：只读的 read 通过原子操作访问，读命中时不加锁；新写入的 key 进入加锁的 dirty，读 read 未命中的次数多了，再把 dirty 提升为新的 read。所以它适合读多写少、key 稳定的场景；频繁写入新 key 时，要反复加锁、在两个 map 之间搬数据，并没有优势。Go 1.24 起内部换成了并发哈希树（HashTrieMap），写入不同 key 时的竞争小了很多。但它的 key 和 value 都是 any，没有编译期类型检查，也没有 Len 方法，大多数场景用普通 map 加锁更清晰。
:::

## 易错点

- nil map 可以读（返回零值）、可以 delete 和遍历，但写入会 panic：`assignment to entry in nil map`
- key 不存在时 `m[k]` 返回零值，要区分"不存在"和"值就是零值"，用 `v, ok := m[k]`
- 遍历时删除元素是安全的；遍历时新增的元素可能被遍历到，也可能不会
- 并发读写 map 导致的崩溃 recover 不了，不要指望用 recover 兜底
