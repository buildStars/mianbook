---
difficulty: 1
tags: [高频]
---

# ArrayList 和 LinkedList 有什么区别？ArrayList 是怎么扩容的？

::: tip 一句话回答
`ArrayList` 底层是**动态数组**，按下标随机访问 O(1)，中间插入删除要移动元素 O(n)；`LinkedList` 底层是**双向链表**，按下标访问要遍历 O(n)，已经拿到节点时插入删除 O(1)。实际开发中几乎总是用 `ArrayList`，因为数组内存连续、对 CPU 缓存友好，`LinkedList` 很少真的更快。`ArrayList` 容量不够时扩到**原来的 1.5 倍**，用 `Arrays.copyOf` 把旧数组拷到新数组。
:::

## 详细解析

### 结构和复杂度

| 操作 | ArrayList | LinkedList |
| --- | --- | --- |
| `get(i)` | O(1)，直接算地址 | O(n)，从头或尾遍历（取近的一端） |
| 尾部添加 | 均摊 O(1)，偶尔扩容 | O(1) |
| 头部或中间插入删除 | O(n)，要搬移后面的元素 | 定位 O(n)，改指针 O(1) |
| 内存 | 连续数组，可能有空余容量 | 每个元素一个 Node，多出前后两个引用 |
| 额外能力 | 实现了 `RandomAccess` | 实现了 `Deque`，可以当队列和栈 |

### 为什么 LinkedList 很少更快

表格里"链表插入 O(1)"的前提是已经拿到了节点。`list.add(i, x)` 要先遍历找到第 i 个节点，这一步就是 O(n)。更关键的是常数项：

- 数组元素在内存里连续，遍历时 CPU 缓存行和预取能发挥作用；链表节点散落在堆里，每跳一次都可能缓存未命中
- 数组搬移用的是 `System.arraycopy`，底层是批量内存拷贝，非常快
- 链表每个元素多一个对象，分配和 GC 的压力更大

所以即使是频繁在中间插入的场景，`ArrayList` 往往也不慢。要用队列或栈时，`ArrayDeque` 通常也比 `LinkedList` 好。

### ArrayList 的扩容

1. `new ArrayList<>()` 时不分配空间，内部是一个共享的空数组
2. 第一次 `add` 时分配默认容量 10
3. 之后容量不够，新容量 = `old + (old >> 1)`，也就是 1.5 倍；如果 1.5 倍还不够（比如 `addAll` 一大批），就直接用需要的大小
4. 用 `Arrays.copyOf` 创建新数组并拷贝旧元素，旧数组交给 GC

扩容是 O(n) 的拷贝，但按倍数增长，均摊到每次 `add` 还是 O(1)。能预估数量时用 `new ArrayList<>(n)` 或 `ensureCapacity(n)` 避免多次扩容。删除元素不会自动缩容，需要时调用 `trimToSize()`。

### 线程安全

两者都不是线程安全的。多线程并发 `add` 可能丢数据、出现 `null`，甚至抛 `ArrayIndexOutOfBoundsException`。可选方案：

- `Collections.synchronizedList(list)`：每个方法加锁，遍历时还要手动对 list 加锁
- `CopyOnWriteArrayList`：写时复制整个数组，读不加锁，适合**读多写少**，比如监听器列表、配置列表

## 代码示例

```java
import java.util.*;

public class Main {
    public static void main(String[] args) {
        List<Integer> list = new ArrayList<>(List.of(1, 2, 3, 4));

        // ❌ for-each 里直接删除会抛 ConcurrentModificationException
        // for (Integer x : list) if (x % 2 == 0) list.remove(x);

        // ✅ 用 removeIf（或 Iterator.remove）
        list.removeIf(x -> x % 2 == 0);
        System.out.println(list); // [1, 3]

        // 注意 remove 的重载：remove(int) 按下标，remove(Object) 按值
        list.remove(Integer.valueOf(3));
        System.out.println(list); // [1]
    }
}
```

## 面试官可能追问

::: details 为什么 for-each 里删除会抛 ConcurrentModificationException？
`ArrayList` 有一个 `modCount` 记录结构修改次数，迭代器创建时记下当时的值，每次 `next()` 都检查两者是否一致。在循环里调用 `list.remove` 改了 `modCount`，迭代器发现不一致就抛异常，这叫 fail-fast。用迭代器自己的 `remove` 会同步更新期望值，所以不会抛。
:::

::: details 为什么扩容是 1.5 倍，不是 2 倍？
这是空间和时间的折中：倍数太小，扩容次数多；倍数太大，浪费的空余容量多。1.5 倍用位运算 `old >> 1` 计算也很方便。
:::

::: details CopyOnWriteArrayList 有什么缺点？
每次写都要复制整个数组，写多或数组大时开销很高，还会瞬间占用两份内存。迭代器遍历的是创建时的快照，看不到之后的修改，只保证最终一致，不保证实时一致。
:::

## 易错点

- `Arrays.asList` 返回的是固定大小的列表，`add`、`remove` 会抛 `UnsupportedOperationException`；`List.of` 返回的是完全不可变的列表
- `new ArrayList<>(10)` 只是容量为 10，`size()` 还是 0，`set(5, x)` 会越界
- `List<Integer>` 调用 `remove(1)` 删的是下标 1，不是值 1
