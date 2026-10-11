---
difficulty: 2
tags: [高频, 对比]
---

# synchronized 和 ReentrantLock 有什么区别？

::: tip 一句话回答
两者都是**可重入的互斥锁**。synchronized 是 JVM 内置的关键字，基于对象监视器实现，加锁和释放都是自动的，抛异常时也会释放，JVM 还会对它做轻量级锁、锁消除、锁粗化等优化。ReentrantLock 是 JDK 基于 **AQS** 实现的类，需要手动 lock 和 unlock，但功能更多：等待时可以被中断、可以超时获取、支持公平锁和多个条件变量。一般场景优先用 synchronized，需要这些功能时再用 ReentrantLock。
:::

## 详细解析

### synchronized 的实现

- 修饰代码块时，编译后是 `monitorenter` 和 `monitorexit` 两条字节码指令。编译器还会生成一条异常处理路径，保证抛异常时也会执行 `monitorexit`，所以不会因为异常忘记释放锁
- 修饰方法时，方法的访问标志里带有 `ACC_SYNCHRONIZED`，JVM 调用方法时自动加锁、返回时自动释放
- 锁的都是对象：实例方法锁 `this`，静态方法锁当前类的 Class 对象，代码块锁括号里指定的对象
- 每个对象都可以关联一个监视器（monitor），记录持有锁的线程、重入次数、等待获取锁的线程，以及调用了 `wait()` 的线程。同一个线程再次进入时只增加重入次数，所以是可重入的

### synchronized 的锁优化

锁的状态记录在对象头的 Mark Word 里。HotSpot 的优化手段：

- **轻量级锁**：没有竞争时，线程用一次 CAS 把对象头指向自己栈帧里的锁记录，就算加锁成功，不需要创建监视器，也不需要操作系统参与。这是 JDK 22 及以前的默认实现；JDK 23 起默认改用新的轻量级锁实现，不再借助栈上的锁记录，但同样是无竞争时一次 CAS 加锁
- **重量级锁**：出现竞争后，锁膨胀为重量级锁，使用监视器对象。抢不到锁的线程先自适应地自旋一小会儿，还拿不到才挂起；挂起和唤醒要靠操作系统完成，开销较大
- **偏向锁**：曾用来优化"总是同一个线程加锁"的场景，在对象头里记下线程 ID，之后这个线程加锁连 CAS 都不用。但有其他线程来竞争时，撤销偏向往往要在安全点进行，代价很高。偏向锁在 JDK 8 中默认开启，**JDK 15 起默认禁用并被废弃**（JDK 15～17 还能用 `-XX:+UseBiasedLocking` 手动打开），JDK 18 移除了它的实现（JDK 19 起再加这个参数会启动报错），JDK 21 中已经没有偏向锁
- **锁消除**：JIT 通过逃逸分析发现锁对象不可能被其他线程访问时，直接去掉加锁操作，例如方法内部使用的局部 StringBuffer
- **锁粗化**：对同一个对象反复加锁、解锁（比如连续调用 StringBuffer 的 append），JIT 会把它们合并成一次范围更大的加锁

### ReentrantLock 和 AQS

ReentrantLock 基于 AbstractQueuedSynchronizer（AQS）实现（下面用到的 volatile 和 CAS 见 [volatile 和 Java 内存模型](/basics/java/07-volatile-jmm)）：

1. 用一个 volatile 的 `int state` 表示锁状态：0 表示没有被持有，大于 0 表示已被持有，数值就是重入次数；同时记录持有锁的线程
2. 加锁时用 CAS 把 state 从 0 改成 1，成功就获得锁；如果是当前线程已经持有锁，就把 state 加 1
3. 获取失败的线程被包装成节点，加入 AQS 的 FIFO 等待队列，然后用 `LockSupport.park` 挂起
4. 释放时 state 减 1，减到 0 才真正释放，并唤醒队列中的下一个线程

### 对比

| | synchronized | ReentrantLock |
| --- | --- | --- |
| 实现层面 | JVM 关键字，基于对象监视器 | JDK 类库，基于 AQS |
| 加锁和释放 | 自动，抛异常时也会释放 | 手动调用 `lock()` 和 `unlock()`，unlock 必须放在 finally 里 |
| 可重入 | 是 | 是 |
| 公平性 | 只有非公平 | 默认非公平，构造时可以选择公平 |
| 等待时响应中断 | 不能 | `lockInterruptibly()` 可以 |
| 尝试获取、超时获取 | 不支持 | `tryLock()`、`tryLock(timeout, unit)` |
| 条件变量 | 只有一个（`wait` / `notify`） | 可以创建多个 `Condition` |

### 怎么选

