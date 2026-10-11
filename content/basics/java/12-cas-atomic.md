---
difficulty: 2
tags: [高频, 原理]
---

# CAS 是什么？AtomicInteger 和 LongAdder 是怎么实现的？

::: tip 一句话回答
**CAS**（Compare And Swap）是 CPU 提供的原子指令：给出内存地址、预期值和新值，只有当前值等于预期值时才写入新值，比较和写入不可分割；失败时不阻塞，直接返回 false，由调用方决定是否重试。**AtomicInteger** 内部是一个 volatile 的 int，更新时"读取当前值 → CAS → 失败就重读再试"，也就是**自旋 CAS**。竞争激烈时大量线程 CAS 同一个变量，失败重试多，**LongAdder** 把计数分散到 base 和一组 Cell 上，不同线程更新不同的 Cell，读取时再求和，用更多的内存和不精确的读，换来更高的写入吞吐。
:::

## 详细解析

### CAS 的硬件支持

- x86 上对应带 lock 前缀的 `cmpxchg` 指令，lock 保证多核下这次"读-比较-写"独占这块内存
- ARM 上用独占加载/独占存储指令对（LDXR/STXR）实现，ARMv8.1 起也有单条的 CAS 指令
- Java 层面：JDK 8 通过 `sun.misc.Unsafe` 的 `compareAndSwapInt` 调用，JDK 9 起改为内部的 `jdk.internal.misc.Unsafe`，并提供了公开的 `VarHandle`。原子类的 CAS 同时具有 volatile 读和 volatile 写的内存语义，见 [volatile 和 Java 内存模型](/basics/java/07-volatile-jmm)

### AtomicInteger 的实现

```java
// AtomicInteger（JDK 21 源码节选）
private static final Unsafe U = Unsafe.getUnsafe();
private static final long VALUE = U.objectFieldOffset(AtomicInteger.class, "value"); // value 字段在对象里的偏移量
private volatile int value;
public final int incrementAndGet() {
    return U.getAndAddInt(this, VALUE, 1) + 1;
}

// Unsafe
@IntrinsicCandidate
public final int getAndAddInt(Object o, long offset, int delta) {
    int v;
    do {
        v = getIntVolatile(o, offset);                            // 1. 读出当前值
    } while (!weakCompareAndSetInt(o, offset, v, v + delta));    // 2. CAS 失败（被别人改过，或弱 CAS 偶尔的假失败）就重读再试
    return v;
}
```

- `value` 是 volatile 的，保证读到最新值；`VALUE` 是字段偏移量，Unsafe 靠"对象 + 偏移量"直接操作这块内存
- 这段 Java 代码是通用实现。`@IntrinsicCandidate` 表示 JIT 可以把它替换成平台相关的指令，例如 x86 上可以直接用一条 `lock xadd` 完成加法，不需要循环
- `updateAndGet`、`accumulateAndGet` 也是同样的循环，只是新值由传入的函数计算。竞争导致 CAS 失败时函数可能被再次调用，所以它必须**没有副作用**

### ABA 问题

CAS 只比较"值是否等于预期"，察觉不到值中间变过又变回来了。以用 CAS 修改栈顶的无锁栈为例：

1. 栈是 A → B → C，线程 1 读到栈顶 A、A 的下一个是 B，准备 `CAS(top, A, B)` 弹出 A，此时被挂起
2. 线程 2 弹出 A、弹出 B，再把 A 压回去，栈变成 A → C
3. 线程 1 恢复，栈顶还是 A，CAS 成功，栈变成 B → C：线程 2 已经弹出的 B 又回到了栈里，之后会被再弹出一次；在需要手动回收内存的语言里，B 甚至可能已经被释放或复用

单纯的计数器不怕 ABA，因为数值相同就是相同；但引用、链表节点、状态机这类"经过了什么"很重要的场景会出错。解决办法是给值加一个版本号：`AtomicStampedReference` 同时比较引用和一个 int 版本号；只关心"有没有被改过"时，可以用带一个 boolean 标记的 `AtomicMarkableReference`。

### LongAdder：把一个热点拆成多个

AtomicLong 在高并发下的瓶颈是：所有线程都 CAS 同一个变量，大量 CAS 失败重试，这个变量所在的缓存行还要在各个核之间来回传递。LongAdder（继承自 Striped64）的结构：

```text
LongAdder
├── base：没有竞争时，直接 CAS 它
└── cells：出现竞争后才创建；初始 2 个，竞争加剧时翻倍，上限是不小于 CPU 核数的最小 2 的幂
     ├── Cell[0].value ← 线程用自己的探针哈希值选格子
     ├── Cell[1].value
     └── ...
sum() = base + 所有 Cell 的 value
```

`add(x)` 的过程：

1. cells 还没创建时，先 CAS base，成功就结束
2. CAS base 失败（说明有竞争），或者 cells 已经存在：用当前线程的探针哈希定位一个 Cell，CAS 这个 Cell
3. cells 数组或对应的 Cell 还不存在，或者这次 CAS 也失败：进入 `longAccumulate`，初始化数组、创建 Cell、扩容数组，或者给线程换一个探针哈希，换个格子再试

