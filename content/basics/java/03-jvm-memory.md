---
difficulty: 2
tags: [高频, 原理]
---

# JVM 的内存区域是怎么划分的？

::: tip 一句话回答
按《Java 虚拟机规范》，运行时数据区分为**线程私有**的程序计数器、虚拟机栈、本地方法栈，和**线程共享**的堆、方法区。堆存放对象实例，是垃圾回收的主要区域；方法区存放类的元数据和运行时常量池，HotSpot 在 JDK 7 及以前用永久代实现它，**JDK 8 起改用元空间**，放在本地内存中。此外，NIO 等还会在堆外使用直接内存。
:::

## 详细解析

### 整体划分

```text
JVM 运行时数据区
├── 线程私有（随线程创建和销毁）
│   ├── 程序计数器：当前线程正在执行的字节码指令地址
│   ├── 虚拟机栈：每次方法调用创建一个栈帧
│   │   └── 栈帧：局部变量表、操作数栈、动态链接、方法返回地址
│   └── 本地方法栈：执行 native 方法时使用（HotSpot 把它和虚拟机栈合二为一）
└── 线程共享
    ├── 堆：对象实例和数组，GC 的主要区域
    └── 方法区：类的元数据、运行时常量池
        （JDK 7 及以前由永久代实现，JDK 8 起由元空间实现）

堆外：直接内存，不属于运行时数据区
```

### 线程私有的区域

- **程序计数器**：记录当前线程执行到了哪条字节码指令，线程切换回来后靠它恢复执行位置；执行 native 方法时它的值是未定义的。它占用的空间很小，规范没有为它规定任何 OutOfMemoryError
- **虚拟机栈**：每调用一个方法就压入一个栈帧，方法返回时弹出。局部变量表存放方法参数和局部变量（基本类型的值、对象的引用），大小在编译期就确定了；操作数栈是字节码指令计算时的临时工作区。递归太深、栈帧超出栈的容量时抛出 **StackOverflowError**
- **本地方法栈**：为 native 方法服务，作用和虚拟机栈类似

栈大小用 `-Xss` 设置，64 位 Linux 上默认是 1MB。栈越大，单个线程能嵌套调用的层数越多，但每个线程占用的内存也越多。

### 线程共享的区域

- **堆**：几乎所有对象实例和数组都在这里分配，由 GC 管理，大小用 `-Xms`（初始）和 `-Xmx`（最大）设置。分代收集器会把堆分成新生代和老年代，细节见 [JVM 的垃圾回收](/basics/java/04-gc)
- **方法区**：存放已加载类的元数据（类的结构、字段和方法信息、字节码等）和运行时常量池。运行时常量池是 class 文件中常量池在运行时的形式，保存字面量和符号引用，符号引用在解析后会替换为直接引用。类怎样被加载进来见 [类加载过程](/basics/java/05-classloading)

### 为什么用元空间替代永久代

方法区是规范中的概念，永久代和元空间是 HotSpot 先后用来实现它的方式。JDK 8 移除永久代，主要有三个原因：

1. **永久代的大小很难定**：它的上限在启动时就固定了（`-XX:MaxPermSize`），而应用会加载多少类很难预估。大量使用动态代理、CGLIB、JSP，或者在应用服务器里反复热部署时，很容易出现 `OutOfMemoryError: PermGen space`
2. **元空间使用本地内存**：默认上限只受系统可用内存限制；类的元数据按类加载器分配，类加载器被回收时，它加载的类的元数据可以一起释放
3. **合并 JRockit**：Oracle 要把 HotSpot 和 JRockit 两个虚拟机融合，JRockit 本来就没有永久代

几类数据的存放位置也在这几个版本里发生了变化：

| 内容 | JDK 6 | JDK 7 | JDK 8 及以后 |
| --- | --- | --- | --- |
| 类的元数据 | 永久代 | 永久代 | 元空间（本地内存） |
| 字符串常量池 | 永久代 | 堆 | 堆 |
| 静态变量 | 永久代 | 堆 | 堆 |

### 直接内存

