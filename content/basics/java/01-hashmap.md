---
difficulty: 2
tags: [高频, 原理]
---

# HashMap 的底层原理是什么？JDK 8 做了哪些改进？

::: tip 一句话回答
HashMap 底层是**数组 + 链表**，JDK 8 起链表过长时会转成**红黑树**。put 时先把 hashCode 的高 16 位异或到低 16 位（扰动），再用 `(n - 1) & hash` 算出数组下标，冲突的元素挂在同一个桶里；元素个数超过 `容量 × 负载因子（默认 0.75）` 时扩容为原来的 2 倍。JDK 8 的主要改进：引入红黑树，把冲突严重时的查找从 O(n) 降到 O(log n)；链表从头插改为**尾插**，扩容时按一个比特位把链表拆成高低两条并保持原有顺序，不会再像 JDK 7 那样在并发扩容时形成环。
:::

## 详细解析

### 存储结构

```text
table（Node 数组，长度总是 2 的幂，默认 16，第一次 put 时才创建）
 [0] -> null
 [1] -> Node -> Node -> Node     链表，JDK 8 起新节点追加在尾部
 [2] -> null
 [3] -> TreeNode                 链表过长时转成红黑树
 ...
[15] -> Node
```

每个 Node 保存 `hash`、`key`、`value` 和指向下一个节点的 `next`。

### 定位桶：扰动函数和 (n - 1) & hash

```java
// JDK 8 HashMap 源码：计算 hash
static final int hash(Object key) {
    int h;
    return (key == null) ? 0 : (h = key.hashCode()) ^ (h >>> 16);
}
// 下标 i = (n - 1) & hash，n 是数组长度
```

**为什么要扰动**：下标只取 hash 的低几位（长度 16 时只用低 4 位）。如果一批 key 的 hashCode 只在高位不同，它们会全部落进同一个桶。把高 16 位异或到低 16 位，让高位也参与下标计算，代价只是一次移位和一次异或。

**为什么容量是 2 的幂**：

1. n 是 2 的幂时，`(n - 1) & hash` 相当于对 n 取模，而且 hash 为负数时结果也非负（`%` 会得到负数），位运算也比取模快
2. n - 1 的二进制低位全是 1（比如 15 是 `1111`），hash 的每个低位都参与计算，分布均匀。如果 n 是 15，n - 1 是 `1110`，最低位永远是 0，奇数下标的桶永远用不上
3. 扩容时只需要看 hash 中新增的那一位，就能确定节点的新位置（见下文）

构造方法传入的容量会被 `tableSizeFor` 向上取整成 2 的幂，比如传 10，实际容量是 16。

### put 的流程

1. 计算 hash；数组还没创建就先调用 `resize()` 初始化
2. 用 `(n - 1) & hash` 找到桶，桶为空就直接放入新节点
3. 桶不为空：头节点的 key 相同就覆盖 value；头节点是树节点就按红黑树插入；否则遍历链表，找到相同的 key 就覆盖，找不到就追加到链表尾部
4. 追加后链表长度超过 8，调用 `treeifyBin` 尝试树化
5. 插入了新元素后，如果 `++size > threshold`（容量 × 负载因子），就扩容

判断 key 相同的条件是 hash 相等，并且两个 key 是同一个对象或 `equals` 返回 true。

### 树化的条件

- 要同时满足两个条件：链表长度超过 8（`TREEIFY_THRESHOLD = 8`，准确地说是往已有 8 个节点的桶里再加一个），并且数组长度至少为 64（`MIN_TREEIFY_CAPACITY`）。数组小于 64 时，`treeifyBin` 只会扩容，因为这时冲突多半是数组太小造成的，扩容就能把链表拆散
- 红黑树节点占用的空间大约是普通节点的两倍。源码注释按泊松分布估算过：hashCode 分布良好、负载因子为 0.75 时，一个桶里出现 8 个节点的概率不到千万分之一。所以树化主要是兜底，应对 hashCode 写得很差或者被恶意构造大量冲突的情况
- 扩容拆分后，如果树里的节点不超过 6 个（`UNTREEIFY_THRESHOLD`），会退化回链表。8 和 6 之间留出余量，可以避免在临界值附近反复转换

### 扩容：JDK 8 的高低位拆分

容量翻倍后，n - 1 多出一个值为 1 的高位，这一位的值正好等于旧容量 oldCap。节点的新下标只取决于 hash 在这一位上是 0 还是 1：

- `(hash & oldCap) == 0`：留在原下标 j（低位链表）
- 否则：移到 j + oldCap（高位链表）