Cell 类加了 `@Contended` 注解做填充，避免多个 Cell 挤在同一个缓存行里产生**伪共享**（见追问）。代价有三个：Cell 数组一旦扩容不会缩小，更占内存；`sum()` 不加锁，并发更新时不是一个精确的快照；`increment()` 没有返回值，拿不到"这次加完是多少"。除了求和，需要最大值、最小值这类累积时用 `LongAccumulator`，例如 `new LongAccumulator(Long::max, Long.MIN_VALUE)`。

### 怎么选

| | AtomicInteger / AtomicLong | LongAdder | synchronized / Lock |
| --- | --- | --- | --- |
| 竞争激烈时的写入 | 大量失败重试，吞吐下降 | 吞吐高 | 线程挂起，不空耗 CPU |
| 读取 | 精确 | `sum()` 不是快照 | 精确 |
| 能保护什么 | 单个变量 | 只能累加 | 任意的复合逻辑、多个变量 |
| 典型场景 | 序列号、状态标志、并发不高的计数 | QPS、调用次数等监控统计 | 临界区，见 [synchronized 和 ReentrantLock](/basics/java/06-synchronized-lock) |

CAS 适合"操作很短、冲突不多"的场景。临界区里的操作较长，或者竞争非常激烈时，自旋会一直空耗 CPU，用锁让线程挂起反而更好。synchronized 和 ReentrantLock 在无竞争时本身也是靠一次 CAS 加锁的。不想为每个字段都包一个 AtomicInteger 时，可以用 JDK 9 起提供的 `VarHandle`：`MethodHandles.lookup().findVarHandle(类, 字段名, 字段类型)` 拿到句柄后，直接对普通的 volatile 字段做 `compareAndSet`，它是 Unsafe 的公开、安全的替代品。

## 代码示例

```java
import java.util.concurrent.atomic.AtomicStampedReference;
import java.util.concurrent.atomic.LongAdder;

public class CasDemo {
    public static void main(String[] args) throws InterruptedException {
        // 单线程模拟 ABA：用版本号察觉"A -> B -> A"
        String a = "A", b = "B"; // 比较的是引用（==），所以前后要用同一个对象
        AtomicStampedReference<String> ref = new AtomicStampedReference<>(a, 0);
        int stamp = ref.getStamp();                  // 线程 1 记下版本 0
        ref.compareAndSet(a, b, 0, 1);               // 线程 2：A -> B
        ref.compareAndSet(b, a, 1, 2);               // 线程 2：B -> A
        System.out.println(ref.compareAndSet(a, b, stamp, stamp + 1)); // false：值还是 A，版本已经变了

        // LongAdder：4 个线程并发累加，发生竞争后会分散到不同的 Cell 上
        LongAdder pv = new LongAdder();
        Thread[] threads = new Thread[4];
        for (int i = 0; i < threads.length; i++) {
            threads[i] = new Thread(() -> {
                for (int j = 0; j < 10_000; j++) pv.increment();
            });
            threads[i].start();
        }
        for (Thread t : threads) t.join();
        System.out.println(pv.sum()); // 40000：写入全部结束后再求和，结果是精确的
    }
}
```

## 面试官可能追问

::: details 只用 CAS 怎么同时更新两个变量？
CAS 一次只能比较和交换一个值。可以把两个变量封装成一个不可变对象，用 `AtomicReference` 整体替换：读出旧对象，基于它创建新对象，再 CAS 引用，失败就重来。`AtomicStampedReference` 就是这么做的，它内部把"引用 + 版本号"包成一个 Pair 对象。变量多、逻辑复杂时直接用锁更清楚。
:::

::: details 什么是伪共享？LongAdder 为什么要处理它？
CPU 缓存以缓存行为单位（常见是 64 字节）在核之间同步。两个变量落在同一个缓存行里，核 1 改变量 x、核 2 改变量 y，虽然改的不是同一个变量，缓存行也会在两个核之间反复失效、传递，效果接近于在争抢同一个变量。LongAdder 的目的就是让不同线程写不同的 Cell，如果多个 Cell 挤在一个缓存行里，这个优化就白做了，所以 Cell 用 `@Contended` 做了填充。
:::

::: details LongAdder 能用来生成唯一的序号吗？
不能。`increment()` 没有返回值，`sum()` 在并发更新时也不是精确的快照，两个线程可能读到同一个和。生成序号要用 `AtomicLong.incrementAndGet()` 这类返回新值的原子操作，它保证每次调用拿到的值都不同。LongAdder 适合"写很多、偶尔读一次总数"的统计场景，[ConcurrentHashMap](/basics/java/02-concurrenthashmap) 统计元素个数用的也是这个思路。
:::

## 易错点

- CAS 只保证单个变量单次更新的原子性；先 `get()` 再 `set()` 依然会丢失更新，要用 `compareAndSet` 循环或 `updateAndGet`
- `updateAndGet`、`accumulateAndGet` 传入的函数可能被执行多次，里面不能有副作用（比如打日志计数、发消息）
- `AtomicStampedReference` 用 `==` 比较引用。用 `Integer` 当值时，超出 -128～127 缓存范围的数每次自动装箱都是新对象，CAS 会莫名失败
- `LongAdder.sum()` 在有并发写入时只是近似值，不能用它做"达到阈值才放行"这类精确判断
