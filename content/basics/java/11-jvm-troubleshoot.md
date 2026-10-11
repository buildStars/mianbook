---
difficulty: 3
tags: [高频, 场景题, 实践]
---

# 线上 Java 服务 CPU 飙高、频繁 Full GC 怎么排查？

::: tip 一句话回答
先**保留现场**再恢复服务。CPU 高：`top -H -p <pid>` 找到最忙的线程，用 `jcmd <pid> Thread.print` 或 `jstack` 隔几秒抓几次线程栈，按线程 ID 找到它在执行的代码，常见是死循环、正则回溯；最忙的是 GC 线程就转去查 GC。频繁 Full GC：用 `jstat -gcutil` 看 Full GC 次数和老年代占用的变化，结合 GC 日志里的触发原因，再导出堆转储，用 MAT 顺着引用链找到占内存最多的对象，常见原因是内存泄漏、一次加载过多数据、元空间泄漏和堆参数不合理。Arthas 的 `dashboard`、`thread -n`、`trace` 不用重启就能在线完成大部分步骤。
:::

## 详细解析

### 先保留现场

重启能让服务马上恢复，但线程栈、堆里的对象也一起没了。处理顺序一般是：

1. 有多台实例时，先把出问题的实例从负载均衡上摘下来，避免继续影响用户
2. 抓现场：连续几次线程栈、`jstat` 输出、GC 日志，必要时导出堆转储
3. 再重启或回滚，事后拿着现场慢慢分析

现场能不能拿到，很大程度取决于启动参数是否提前配好：

```bash
java -Xms4g -Xmx4g \
  -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/data/dump/heap_%p.hprof \
  -Xlog:gc*:file=/data/logs/gc.log:time,uptime,level,tags:filecount=5,filesize=20M \
  -jar app.jar
```

`-Xlog` 是 JDK 9 起的统一日志，格式是 `-Xlog:标签:输出:装饰:输出选项`，`gc*` 相当于 JDK 8 的 `-XX:+PrintGCDetails`，`filecount`、`filesize` 控制日志滚动。

### CPU 飙高：从线程定位到代码

Linux 命令部分见 [线上服务器 CPU 或内存飙高怎么排查](/basics/os/09-linux-troubleshoot)，这里只讲 Java 相关的部分：

1. `top -H -p <pid>` 找到 CPU 最高的几个线程，记下线程 ID（十进制）
2. 抓线程栈：`jstack <pid>` 或 `jcmd <pid> Thread.print`（官方文档把 jstack 标为实验性工具，Oracle 的排障指南推荐优先用 jcmd）
3. 在线程栈里按 `nid` 找到这个线程。JDK 17 及以前 nid 是十六进制，要先用 `printf '%x\n' <tid>` 转换；**JDK 18 起改成直接打印十进制**，可以直接搜
4. 隔几秒再抓两三次。始终停在同一段业务代码上、状态是 RUNNABLE 的线程，才是真正的热点

看栈时常见的几种情况：

| 栈里看到的 | 可能的原因 |
| --- | --- |
| 业务线程反复停在同一个循环、正则匹配、序列化方法里 | 死循环、正则灾难性回溯、超大集合的遍历或排序、大对象反复序列化 |
| 最忙的是 GC 线程（线程名里带 GC、G1 等字样，具体名字随版本和收集器不同） | 不是代码在算，而是在频繁 GC，转去看下一节 |
| 最忙的是 JIT 编译线程（如 `C2 CompilerThread0`） | 刚启动或刚发布，大量方法在编译，通常会自己降下来 |
| 大量线程 BLOCKED，等同一把锁 | 锁竞争，CPU 往往不高但响应变慢，找到持有锁的线程看它在做什么 |

### 频繁 Full GC：先看现象，再找对象

```bash
jstat -gcutil <pid> 1000 10    # 每 1000 毫秒输出一次，共 10 次
```

主要看 O（老年代占当前容量的百分比）、YGC/FGC（新生代 GC 和 Full GC 的次数）、FGCT（Full GC 累计耗时）。几种典型现象：

- **FGC 快速增长，每次 Full GC 后 O 都降不下来，并且越来越高**：存活对象越来越多，多半是内存泄漏
- **Full GC 后 O 能降下来，但很快又涨满**：短时间内分配了大量对象，比如一次查询几十万行、导出大报表，或者新生代太小导致对象过早晋升
- **GC 日志里反复出现 `Metadata GC Threshold` 这类和元空间有关的触发原因，`jstat -gc` 的 MU（元空间已用，单位 KB）一直涨**：元空间不够，常见于不断动态生成类。`-gcutil` 的 M 列是相对当前已提交容量的百分比，接近 100% 不代表元空间到了上限
- **GC 日志里 Full GC 的原因是 System.gc()**：代码或依赖库主动调用了它

G1、Parallel 的 GC 日志里搜 `Pause Full`，能看到每次 Full GC 的原因和前后的内存占用。确认是对象问题后，导出堆转储：

```bash
jcmd <pid> GC.heap_dump /data/dump/heap.hprof          # 默认先触发一次 Full GC，只导出存活对象；加 -all 导出全部对象且不触发 GC
jmap -dump:live,format=b,file=/data/dump/heap.hprof <pid>   # 等价的老写法
jcmd <pid> GC.class_histogram | head -20                # 不导文件，先看哪些类的实例最多
```

