---
difficulty: 2
tags: [高频, 实践]
---

# 线程池的核心参数有哪些？任务提交后是怎么执行的？

::: tip 一句话回答
ThreadPoolExecutor 有 7 个参数：核心线程数、最大线程数、空闲线程存活时间和时间单位、任务队列、线程工厂、拒绝策略。提交任务后：线程数小于核心线程数就**创建核心线程**；否则**放进队列**；队列满了且线程数小于最大线程数，再**创建非核心线程**；都满了就执行**拒绝策略**。生产环境不推荐用 Executors 的工厂方法创建线程池，因为它们的队列或线程数是无界的，可能导致 OOM。
:::

## 详细解析

### 七个参数

| 参数 | 含义 |
| --- | --- |
| `corePoolSize` | 核心线程数。核心线程默认一直保留，空闲也不回收 |
| `maximumPoolSize` | 最大线程数，即核心线程和非核心线程加起来的上限 |
| `keepAliveTime`、`unit` | 非核心线程空闲超过这个时间就被回收；调用 `allowCoreThreadTimeOut(true)` 后，核心线程也适用 |
| `workQueue` | 存放待执行任务的阻塞队列 |
| `threadFactory` | 创建线程的工厂，通常用来给线程起有意义的名字 |
| `handler` | 拒绝策略：线程和队列都满了，或者线程池已经关闭时调用 |

### 任务提交流程

```text
execute(task)
  │
  ├─ 线程数 < corePoolSize ？ ──── 是 ──> 创建核心线程，直接执行这个任务
  │  否
  ├─ 放入队列成功？ ────────────── 是 ──> 任务进入队列，等待空闲线程来取
  │  否（队列满）
  ├─ 线程数 < maximumPoolSize ？ ─ 是 ──> 创建非核心线程，直接执行这个任务
  │  否
  └─ 执行拒绝策略
```

- 线程是按需创建的：线程池刚创建时一个线程都没有（可以调用 `prestartAllCoreThreads()` 预先创建）；线程数没达到核心线程数时，即使已有线程空闲，新任务来了也会创建新线程
- 线程执行完手上的任务后，会循环从队列里取任务继续执行，这就是线程复用。正因为**先进队列、队列满了才扩充线程**，如果用无界队列，队列永远不会满，`maximumPoolSize` 就形同虚设

### 四种内置拒绝策略

除了下面四种，也可以实现 `RejectedExecutionHandler` 自定义策略，比如记录日志、把任务持久化后稍后重试。

| 策略 | 行为 | 适用场景 |
| --- | --- | --- |
| AbortPolicy（默认） | 抛出 RejectedExecutionException | 需要调用方感知并处理失败 |
| CallerRunsPolicy | 由提交任务的线程自己执行这个任务 | 不能丢任务；调用方被占住后提交变慢，起到限流作用 |
| DiscardPolicy | 直接丢弃，不报错 | 可有可无的任务，比如非关键的统计 |
| DiscardOldestPolicy | 丢弃队列里最早的任务，再重新提交当前任务 | 只关心最新数据的场景 |

### 为什么不推荐 Executors 的工厂方法

推荐直接 new 一个 ThreadPoolExecutor，明确指定有界队列、线程数和拒绝策略。Executors 的几个工厂方法都有"无界"的问题：

| 方法 | 问题 |
| --- | --- |
| `newFixedThreadPool`、`newSingleThreadExecutor` | 用的是无界的 LinkedBlockingQueue（容量为 `Integer.MAX_VALUE`），任务处理不过来时会在队列里无限堆积，最终 OOM |
| `newCachedThreadPool` | 最大线程数是 `Integer.MAX_VALUE`，任务一多就不断创建线程，耗尽内存或系统的线程资源 |
| `newScheduledThreadPool` | 内部的延迟队列同样是无界的 |

### 线程数怎么定

- **CPU 密集型**（计算、加解密、压缩）：线程多了只会增加切换开销，常见的经验值是 CPU 核数 + 1
- **I/O 密集型**（调用接口、查数据库）：线程大部分时间在等待，可以多开一些，经验公式是 `核数 × (1 + 平均等待时间 / 平均计算时间)`

这些公式只是起点。还要考虑下游的承载能力（比如数据库连接池只有 20 个连接，开 200 个线程查库也没用），通过压测确定，并监控活跃线程数和队列长度；必要时可以用 `setCorePoolSize`、`setMaximumPoolSize` 在运行时动态调整。

### JDK 21 的虚拟线程