例如容量为 16 时，hash 为 5 和 21（二进制 `10101`）的节点都在 5 号桶；扩容到 32 后，5 仍在 5 号桶，21 移到 21 号桶。JDK 8 遍历旧链表时把节点依次追加到这两条链表的尾部，**保持原来的相对顺序**，也不需要重新计算 hash。

### JDK 7 的头插法为什么会成环

JDK 7 扩容时逐个把节点**头插**到新数组，迁移后链表的顺序会反过来。两个线程同时扩容时，它们共享同一批节点：线程一取出节点 A 和它的后继 B 后被挂起；线程二完成了迁移，链表变成 B -> A；线程一恢复后仍按"A 的后继是 B"的旧信息继续头插，最终出现 A.next = B、B.next = A 的环。之后在这个桶里查找一个不存在的 key 就会死循环，CPU 被占满。

JDK 8 改用尾插并保持顺序，扩容时不会再成环，但 HashMap **依然线程不安全**：两个线程同时往同一个空桶 put，后写入的会覆盖先写入的；`++size` 不是原子操作，元素个数也会不准。并发场景要用 [ConcurrentHashMap](/basics/java/02-concurrenthashmap)。

| | JDK 7 | JDK 8 |
| --- | --- | --- |
| 结构 | 数组 + 链表 | 数组 + 链表 + 红黑树 |
| 链表插入 | 头插 | 尾插 |
| 扰动函数 | 多次移位和异或 | 一次 `h ^ (h >>> 16)` |
| 扩容迁移 | 逐个重新计算下标，链表顺序反转 | 按 `hash & oldCap` 拆成高低两条链表，顺序不变 |
| 冲突严重时的查找 | O(n) | 树化后 O(log n) |

## 代码示例：key 要同时重写 hashCode 和 equals

```java
import java.util.HashMap;
import java.util.Map;

public class HashMapKeyDemo {
    static class User {
        final String id;

        User(String id) { this.id = id; }

        @Override
        public boolean equals(Object o) {
            return o instanceof User && ((User) o).id.equals(id);
        }
        // 没有重写 hashCode：两个 id 相同的 User，默认的 hashCode 几乎不可能相同
    }

    public static void main(String[] args) {
        Map<User, Integer> map = new HashMap<>();
        map.put(new User("1001"), 1);
        map.put(new User("1001"), 2);
        System.out.println(map.size());                // 2：被当成了两个不同的 key
        System.out.println(map.get(new User("1001"))); // null：新对象的 hashCode 又不一样
    }
}
```

HashMap 先比较 hash，hash 相等才会调用 equals。只重写 equals 时，"相等"的两个对象 hashCode 不同，通常会落进不同的桶；即使碰巧在同一个桶，也会因为 hash 不相等被当成不同的 key。补上 `public int hashCode() { return id.hashCode(); }` 后，输出变成 1 和 2。

## 面试官可能追问

::: details new HashMap<>(1000) 能放下 1000 个元素而不扩容吗？
不能。传入的 1000 会被向上取整为 1024，阈值是 1024 × 0.75 = 768，放入第 769 个元素时就会扩容到 2048。想一次分配到位，初始容量要传 `预期元素数 / 0.75 + 1`。JDK 19 起可以直接用 `HashMap.newHashMap(1000)`，它会按负载因子算好容量。
:::

::: details 为什么负载因子默认是 0.75？
这是时间和空间的折中。负载因子越大，数组利用率越高，但冲突越多、链表越长，查找变慢；负载因子越小，冲突越少，但更浪费空间，扩容也更频繁。0.75 是 JDK 文档给出的通用折中值，一般不需要修改。
:::

::: details 红黑树查找更快，为什么不一开始就用红黑树？
红黑树节点占用的空间大约是普通节点的两倍，插入和删除时还要旋转、变色来维持平衡。链表很短时，顺序遍历的开销很小，用红黑树反而得不偿失。正常情况下链表极少超过 8 个节点，红黑树只用来应对极端的冲突。
:::

## 易错点

- 树化要同时满足两个条件：链表长度超过 8，**并且**数组长度至少为 64；数组小于 64 时只会扩容
- 扩容看的是元素总数 `size` 是否超过阈值，不是被占用的桶有多少个
- HashMap 允许一个 null key（固定放在 0 号桶）和任意多个 null value；ConcurrentHashMap 和 Hashtable 都不允许
- key 放进 HashMap 后，如果修改了参与 hashCode 计算的字段，hash 就变了，再也找不到这个元素。key 最好用 String、Integer 这类不可变对象