用 MAT 打开堆转储：先看 Leak Suspects 报告，再看 Dominator Tree 找出"一个对象撑起了多大的内存"，最后对可疑对象看 Path to GC Roots，顺着引用链找到持有它的代码，比如一个只加不删的静态 Map、没有上限的本地缓存、没有 remove 的 [ThreadLocal](/basics/java/09-threadlocal)。各个内存区域和 GC 的原理分别见 [JVM 的内存区域](/basics/java/03-jvm-memory) 和 [垃圾回收](/basics/java/04-gc)。

### 常见原因对照

| 原因 | 典型表现 | 怎么确认 |
| --- | --- | --- |
| 死循环、正则回溯 | 单个线程长期占满一核，GC 正常 | 多次线程栈都停在同一处 |
| 内存泄漏 | Full GC 越来越频繁，每次回收后老年代仍然很高 | 堆转储的支配树里有一个越来越大的集合或缓存 |
| 一次加载过多数据 | 某个接口被调用时内存骤升，伴随连续 Full GC | 堆转储里有巨大的 List 或数组；`trace` 定位接口 |
| 元空间泄漏 | 元空间已用量持续上涨，`jstat -class` 显示加载的类越来越多 | 找反复生成代理类、反复创建类加载器或编译脚本的代码 |
| 堆参数不合理 | 堆本身太小；容器里没设 `-Xmx` 时，最大堆默认一般只有容器内存的 25% | `jcmd <pid> VM.flags` 看实际生效的参数 |

### 用 Arthas 在线排查

Arthas 通过 attach 进入目标 JVM，不用重启就能看线程、追踪方法耗时，要用和目标进程相同的用户启动：

```bash
curl -O https://arthas.aliyun.com/arthas-boot.jar
java -jar arthas-boot.jar               # 列出 Java 进程，输入编号后进入

dashboard                               # 实时面板：线程 CPU、堆和元空间、GC 次数和耗时
thread -n 3                             # 最忙的 3 个线程及其栈，默认按 200 毫秒的采样计算 CPU
thread -b                               # 找出阻塞了其他线程的线程（只支持 synchronized）
trace com.example.OrderService createOrder '#cost > 100'  # 只显示耗时超过 100 毫秒的调用，逐个子调用列出耗时
profiler start                          # 开始采样（默认 cpu 事件）
profiler stop --format flamegraph       # 停止并生成 HTML 火焰图
heapdump --live /data/dump/heap.hprof   # 导出堆转储
stop                                    # 用完彻底退出 Arthas；quit 只断开连接，Arthas 仍留在进程里
```

`trace` 每次只展开一层调用，想继续往下钻，就对耗时最长的子方法再 trace 一次。

## 面试官可能追问

::: details jstack 里看到大量线程 BLOCKED，怎么找到原因？
BLOCKED 的线程栈里会写 `waiting to lock <0x...>`，拿这个地址在整份输出里搜 `locked <0x...>`，就能找到持有这把锁的线程，再看它卡在哪里，常见的是在锁里做了远程调用或慢 SQL。如果是死锁，jstack 会在输出末尾直接报告 `Found one Java-level deadlock`，并列出互相等待的线程。`ReentrantLock` 这类 j.u.c 的锁要加 `-l`（jcmd 是 `Thread.print -l`）才会打印持有信息。
:::

::: details 堆有几十 GB，导出堆转储有什么风险？
导出期间应用会暂停，堆越大暂停越久，而且默认还会先做一次 Full GC；文件大小和导出的对象总量相当，可能写满磁盘。稳妥的做法是先把实例摘流量再导，导到空间足够的磁盘；较新的 JDK 中 `GC.heap_dump` 支持 `-gz` 压缩。分析时 MAT 本身也要足够的内存，通常要在分析机上调大它的 `-Xmx`。
:::

::: details 容器里 Java 进程被 OOMKilled，可堆明明没满，是怎么回事？
容器限制的是整个进程的内存，而堆只是其中一部分，元空间、线程栈、直接内存、JIT 代码缓存都在堆外。`-Xmx` 设得接近容器上限时，堆外一涨就超限被杀。用 `-XX:MaxRAMPercentage` 按比例设置堆并给堆外留出余量；排查堆外内存可以启动时加 `-XX:NativeMemoryTracking=summary`，再用 `jcmd <pid> VM.native_memory summary` 按子系统查看。
:::

::: details 抓了几次线程栈都看不出热点，还有什么办法？
线程栈只是几个瞬间的快照，执行很快但调用极其频繁的方法容易漏掉。这时用采样分析器生成火焰图更直观，比如 Arthas 的 `profiler`（基于 async-profiler）：火焰图里越宽的方法占用的 CPU 越多。还要回头确认 CPU 是不是用在了内核态（`top` 里的 sy 高），那种情况要查系统调用和锁竞争，而不是业务代码。
:::

## 易错点

- 先重启再排查，现场就没了；至少先抓几次线程栈和 `jstat` 输出
- `jmap -dump:live`、`jcmd GC.heap_dump`、`GC.class_histogram` 默认都会先触发 Full GC，在已经频繁 Full GC 的服务上执行，会让情况雪上加霜；后两者加 `-all` 可以跳过这次 GC，代价是结果里混有不可达的对象
- 只抓一次线程栈就下结论，可能刚好抓到一个偶然的瞬间
- 内存泄漏时调大 `-Xmx` 只能推迟问题，堆越大单次 Full GC 停顿还越长