直接内存不属于运行时数据区，是通过 `ByteBuffer.allocateDirect` 等方式在堆外分配的内存。网络和文件 I/O 使用它可以减少一次 Java 堆和本地内存之间的数据复制，Netty 等框架大量使用。上限用 `-XX:MaxDirectMemorySize` 设置，不设置时默认大约等于最大堆大小。

### 各区域的异常和参数

| 区域 | 线程 | 可能出现的错误 | 相关参数 |
| --- | --- | --- | --- |
| 程序计数器 | 私有 | 无 | 无 |
| 虚拟机栈、本地方法栈 | 私有 | StackOverflowError；创建新线程失败（内存不足或达到系统的线程数限制）会抛 OutOfMemoryError | `-Xss` |
| 堆 | 共享 | `OutOfMemoryError: Java heap space` | `-Xms`、`-Xmx` |
| 方法区（元空间） | 共享 | `OutOfMemoryError: Metaspace` | `-XX:MetaspaceSize`、`-XX:MaxMetaspaceSize` |
| 直接内存 | 共享 | `OutOfMemoryError: Direct buffer memory` | `-XX:MaxDirectMemorySize` |

## 代码示例

```java
public class StackOverflowDemo {
    private static int depth = 0;

    private static void recurse() {
        depth++;
        recurse(); // 没有终止条件，栈帧不断压栈
    }

    public static void main(String[] args) {
        try {
            recurse();
        } catch (StackOverflowError e) {
            // 具体深度和 -Xss、栈帧大小、JIT 编译情况有关，每次运行可能不同
            System.out.println("StackOverflowError, depth = " + depth);
        }
    }
}
```

```java
import java.util.ArrayList;
import java.util.List;

public class HeapOomDemo {
    public static void main(String[] args) {
        List<byte[]> list = new ArrayList<>();
        while (true) {
            list.add(new byte[1024 * 1024]); // 每次 1MB，一直被 list 引用着，无法回收
        }
    }
}
```

```bash
java -Xss256k StackOverflowDemo   # 栈调小后，能达到的深度明显变浅
java -Xmx16m -XX:+HeapDumpOnOutOfMemoryError HeapOomDemo
# 抛出 java.lang.OutOfMemoryError: Java heap space，并在当前目录生成 .hprof 堆转储文件
```

## 面试官可能追问

::: details 对象一定分配在堆上吗？
从规范的角度说，对象都在堆上分配。但 HotSpot 的 JIT 编译器会做逃逸分析：如果一个对象只在方法内部使用、不会被外部引用，就可能通过**标量替换**把它拆成几个局部变量，根本不创建这个对象。另外，堆虽然是线程共享的，但为了减少分配时的竞争，每个线程会在 Eden 中预先划出一小块私有的分配缓冲区（TLAB），小对象优先在自己的 TLAB 里分配。
:::

::: details 线上出现 OutOfMemoryError 怎么排查？
先看错误信息判断是哪个区域：`Java heap space` 是堆，`Metaspace` 是元空间，`Direct buffer memory` 是直接内存。启动参数里提前加上 `-XX:+HeapDumpOnOutOfMemoryError` 和 `-XX:HeapDumpPath`，发生 OOM 时会自动导出堆转储，再用 MAT 等工具看哪些对象占用最多、被谁引用着。如果是泄漏，就沿着引用链找到一直持有它们的代码；如果这些对象确实都需要，再考虑调大内存。
:::

::: details 字符串常量池为什么从永久代移到了堆？
永久代空间小，而且主要在 Full GC 时才回收，大量调用 `String.intern()` 很容易把它撑满。移到堆里之后，常量池中不再被引用的字符串可以随普通 GC 回收，可用的空间也大得多。
:::

## 易错点

- 方法区是规范里的概念，永久代和元空间是 HotSpot 的实现，不能说"JDK 8 去掉了方法区"
- 元空间默认没有上限，类加载泄漏（比如不断生成新的动态代理类）会一直占用本地内存，生产环境建议设置 `-XX:MaxMetaspaceSize`
- `-XX:MetaspaceSize` 不是元空间的初始大小，而是第一次因元空间占用触发 GC 的阈值
- 字符串常量池从 JDK 7 起就在堆中，不在元空间里
