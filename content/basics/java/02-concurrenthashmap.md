---
difficulty: 2
tags: [高频, 原理]
---

# ConcurrentHashMap 是怎么保证线程安全的？

::: tip 一句话回答
JDK 7 用**分段锁**：整张表分成多个 Segment，每个 Segment 是一把 ReentrantLock，不同段可以并发写。JDK 8 去掉了分段锁，结构和 HashMap 一样是数组 + 链表 + 红黑树：往空桶里放节点用 **CAS**，桶不为空时用 **synchronized 锁住桶的头节点**，锁的粒度细到单个桶；读操作不加锁，靠 volatile 保证可见性。扩容时多个线程可以协助迁移，元素计数用 baseCount + CounterCell 分散竞争。
:::

## 详细解析

### JDK 7：分段锁

```text
ConcurrentHashMap
 └─ Segment[]（默认 16 个，创建后数量不再变化）
     ├─ Segment 0：继承 ReentrantLock，内部是 HashEntry[] + 链表
     ├─ Segment 1：继承 ReentrantLock，内部是 HashEntry[] + 链表
     └─ ...
```

put 先根据 hash 找到 Segment，锁住这个 Segment 再操作它内部的小哈希表；get 不加锁，靠 volatile 读到最新值。写操作的并发度最多等于 Segment 的个数（由构造参数 `concurrencyLevel` 决定），而且每次都要先定位到 Segment，再定位 Segment 内的桶，多了一层查找。

### JDK 8：CAS + synchronized

put 的大致流程：

1. key 或 value 为 null 直接抛 NullPointerException。计算 hash：高 16 位异或低 16 位，再去掉符号位，因为负数 hash 留给了扩容时的 ForwardingNode、红黑树桶的头节点 TreeBin 等特殊节点
2. 数组还没初始化就先初始化，通过 CAS 修改控制字段 `sizeCtl`，保证只有一个线程执行初始化
3. 定位到的桶为空：用 **CAS** 放入新节点，失败说明有别的线程抢先写入，回到循环重试
4. 桶的头节点是 ForwardingNode：说明正在扩容，当前线程先去**协助迁移**，完成后重试
5. 其他情况：**synchronized 锁住头节点**，在链表或红黑树里插入或覆盖
6. 链表过长时树化（条件和 [HashMap](/basics/java/01-hashmap) 相同），最后调用 `addCount` 更新计数，并检查是否需要扩容

```text
桶为空      -> CAS 放入新节点，不加锁
桶正在迁移  -> 先帮忙扩容，再重试
桶不为空    -> synchronized(头节点)，只锁这一个桶
```

get 全程不加锁：读取数组元素时通过 Unsafe 加上了内存屏障，Node 的 `val` 和 `next` 字段也都是 volatile 的，所以能看到其他线程已经完成的写入。查到正在迁移的桶时，ForwardingNode 会把查找转到新数组。

### 扩容：多线程协助迁移

元素个数超过阈值时触发扩容，创建两倍大小的新数组。迁移任务按区间分配：每个线程通过 CAS 领取一段连续的桶（从数组末尾往前领），迁移一个桶时同样先锁住它的头节点，迁完后在旧数组的这个位置放一个 ForwardingNode 作为标记。其他线程 put 时遇到 ForwardingNode，就加入进来领取剩下的区间，扩容由多个线程并行完成。

### size 怎么统计

如果所有线程都 CAS 同一个计数变量，竞争激烈时大量 CAS 会失败重试。ConcurrentHashMap 的做法和 `LongAdder` 相同：先尝试 CAS 更新 `baseCount`；失败说明有竞争，就改为更新 `CounterCell` 数组中的某个格子，不同线程大概率落在不同的格子上。`size()` 返回 baseCount 加上所有格子的和。

求和时不加锁，所以并发修改期间得到的只是一个近似值。元素个数可能超过 int 范围时，用返回 long 的 `mappingCount()`。

### 和其他线程安全的 Map 对比

