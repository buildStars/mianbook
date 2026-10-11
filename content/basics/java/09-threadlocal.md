---
difficulty: 2
tags: [高频, 原理]
---

# ThreadLocal 的原理是什么？为什么会内存泄漏？

::: tip 一句话回答
数据其实存在线程自己身上：每个 Thread 对象持有一个 **ThreadLocalMap**，以 ThreadLocal 对象为 key、要保存的值为 value，所以每个线程读写的都是自己的那一份。这个 Map 的 key 是**弱引用**，value 是**强引用**：ThreadLocal 对象被回收后 key 变成 null，value 却仍然被线程引用着，线程不结束就释放不了。线程池里的线程长期存活并被复用，不清理既会泄漏，还会把上一个请求的数据带给下一个请求，所以用完一定要在 finally 里调用 `remove()`。
:::

## 详细解析

### 数据存在哪里

```text
Thread（线程池里的线程，长期存活）
 └─ threadLocals：ThreadLocalMap
     └─ Entry[] table
         └─ Entry
             ├─ key   ┄┄ 弱引用 ┄┄> ThreadLocal 对象 <── 强引用 ── 代码里的 ThreadLocal 变量
             └─ value ── 强引用 ──> 保存的值
```

`get()` 的过程：拿到当前线程，取出它的 `threadLocals`，再以当前这个 ThreadLocal 对象为 key 查找；找不到就调用 `initialValue()`（或 `ThreadLocal.withInitial` 传入的函数）生成初始值并保存。`set()` 也是先找到当前线程的 Map 再写入。每个线程只访问自己的 Map，所以读写都不需要加锁。

### 为什么会内存泄漏

1. 代码中不再强引用某个 ThreadLocal 对象后，Entry 的 key 只剩弱引用，下一次 GC 时 ThreadLocal 对象被回收，key 变成 null
2. value 仍然通过 `Thread → ThreadLocalMap → Entry → value` 这条强引用链被引用着，无法回收
3. 普通线程结束后，整个 Map 跟着线程一起被回收，问题不大；但线程池的线程会一直存活，这些 value 就一直占着内存

ThreadLocalMap 在 `get`、`set`、`remove` 时会顺带清理一部分 key 为 null 的条目，但只有调用到这些方法、并且恰好遇到这些条目时才会清理，不能依赖它。

**既然还会泄漏，key 为什么用弱引用**：如果 key 是强引用，代码里已经不再使用这个 ThreadLocal 了，Map 仍然强引用着它，ThreadLocal 对象和 value 都会随线程一直存活，泄漏更多。用弱引用至少让 ThreadLocal 对象本身能被回收，并留下"key 为 null"的标记，方便后续清理。它只是补救措施，不能代替手动 `remove()`。弱引用的含义见 [JVM 的垃圾回收](/basics/java/04-gc) 的追问。

实际开发中，ThreadLocal 通常声明为 `private static final`，只要类不卸载，它就一直被强引用，key 根本不会变成 null，value 只能靠 `remove()` 释放。这时更常见的问题是下面的数据串号。

### 线程池中的数据串号

线程池会复用线程。上一个任务 `set` 的值如果没有清理，下一个在同一个线程上执行的任务调用 `get()` 就会拿到它。比如在拦截器里把登录用户放进 ThreadLocal，请求结束时却没有清理，下一个请求如果没有重新设置，读到的就是上一个用户的身份，这是严重的安全问题。

正确的做法是在请求入口设置值，用 try-finally 包住整个处理过程，在 finally 里调用 `remove()`。在 Spring MVC 中通常是在拦截器的 `preHandle` 里设置、在 `afterCompletion` 里清理。

### 使用场景

- 保存请求级别的上下文：当前登录用户、租户 ID、链路追踪 ID。日志框架的 MDC 通常也是基于 ThreadLocal 实现的
- 给每个线程一份非线程安全对象的副本，比如 `SimpleDateFormat`；新代码直接用线程安全的 `DateTimeFormatter` 更好
- 框架内部：Spring 的事务管理把数据库连接绑定在当前线程上，保证同一个事务中的操作使用同一个连接

## 代码示例：线程复用导致数据串号

```java
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class ThreadLocalReuseDemo {
    private static final ThreadLocal<String> CURRENT_USER = new ThreadLocal<>();

    public static void main(String[] args) throws Exception {
        // 演示用：池里只有一个线程，后面的任务一定复用同一个线程
        ExecutorService pool = Executors.newSingleThreadExecutor();

        // 请求 A：设置了用户，但没有清理
        pool.submit(() -> CURRENT_USER.set("alice")).get();
        // 请求 B：自己没有设置，却读到了 A 留下的值
        pool.submit(() -> System.out.println("请求 B 读到：" + CURRENT_USER.get())).get();

        // 请求 C：正确做法，用完在 finally 里清理
        pool.submit(() -> {
            CURRENT_USER.set("bob");
            try {
                System.out.println("请求 C 读到：" + CURRENT_USER.get());
            } finally {
                CURRENT_USER.remove();
            }
        }).get();
        // 请求 D：读不到任何残留
        pool.submit(() -> System.out.println("请求 D 读到：" + CURRENT_USER.get())).get();

        pool.shutdown();
    }
}
```

输出：

```text
请求 B 读到：alice
请求 C 读到：bob
请求 D 读到：null
```

## 面试官可能追问

::: details 子线程能拿到父线程的 ThreadLocal 值吗？
普通的 ThreadLocal 不能。InheritableThreadLocal 可以：创建子线程时，会把父线程中 InheritableThreadLocal 的值复制一份给子线程。但它只在**创建线程时**复制一次，而线程池的线程是提前创建、反复复用的，提交任务时的上下文传不过去，任务读到的可能是很久以前创建这个线程时的旧值。线程池场景通常在提交任务时显式传递：包装 Runnable，提交时捕获当前线程的值，执行前设置、执行后清理；也可以使用阿里开源的 TransmittableThreadLocal。
:::

::: details ThreadLocalMap 怎么解决哈希冲突？
它没有用链表，而是用线性探测的开放地址法：算出的位置被占用，就往后找下一个空位。为了让 key 分布均匀，每创建一个 ThreadLocal，它的哈希值就在上一个的基础上增加一个固定的值 `0x61c88647`，在长度为 2 的幂的数组中散列效果很好。一个线程用到的 ThreadLocal 通常不多，开放地址法简单又省空间。
:::

::: details 虚拟线程里能用 ThreadLocal 吗？
能用，每个虚拟线程都有自己的值。但虚拟线程的数量可能成千上万，每个都保存一份副本会占用大量内存；虚拟线程也不会被复用，不能再靠 ThreadLocal 在线程上缓存昂贵的对象。JDK 21 以预览特性提供了 ScopedValue（JDK 25 正式发布），用来在调用链上传递只读的上下文，是更轻量的替代方案。
:::

## 易错点

- 泄漏的是 **value**，不是 key；key 用弱引用并不能避免泄漏
- `set(null)` 不等于 `remove()`，条目还留在 Map 里，用完要调用 `remove()`
- ThreadLocal 解决的是"每个线程使用自己的副本"，不是让多个线程安全地共享同一个变量
- 换了线程就读不到了：交给线程池、`CompletableFuture`、`@Async` 执行的异步任务，读不到调用方线程的 ThreadLocal，需要显式传递
