---
difficulty: 1
tags: [高频]
---

# Java 线程有哪些状态？创建线程有哪几种方式？

::: tip 一句话回答
`Thread.State` 定义了六种状态：**NEW、RUNNABLE、BLOCKED、WAITING、TIMED_WAITING、TERMINATED**。BLOCKED 是在等 `synchronized` 的锁，WAITING 是调用了 `wait`、`join`、`LockSupport.park` 等主动进入等待、要别人唤醒。创建线程的方式有：继承 `Thread`、实现 `Runnable`、`Callable` 配合 `FutureTask` 拿返回值、交给线程池；本质上都要通过 `Thread` 对象启动，实际项目里用线程池。
:::

## 详细解析

### 六种状态

| 状态 | 含义 | 怎么进入 |
| --- | --- | --- |
| NEW | 创建了还没启动 | `new Thread(...)` |
| RUNNABLE | 可运行，包括正在 CPU 上跑和等待 CPU 时间片 | `start()` |
| BLOCKED | 等待进入 `synchronized` 块 | 锁被其他线程持有 |
| WAITING | 无限期等待被唤醒 | `wait()`、`join()`、`LockSupport.park()` |
| TIMED_WAITING | 有超时的等待 | `sleep(ms)`、`wait(ms)`、`join(ms)`、`parkNanos` |
| TERMINATED | 执行结束 | `run` 正常返回或抛出异常 |

```text
NEW --start()--> RUNNABLE --run 结束--> TERMINATED
                 |    ^
   抢 synchronized 失败 |  拿到锁
                 v    |
               BLOCKED
RUNNABLE --wait()/join()/park()--> WAITING --notify/unpark/目标线程结束--> RUNNABLE
RUNNABLE --sleep(ms)/wait(ms)----> TIMED_WAITING --超时或被唤醒--> RUNNABLE
```

Java 没有单独的"运行中"状态，操作系统层面的就绪和运行都算 RUNNABLE。线程在做阻塞 IO（比如读 socket）时，Java 层面通常也显示为 RUNNABLE。操作系统层面的线程模型见 [进程和线程](/basics/os/01-process-thread)。

### BLOCKED 和 WAITING 的区别

- BLOCKED 是被动的：想进 `synchronized` 但锁被占了，锁释放后自动参与竞争
- WAITING 是主动的：线程自己调用了等待方法，必须等别人 `notify` / `unpark`，或者等 `join` 的线程结束
- 用 `ReentrantLock.lock()` 等锁时，底层是 `LockSupport.park`，线程状态是 WAITING 而不是 BLOCKED

一个线程从 `wait()` 被 `notify` 唤醒后，还要重新抢锁，没抢到就会从 WAITING 进入 BLOCKED。

### sleep 和 wait 的区别

| | `Thread.sleep` | `Object.wait` |
| --- | --- | --- |
| 所属 | `Thread` 的静态方法 | `Object` 的实例方法 |
| 是否释放锁 | 不释放 | 释放 |
| 调用前提 | 任何地方都能调 | 必须持有该对象的锁，否则抛 `IllegalMonitorStateException` |
| 唤醒方式 | 时间到 | `notify` / `notifyAll` 或超时 |

### 创建线程的方式

1. 继承 `Thread`，重写 `run`：简单，但占用了唯一的继承机会
2. 实现 `Runnable`，传给 `Thread`：任务和线程分离，更常用
3. 实现 `Callable`，包装成 `FutureTask` 再交给 `Thread`：能拿返回值，能抛受检异常
4. 提交给线程池：生产环境的标准做法，参数和执行流程见 [线程池](/basics/java/08-thread-pool)

后来的版本还加入了**虚拟线程**：由 JVM 调度、挂载在少量平台线程上，非常轻量，适合大量阻塞 IO 的任务，可以用 `Thread.ofVirtual().start(task)` 或 `Executors.newVirtualThreadPerTaskExecutor()` 创建。

## 代码示例

```java
import java.util.concurrent.*;

public class Main {
    public static void main(String[] args) throws Exception {
        Thread t1 = new Thread(() -> System.out.println("runnable"));
        System.out.println(t1.getState()); // NEW
        t1.start();
        t1.join();
        System.out.println(t1.getState()); // TERMINATED

        // Callable + FutureTask：拿返回值
        FutureTask<Integer> task = new FutureTask<>(() -> 1 + 1);
        new Thread(task).start();
        System.out.println(task.get());    // 2，get 会阻塞到结果返回

        // 线程池
        ExecutorService pool = Executors.newFixedThreadPool(2);
        Future<String> f = pool.submit(() -> Thread.currentThread().getName());
        System.out.println(f.get());       // pool-1-thread-1
        pool.shutdown();
    }
}
```

## 面试官可能追问

::: details 直接调用 run() 和调用 start() 有什么区别？
`start()` 会创建新线程，由新线程去执行 `run()`；直接调 `run()` 只是在当前线程里执行一次普通方法调用，没有新线程。同一个 `Thread` 对象 `start()` 两次会抛 `IllegalThreadStateException`。
:::

::: details 为什么 wait 要放在 while 循环里？
线程可能发生虚假唤醒，或者被唤醒后条件已经被其他线程改掉了。用 `while (!条件) wait();` 醒来后重新检查条件，不满足就继续等。用 `if` 只检查一次，可能在条件不成立时往下执行。
:::

::: details 怎么停止一个线程？
用中断协作：调用 `t.interrupt()` 设置中断标志，线程在循环里检查 `Thread.currentThread().isInterrupted()` 自己退出；如果线程正阻塞在 `sleep`、`wait`、`join` 上，会抛 `InterruptedException`。`Thread.stop()` 会强行终止并释放所有锁，可能留下不一致的数据，早已废弃。
:::

## 易错点

- RUNNABLE 不等于"正在运行"，它还包括等待 CPU；Java 没有 RUNNING 状态
- `sleep` 不释放锁，在 `synchronized` 块里 sleep，其他线程照样进不来
- 捕获 `InterruptedException` 后什么都不做会吞掉中断信号，至少要调用 `Thread.currentThread().interrupt()` 恢复中断标志