| | Hashtable | Collections.synchronizedMap | ConcurrentHashMap（JDK 8） |
| --- | --- | --- | --- |
| 加锁方式 | 方法都是 synchronized，锁整个对象 | 每个方法都锁同一个 mutex | CAS + 锁单个桶，读不加锁 |
| 并发度 | 同一时刻只有一个线程能读写 | 同 Hashtable | 不同桶的写可以并行，读不阻塞 |
| null 键和值 | 不允许 | 取决于被包装的 Map | 不允许 |
| 遍历 | 遍历中被修改，迭代器会快速失败 | 遍历时要手动锁住整个 map | 弱一致，不抛 ConcurrentModificationException |

## 代码示例：复合操作要用原子方法

```java
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class ChmCompoundDemo {
    public static void main(String[] args) throws InterruptedException {
        Map<String, Integer> wrong = new ConcurrentHashMap<>();
        Map<String, Integer> right = new ConcurrentHashMap<>();

        Runnable task = () -> {
            for (int i = 0; i < 10_000; i++) {
                // 错误：get 和 put 各自是线程安全的，但组合起来不是原子操作
                Integer old = wrong.get("pv");
                wrong.put("pv", old == null ? 1 : old + 1);
                // 正确：merge 对同一个 key 的"读-改-写"是原子的
                right.merge("pv", 1, Integer::sum);
            }
        };

        Thread[] threads = new Thread[4];
        for (int i = 0; i < threads.length; i++) {
            threads[i] = new Thread(task);
            threads[i].start();
        }
        for (Thread t : threads) t.join();

        System.out.println(wrong.get("pv")); // 通常小于 40000：并发时丢失了更新
        System.out.println(right.get("pv")); // 40000
    }
}
```

同理，"不存在才放入"用 `putIfAbsent`，"不存在就创建"用 `computeIfAbsent`。按 key 计数时也可以写成 `map.computeIfAbsent(key, k -> new LongAdder()).increment()`。

## 面试官可能追问

::: details 为什么 ConcurrentHashMap 不允许 null 键和 null 值？
为了避免二义性。`get(key)` 返回 null 时，如果允许 null 值，就分不清是"key 不存在"还是"值本身就是 null"。HashMap 在单线程里可以再调用 `containsKey` 区分，但在并发场景下，两次调用之间别的线程可能已经修改了 map，这个判断就不可靠了。所以干脆不允许 null，`get` 返回 null 就一定表示不存在。
:::

::: details JDK 8 为什么用 synchronized 锁桶，而不是 ReentrantLock？
源码注释给出的理由是：不想为每个桶额外关联一个锁对象，浪费空间，所以直接拿桶的头节点当锁，而任何对象都可以作为 synchronized 的锁。另外，锁的粒度细到单个桶后，大多数时候没有竞争，synchronized 经过 JVM 多年的优化，在这种情况下开销很小。
:::

::: details 迭代器和 size 的结果是准确的吗？
都不保证。迭代器是弱一致的：遍历时不会抛 ConcurrentModificationException，可能反映、也可能不反映迭代器创建之后的修改。`size()`、`isEmpty()` 在并发修改时也只是近似值，适合做监控统计，不适合拿来做精确的流程判断。
:::

::: details JDK 7 的 size() 是怎么算的？
先不加锁，把各个 Segment 的元素个数和修改次数分别加起来，连续算几次；如果前后两次的修改次数总和相同，说明统计期间没有修改，直接返回结果。重试几次仍然不一致，就锁住所有 Segment 再统计。
:::

## 易错点

- 用了 ConcurrentHashMap 不等于业务逻辑线程安全，"先查再改"的复合操作要用 `putIfAbsent`、`computeIfAbsent`、`merge` 等原子方法
- `computeIfAbsent` 的映射函数要尽量短，并且不能在里面修改同一个 map：JDK 8 中可能死循环，JDK 9 起检测到这种递归修改时会抛出 IllegalStateException
- JDK 8 的 ConcurrentHashMap 并不是完全无锁，桶不为空时仍然会用 synchronized 锁住这个桶
- 分段锁是 JDK 7 的实现。JDK 8 源码里虽然还有 Segment 类，但只是为了序列化兼容而保留的，已经不再使用
