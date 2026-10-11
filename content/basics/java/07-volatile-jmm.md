---
difficulty: 2
tags: [高频, 原理]
---

# volatile 有什么作用？什么是 Java 内存模型？

::: tip 一句话回答
Java 内存模型（JMM）规定了多线程读写共享变量时，一个线程的写入在什么条件下对另一个线程可见，核心是 **happens-before** 规则，用来应对可见性、有序性和原子性问题。volatile 有两个作用：保证**可见性**（一个线程写入后，其他线程再读一定能读到新值）和**禁止指令重排**（通过内存屏障实现）；但它**不保证复合操作的原子性**，`count++` 加了 volatile 照样会出错。
:::

## 详细解析

### 并发的三个问题

- **可见性**：CPU 核心有各自的缓存，JIT 还可能把变量缓存在寄存器里，一个线程改了变量，另一个线程可能一直读到旧值
- **有序性**：编译器和 CPU 会在不影响单线程结果的前提下调整指令顺序，这种重排在多线程下可能被其他线程观察到
- **原子性**：`count++` 实际是"读取、加一、写回"三步，两个线程交错执行就会丢失更新

JMM 把这些硬件细节抽象成：共享变量存在主内存中，每个线程有自己的工作内存（对应缓存和寄存器），线程操作的是工作内存中的副本。JMM 并不要求每次读写都立即同步，而是规定：只要两个操作满足 happens-before 关系，前一个操作的结果就对后一个可见。

### volatile 的两个作用

**保证可见性**：写一个 volatile 变量后，其他线程再读它，一定能读到新值，而且写之前的所有修改也一起变得可见。典型的例子是停止标志：工作线程循环检查一个普通的 boolean 变量，主线程把它改成 false，JIT 可能早已把这个读取提到了循环外面，工作线程永远停不下来；给变量加上 volatile 就能正常退出。

**禁止指令重排**：volatile 写之前的读写不能被重排到它后面，volatile 读之后的读写不能被重排到它前面。JVM 在 volatile 读写的前后插入内存屏障来保证这一点，例如 x86 上 HotSpot 会在 volatile 写之后加一条带 lock 前缀的指令。

**不保证原子性**：volatile 只保证单次读、单次写是原子的。`count++` 这类"读-改-写"操作，两个线程可能读到同一个值，各自加一后写回，结果只增加了 1。需要原子性时用 synchronized、Lock（两者的区别见 [synchronized 和 ReentrantLock](/basics/java/06-synchronized-lock)）或原子类。

### happens-before 规则

A happens-before B 的意思是：A 的结果对 B 可见，而且 A 在逻辑上排在 B 前面。它不代表 A 在时间上一定先执行，只要不影响这个保证，JVM 仍然可以重排。常用的几条：

1. **程序顺序规则**：同一个线程中，前面的操作 happens-before 后面的操作
2. **监视器锁规则**：对一个锁的解锁 happens-before 之后对同一个锁的加锁
3. **volatile 规则**：对一个 volatile 变量的写 happens-before 之后对它的读
4. **线程启动规则**：`Thread.start()` happens-before 被启动的线程中的每个操作
5. **线程终止规则**：线程中的所有操作 happens-before 其他线程从这个线程的 `join()` 返回
6. **传递性**：A happens-before B，B happens-before C，那么 A happens-before C

把 1、3、6 结合起来：线程 A 先修改普通变量 x，再写 volatile 变量 flag；线程 B 读到 flag 的新值后，一定也能看到 x 的修改。这就是 volatile 常被用作"数据已准备好"标志的原因。

### 双重检查锁单例为什么要加 volatile

```java
public class Singleton {
    private static volatile Singleton instance;

    private Singleton() {}

    public static Singleton getInstance() {
        if (instance == null) {                 // 第一次检查：已经创建过就不用加锁
            synchronized (Singleton.class) {
                if (instance == null) {         // 第二次检查：防止多个线程重复创建
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}
```

