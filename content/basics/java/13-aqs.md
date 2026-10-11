---
difficulty: 3
tags: [高频, 原理, 对比]
---

# AQS 的原理是什么？CountDownLatch、Semaphore、CyclicBarrier 怎么用？

::: tip 一句话回答
AQS（AbstractQueuedSynchronizer）是 j.u.c 里锁和同步器的骨架：一个 **volatile 的 int state** 加一个 **FIFO 等待队列**（CLH 队列的变体）。子类只需要按自己的语义实现 `tryAcquire` / `tryRelease`（独占模式）或 `tryAcquireShared` / `tryReleaseShared`（共享模式），用 CAS 修改 state；获取失败后的排队、挂起、唤醒由 AQS 统一完成。**CountDownLatch** 是一次性的倒计时门闩，**Semaphore** 用许可数控制并发量，两者都是共享模式的 AQS；**CyclicBarrier** 让一组线程互相等待、到齐后一起继续，可以重复使用，它是用 ReentrantLock 和 Condition 实现的。
:::

## 详细解析

### AQS 的结构

```text
AbstractQueuedSynchronizer
├── volatile int state       含义由子类决定：重入次数、剩余许可、剩余计数……；独占模式下另外记录持有者线程
└── 等待队列（双向链表）
    head（哑节点或当前持有者）⇄ Node(T2, 等待中) ⇄ Node(T3, 等待中) ⇄ ... ⇄ tail
```

- 原始的 CLH 锁是自旋锁，每个节点自旋检查前驱的状态。AQS 借用了它"只需 CAS 一次 tail 就能入队"的结构，又加上前后指针和状态字段：线程不会一直自旋，而是用 `LockSupport.park` 挂起，等前驱释放时被 `unpark` 唤醒
- 每个 `Condition` 另有一条条件队列：`await()` 时当前线程加入条件队列并完全释放锁；`signal()` 把它转移到同步队列，重新排队抢锁

### 模板方法：子类只管 state

AQS 的 `acquire`、`release` 等公开方法都是 final 的，固定了流程；子类只重写判断 state 能否获取、释放的 try 方法。官方文档给出的独占模式流程：

```text
acquire(arg):  while (!tryAcquire(arg)) { 没入队就入队；可能挂起当前线程 }
release(arg):  if (tryRelease(arg)) { 唤醒队列中的第一个等待线程 }
```

| 子类实现的方法 | 模式 | 返回值含义 |
| --- | --- | --- |
| `tryAcquire(int)` | 独占 | true 表示获取成功 |
| `tryRelease(int)` | 独占 | true 表示已经完全释放，可以唤醒后继 |
| `tryAcquireShared(int)` | 共享 | 负数失败；0 成功但后面的共享获取不会成功；正数成功且后面的也可能成功 |
| `tryReleaseShared(int)` | 共享 | true 表示等待的线程可能可以获取了 |

共享模式下唤醒会**传播**：一个节点获取成功后，会继续唤醒后面同样在等共享获取的节点，所以 CountDownLatch 计数归零时，所有 await 的线程都会被依次唤醒。state 的含义由子类决定：ReentrantLock 中是重入次数（加锁流程见 [synchronized 和 ReentrantLock](/basics/java/06-synchronized-lock)），ReentrantReadWriteLock 把它拆成两半，高 16 位记读锁持有数，低 16 位记写锁重入数。

**公平与非公平**：`acquire` 在入队之前先调用一次 `tryAcquire`，新来的线程可能插队抢在排队的线程前面，这就是非公平，吞吐量更高。公平的实现是在 `tryAcquire` 里先调用 `hasQueuedPredecessors()`，前面有人排队就直接返回 false。

### 三个工具类对比

| | CountDownLatch | CyclicBarrier | Semaphore |
| --- | --- | --- | --- |
| 作用 | 一个或多个线程等待其他 N 件事完成 | N 个线程互相等待，到齐后一起继续 | 限制同时访问某个资源的线程数 |
| 怎么用 | 做事的线程 `countDown()`，等待的线程 `await()`，可以是不同的线程 | 参与的线程各自调用 `await()` | `acquire()` 拿许可，`release()` 还许可 |
| 能否重用 | 不能，计数归零后无法重置 | 能，到齐后自动开始下一轮 | 能，许可循环使用 |
| 到齐时 | 唤醒所有等待者 | 先由最后到达的线程执行构造时传入的 barrierAction | 无 |
| 异常情况 | `await` 可被中断、可以设超时 | 有一个线程中断或超时，屏障被打破，其他线程抛 BrokenBarrierException | `acquire` 可被中断，`tryAcquire` 可以设超时 |
| 实现 | AQS 共享模式，state 是剩余计数 | ReentrantLock + Condition | AQS 共享模式，state 是剩余许可，支持公平和非公平 |
| 典型场景 | 主线程等多个并行子任务完成；启动时等几个依赖都就绪 | 多线程分阶段计算，每个阶段结束汇总一次 | 限制对下游接口、数据库的并发调用数 |