虚拟线程由 JVM 调度，运行在少量平台线程上。虚拟线程执行阻塞 I/O 时会从平台线程上卸下，平台线程转去运行其他虚拟线程，所以可以创建大量虚拟线程，用"一个请求一个线程"的简单写法支撑大量并发的阻塞 I/O。它对 CPU 密集型任务没有帮助。虚拟线程创建成本很低，**不需要池化**，每个任务新建一个即可，例如 `Executors.newVirtualThreadPerTaskExecutor()`；要限制对下游的并发量，用 Semaphore，而不是靠线程池的大小。JDK 21 中虚拟线程在 synchronized 块里阻塞会钉住平台线程，见 [synchronized 和 ReentrantLock](/basics/java/06-synchronized-lock)。

## 代码示例

```java
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

public class ThreadPoolDemo {
    public static void main(String[] args) throws InterruptedException {
        AtomicInteger seq = new AtomicInteger();
        // 给线程起有意义的名字，排查问题时从线程栈就能看出是哪个线程池
        ThreadFactory factory = r -> new Thread(r, "order-pool-" + seq.incrementAndGet());

        ThreadPoolExecutor pool = new ThreadPoolExecutor(
                2,                             // corePoolSize
                4,                             // maximumPoolSize
                60, TimeUnit.SECONDS,          // 非核心线程空闲 60 秒后回收
                new ArrayBlockingQueue<>(2),   // 有界队列，容量为 2
                factory,
                new ThreadPoolExecutor.CallerRunsPolicy()); // 都满了就由提交任务的线程自己执行

        for (int i = 1; i <= 7; i++) {
            int id = i;
            pool.execute(() -> {
                System.out.println("任务 " + id + " 由 " + Thread.currentThread().getName() + " 执行");
                try {
                    Thread.sleep(500); // 模拟耗时操作
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt(); // 恢复中断标志
                }
            });
        }
        pool.shutdown();
        pool.awaitTermination(1, TimeUnit.MINUTES);
    }
}
```

每个任务要执行 500 毫秒，而 main 几乎瞬间就提交完 7 个任务，所以：任务 1、2 创建核心线程执行；3、4 进入队列；5、6 到来时队列已满，创建非核心线程执行；任务 7 到来时线程数和队列都满了，按 CallerRunsPolicy 由 main 线程自己执行，输出"任务 7 由 main 执行"。3、4 要等前面的任务执行完，才被空闲的线程取走。各行的打印顺序取决于线程调度，每次运行可能不同。

## 面试官可能追问

::: details 线程池里的线程是怎么复用的？
线程池把每个线程封装成一个 Worker。Worker 启动后先执行创建时带的第一个任务，然后在循环里调用 `getTask()` 从队列取任务执行。线程池并不标记哪个线程是"核心线程"：取任务时，如果当前线程数超过了核心线程数（或者允许核心线程超时），就用带超时的 `poll(keepAliveTime)`，超时还没取到任务就返回 null，这个线程随之退出；否则用 `take()` 一直阻塞等待。
:::

::: details execute 和 submit 有什么区别？任务抛出异常会怎样？
`execute` 只接收 Runnable，没有返回值；任务抛出的异常会传到工作线程，由默认的未捕获异常处理器打印堆栈，这个线程随之结束，线程池再补一个新线程。`submit` 会把任务包装成 FutureTask 并返回 Future，异常被保存在 Future 里，不调用 `get()` 就看不到，很容易被"吞掉"。用 submit 时要调用 `get()` 处理异常，或者在任务内部 try-catch 并记录日志。
:::

::: details 怎么优雅地关闭线程池？
先调用 `shutdown()`：不再接收新任务，但会把已提交的任务执行完；再调用 `awaitTermination` 等待一段时间。超时还没结束就调用 `shutdownNow()`：它会中断正在执行的线程，并返回队列中还没执行的任务。任务代码需要正确响应中断（检查中断标志、处理 InterruptedException），否则 `shutdownNow()` 也停不下来。
:::

::: details 任务队列怎么选？
`ArrayBlockingQueue` 是基于数组的有界队列；`LinkedBlockingQueue` 不传容量时是无界的，使用时一定要指定容量；`SynchronousQueue` 不存储任务，每次提交都要直接交给一个线程，`newCachedThreadPool` 用的就是它；`PriorityBlockingQueue` 按优先级出队，但它是无界的。
:::

## 易错点

- 执行顺序是"核心线程 → 队列 → 非核心线程 → 拒绝策略"，不是核心线程满了就先创建非核心线程
- 用无界队列时最大线程数不起作用，任务堆积还可能导致 OOM
- 线程会被复用，任务里设置的 ThreadLocal 要在 finally 里清理，否则会串到下一个任务，见 [ThreadLocal](/basics/java/09-threadlocal)
- 虚拟线程不要放进线程池复用，限流也不要依赖池的大小