`instance = new Singleton()` 大致分三步：分配内存、执行构造方法初始化对象、把引用赋给 instance。后两步可能被重排，变成先赋值再初始化。没有 volatile 时，线程 A 刚把引用赋给 instance、构造方法还没执行完，线程 B 在第一次检查（不加锁）时就看到 instance 不为 null，直接返回并使用了一个**还没初始化完成**的对象。加上 volatile 后，构造对象的写入 happens-before 其他线程读到 instance，就不会拿到半初始化的对象。

### volatile 和 synchronized 的区别

| | volatile | synchronized |
| --- | --- | --- |
| 用在哪里 | 变量 | 方法、代码块 |
| 可见性 | 保证 | 保证：解锁前的修改，对之后加同一把锁的线程可见 |
| 有序性 | 禁止 volatile 读写与前后指令的特定重排 | 临界区内部仍可重排，但对其他线程来说整体是串行的 |
| 原子性 | 只保证单次读、写 | 保证整个临界区 |
| 是否阻塞 | 不会 | 抢不到锁会阻塞 |

## 代码示例：volatile 不保证原子性

```java
import java.util.concurrent.atomic.AtomicInteger;

public class CounterDemo {
    private static volatile int count = 0;
    private static final AtomicInteger atomicCount = new AtomicInteger();

    public static void main(String[] args) throws InterruptedException {
        Thread[] threads = new Thread[4];
        for (int i = 0; i < threads.length; i++) {
            threads[i] = new Thread(() -> {
                for (int j = 0; j < 10_000; j++) {
                    count++;                       // 读取、加一、写回三步，不是原子的
                    atomicCount.incrementAndGet(); // 基于 CAS，是原子的
                }
            });
            threads[i].start();
        }
        for (Thread t : threads) t.join();

        System.out.println(count);             // 通常小于 40000
        System.out.println(atomicCount.get()); // 40000
    }
}
```

## 面试官可能追问

::: details CAS 是什么？有什么问题？
CAS（Compare And Swap）是 CPU 提供的原子指令：只有内存中的值等于预期值时才更新为新值，否则失败。原子类就是用"读取当前值、尝试 CAS、失败就重试"的方式实现无锁更新的。它有三个问题：**ABA**（值从 A 变成 B 又变回 A，CAS 察觉不到，可以用带版本号的 `AtomicStampedReference` 解决）；竞争激烈时大量重试，浪费 CPU；只能保证一个变量的原子性，多个变量要封装成一个对象，用 `AtomicReference` 整体替换。
:::

::: details LongAdder 和 AtomicLong 有什么区别？
AtomicLong 让所有线程 CAS 同一个值，竞争激烈时大量失败重试。LongAdder 把计数分散到一个 base 和一组 Cell 上，不同线程更新不同的 Cell，读取时再求和，高并发下写入性能更好。代价是 `sum()` 在并发更新时不是精确的快照，所以它适合做统计计数，不适合生成序列号这类需要精确值的场景。[ConcurrentHashMap](/basics/java/02-concurrenthashmap) 的元素计数也是同样的思路。
:::

::: details 单例还有哪些更推荐的写法？
- **静态内部类**：把实例放在一个私有的静态内部类 Holder 里，第一次调用 `getInstance()` 时 Holder 才被初始化，JVM 保证类的初始化是线程安全的（见 [类加载过程](/basics/java/05-classloading)），既是懒加载又不用加锁
- **枚举**：`enum Singleton { INSTANCE }`，由 JVM 保证只有一个实例，还能防止通过反射和反序列化创建新的实例
:::

::: details volatile 适合用在哪些场景？
状态标志（如停止标志）、一个线程写入多个线程读取的配置或开关、双重检查锁里的实例引用。只要涉及"读到旧值后据此计算新值"，或者多个变量之间有约束关系，volatile 就不够了，要用锁或原子类。
:::

## 易错点

- volatile 保证可见性和有序性，**不保证** `count++` 这类复合操作的原子性
- happens-before 说的是可见性和顺序上的保证，不是时间上的先后
- 双重检查锁中的 instance 必须加 volatile，否则其他线程可能拿到构造方法还没执行完的对象
- JLS 允许把非 volatile 的 long、double 的一次写入拆成两次 32 位写入，加上 volatile 后才保证读写是原子的（主流的 64 位 JVM 实际上一般不会拆分）