### 和虚拟线程配合

- 这几个工具阻塞时都是通过 `LockSupport.park` 挂起的。虚拟线程在这里挂起时会从载体线程上卸下，载体线程转去运行别的虚拟线程，所以可以放心地在虚拟线程中使用。虚拟线程不需要池化，也就不能靠线程池的大小来限流，要限制对下游的并发量，JEP 444 推荐的正是 Semaphore 这类工具，见 [线程池](/basics/java/08-thread-pool)
- JDK 21 中，在 synchronized 块里调用 `await()`、`acquire()` 这类阻塞方法会让虚拟线程钉住载体线程，JDK 24 起不再有这个问题，见 [synchronized 和 ReentrantLock](/basics/java/06-synchronized-lock)

## 代码示例

```java
import java.util.concurrent.BrokenBarrierException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;

public class SyncToolsDemo { // 需要 JDK 21：用到了虚拟线程
    public static void main(String[] args) throws InterruptedException {
        // 1. Semaphore + CountDownLatch：100 个任务，最多 3 个同时调用下游，主线程等全部结束
        Semaphore permits = new Semaphore(3);
        CountDownLatch done = new CountDownLatch(100);
        ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
        for (int i = 0; i < 100; i++) {
            executor.submit(() -> {
                try {
                    permits.acquire(); // 没有许可就挂起，虚拟线程会让出载体线程
                    try {
                        Thread.sleep(10); // 模拟调用下游
                    } finally {
                        permits.release(); // 拿到了许可才归还，所以放在内层 finally
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } finally {
                    done.countDown(); // 不管成功失败都要减，否则 await 永远等不到 0
                }
            });
        }
        done.await();
        executor.shutdown();

        // 2. CyclicBarrier：3 个线程分 2 个阶段，每个阶段 3 个线程都到达后才打印汇总行，再进入下一阶段
        CyclicBarrier barrier = new CyclicBarrier(3, () -> System.out.println("--- 本阶段全部完成 ---"));
        Thread[] workers = new Thread[3];
        for (int i = 0; i < workers.length; i++) {
            int id = i;
            workers[i] = Thread.ofVirtual().start(() -> {
                try {
                    for (int phase = 1; phase <= 2; phase++) {
                        System.out.println("worker-" + id + " 完成阶段 " + phase);
                        barrier.await(); // 到齐前在这里等；到齐后屏障自动复位，下一阶段接着用
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                } catch (BrokenBarrierException e) {
                    System.out.println("有线程中断或超时，屏障被打破");
                }
            });
        }
        for (Thread t : workers) t.join();
    }
}
```

## 面试官可能追问

::: details 怎么基于 AQS 自己实现一个同步器？
写一个继承 AQS 的私有内部类 Sync，按需要的语义重写 try 方法，外部类把公开方法委托给它。比如一个只能打开一次的门闩：`tryAcquireShared` 在 state 为 1 时返回 1、否则返回 -1；`tryReleaseShared` 里 `setState(1)` 并返回 true；外部类的 `await()` 调用 `sync.acquireSharedInterruptibly(1)`，`open()` 调用 `sync.releaseShared(1)`。排队、挂起、唤醒全部由 AQS 完成，几行代码就够了。
:::

::: details CountDownLatch 的 await 一直不返回，怎么排查？
用 jstack 能看到等待的线程状态是 WAITING，停在 `CountDownLatch.await` 上。常见原因：`countDown()` 没放在 finally 里，某个任务抛异常后少减了一次；初始计数比实际提交的任务多；任务被线程池拒绝了，根本没执行。生产代码建议用带超时的 `await(timeout, unit)`，根据返回值判断是否全部完成，避免无限期挂住。注意传统的线程栈不包含虚拟线程，等待的是虚拟线程时要用 `jcmd <pid> Thread.dump_to_file -format=json <文件>` 导出。线程栈怎么看见 [线上 Java 服务怎么排查](/basics/java/11-jvm-troubleshoot)。
:::

::: details new Semaphore(1) 能当锁用吗？和 ReentrantLock 有什么区别？
可以实现互斥，但有两点不同：Semaphore 没有"持有者"的概念，任何线程都能调用 `release()`，A 线程获取、B 线程释放也是合法的；它也不可重入，同一个线程连续 `acquire()` 两次会把自己卡住。ReentrantLock 记录了持有线程，只有持有者能解锁，还支持重入和 Condition。需要锁就用锁，Semaphore 用来控制数量。
:::

## 易错点

- CyclicBarrier 并不是直接基于 AQS 实现的，它内部用的是 ReentrantLock 和 Condition
- `countDown()`、`release()` 要放在 finally 里，否则异常路径上会少减、少还
- Semaphore 不检查释放许可的线程是否获取过，多调用的 `release()` 会让许可数超过初始值，限流就失效了
- 即使创建的是公平的 Semaphore，不带超时参数的 `tryAcquire()` 也会直接抢可用的许可，不遵守公平顺序