- 普通的互斥场景优先用 synchronized（写法简单，不会忘记释放，JVM 也在持续优化它）；需要可中断、超时、公平锁或多个条件队列时，再用 ReentrantLock
- JDK 21 的虚拟线程在 synchronized 块里阻塞时，会**钉住**（pin）它所在的平台线程，让这个平台线程也没法去运行其他虚拟线程。所以在 JDK 21 中，包含长时间阻塞 I/O 的临界区建议改用 ReentrantLock；JDK 24 起 synchronized 不再导致这种钉住。虚拟线程见 [线程池](/basics/java/08-thread-pool) 一题

## 代码示例：用两个 Condition 实现阻塞队列

```java
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;

public class BoundedBuffer<T> {
    private final Deque<T> items = new ArrayDeque<>();
    private final int capacity;
    private final ReentrantLock lock = new ReentrantLock();
    private final Condition notFull = lock.newCondition();  // 生产者在这里等"队列不满"
    private final Condition notEmpty = lock.newCondition(); // 消费者在这里等"队列不空"

    public BoundedBuffer(int capacity) { this.capacity = capacity; }

    public void put(T item) throws InterruptedException {
        lock.lockInterruptibly(); // 等锁期间可以响应中断
        try {
            while (items.size() == capacity) {
                notFull.await(); // 释放锁并等待，被唤醒后重新竞争锁，再检查条件
            }
            items.addLast(item);
            notEmpty.signal(); // 只唤醒等待"不空"的消费者
        } finally {
            lock.unlock();
        }
    }

    public T take() throws InterruptedException {
        lock.lockInterruptibly();
        try {
            while (items.isEmpty()) {
                notEmpty.await();
            }
            T item = items.removeFirst();
            notFull.signal(); // 只唤醒等待"不满"的生产者
            return item;
        } finally {
            lock.unlock();
        }
    }

    public static void main(String[] args) throws InterruptedException {
        BoundedBuffer<Integer> buffer = new BoundedBuffer<>(2);
        Thread producer = new Thread(() -> {
            try {
                for (int i = 1; i <= 5; i++) buffer.put(i); // 队列满了就阻塞，等消费者取走
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
        producer.start();
        for (int i = 0; i < 5; i++) System.out.println(buffer.take()); // 依次输出 1 到 5
        producer.join();
    }
}
```

用 synchronized 实现时只有一个等待集合，生产者和消费者混在一起，`notify()` 可能唤醒同类线程，通常只能用 `notifyAll()` 全部唤醒。

## 面试官可能追问

::: details 公平锁和非公平锁有什么区别？为什么默认是非公平锁？
**公平锁**在获取前会先检查队列里有没有排在前面的线程，严格排队；**非公平锁**让新来的线程直接尝试 CAS 抢锁，抢不到才去排队。公平锁释放后要唤醒队首的线程，而线程从挂起到恢复运行需要时间，这段时间里锁是空闲的；非公平锁允许刚到的线程直接抢锁，正好利用了这段空档，减少了线程切换，吞吐量更高。代价是排队的线程可能长时间抢不到锁（饥饿）。
:::

::: details 偏向锁为什么被废弃？
偏向锁的收益主要体现在早期大量使用 Vector、Hashtable 这类方法全加锁的集合的代码中。现在的应用更多使用不加锁的 ArrayList、HashMap，或者性能更好的并发集合，收益已经不明显。同时，撤销偏向锁往往要在安全点进行，有竞争时开销反而更大，相关代码也给 HotSpot 的同步子系统带来了很高的维护成本。
:::

::: details 除了 ReentrantLock，还有哪些工具基于 AQS？
CountDownLatch、Semaphore、ReentrantReadWriteLock，以及线程池内部的 Worker 等。它们复用 AQS 的等待队列和挂起、唤醒逻辑，只是 state 的含义不同：ReentrantLock 中是重入次数，Semaphore 中是剩余的许可数，CountDownLatch 中是剩余的计数。
:::

## 易错点

- `lock()` 要放在 try 之前，`unlock()` 放在 finally 里。如果把 `lock()` 写进 try，加锁之前或加锁时抛出异常，finally 里的 unlock 会因为当前线程没持有锁而抛出 IllegalMonitorStateException，把原来的异常掩盖掉
- synchronized 锁的是对象，不是代码：两个不同的实例调用同一个同步实例方法不会互斥；静态同步方法锁的是 Class 对象，和实例方法用的不是同一把锁
- 不要用字符串常量、`Integer` 这类可能被缓存和共享的对象当锁，否则可能和毫不相关的代码争同一把锁
- `wait()` 和 `await()` 都要放在 while 循环里检查条件，因为线程可能被虚假唤醒，或者被唤醒时条件已经又被别的线程改变了
