---
difficulty: 2
tags: [高频, 原理]
---

# 类加载过程是怎样的？什么是双亲委派模型？

::: tip 一句话回答
一个类从被加载到可以使用，要经过**加载、验证、准备、解析、初始化**五个阶段：准备阶段给静态变量分配内存并赋**零值**，初始化阶段才执行静态变量的赋值语句和静态代码块。**双亲委派**是指类加载器收到加载请求时，先交给父加载器去加载，父加载器加载不了才自己加载。这样核心类库总是由启动类加载器加载，不会被同名类替换，同一个类也不会被重复加载。
:::

## 详细解析

### 五个阶段

| 阶段 | 做什么 |
| --- | --- |
| 加载 | 按全限定名找到 class 字节流（jar 包、网络、运行时动态生成等），在方法区生成类的元数据，在堆中创建对应的 `Class` 对象 |
| 验证 | 检查字节流是否合法、安全：文件格式（魔数 `0xCAFEBABE`、版本号）、语义、字节码、符号引用 |
| 准备 | 为静态变量分配内存并赋零值（0、false、null） |
| 解析 | 把常量池中的符号引用替换为直接引用，HotSpot 通常等到第一次用到时才解析 |
| 初始化 | 执行编译器生成的 `<clinit>` 方法：按源码顺序执行静态变量的赋值和静态代码块 |

验证、准备、解析合称**连接**。例如 `static int a = 123;`，准备阶段之后 a 是 0，到初始化阶段才变成 123。`static final` 修饰的编译期常量比较特殊：它的值记录在 class 文件中这个字段的 ConstantValue 属性里，在静态代码块执行之前就已经是常量值；而且 javac 会把它直接内联到使用它的类中。JVM 保证一个类的 `<clinit>` 只被一个线程执行，其他线程阻塞等待，所以静态内部类实现的单例是线程安全的；反过来，如果静态代码块里有很耗时或会阻塞的操作，所有用到这个类的线程都会被卡住。

### 什么时候会初始化

规范列出了必须立即初始化的几种情况：

- 执行 `new`、读写静态字段（编译期常量除外）、调用静态方法
- 通过反射使用这个类，例如 `Class.forName("...")` 默认会初始化
- 初始化子类时，如果父类还没初始化，先初始化父类
- JVM 启动时包含 `main` 方法的主类
- 接口中定义了 default 方法时，实现类初始化之前会先初始化这个接口（JDK 8 起）

不会触发初始化的常见情况：通过子类访问父类的静态字段（只初始化父类）、创建这个类的数组、引用编译期常量、用 `Foo.class` 获取 Class 对象、调用 `ClassLoader.loadClass`。

### 类加载器和双亲委派

```text
启动类加载器 Bootstrap：C++ 实现，在 Java 中表示为 null，加载核心类库
 └─ 平台类加载器 Platform：JDK 9 之前叫扩展类加载器 Extension
     └─ 应用类加载器 Application：加载 classpath 上的类，即我们写的代码和依赖的 jar
         └─ 自定义类加载器：继承 ClassLoader
```

启动类加载器在 JDK 8 中加载 `jre/lib` 下的 rt.jar 等，JDK 9 起加载 java.base 等核心模块；扩展类加载器加载 `jre/lib/ext` 下的类，JDK 9 移除了这个扩展机制，改为平台类加载器。加载流程由 `ClassLoader.loadClass` 实现，下面是省略了并发控制和性能统计的简化版（JDK 9 起，平台和应用类加载器如果发现类所在的包属于某个命名模块，会直接交给负责这个模块的加载器，其他类仍按这个流程先委派给父加载器）：

```java
protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException {
    Class<?> c = findLoadedClass(name);             // 1. 已经加载过就直接返回
    if (c == null) {
        try {
            if (parent != null) {
                c = parent.loadClass(name, false);   // 2. 先委派给父加载器
            } else {
                c = findBootstrapClassOrNull(name);  // parent 为 null，表示父加载器是启动类加载器
            }
        } catch (ClassNotFoundException e) {
            // 父加载器加载不了，继续往下走
        }
        if (c == null) {
            c = findClass(name);                     // 3. 父加载器都加载不了，才自己加载
        }
    }
    if (resolve) {
        resolveClass(c);
    }
    return c;
}
```

双亲委派的好处：

- **安全**：`java.lang.String` 这样的核心类一定由启动类加载器加载，classpath 上放一个同名的类也不会生效，核心类不会被篡改
- **避免重复加载**：JVM 中一个类由"类加载器 + 全限定名"共同确定。父加载器已经加载过的类，子加载器直接使用，不会再加载一份，避免同一个类出现多个版本、互相不兼容

### 需要打破或绕开双亲委派的场景

- **SPI 与线程上下文类加载器**：JDBC 的 `DriverManager`、`ServiceLoader` 属于核心库（JDK 8 中由启动类加载器加载，JDK 9 起 `java.sql` 模块由平台类加载器加载），而驱动的实现类在 classpath 上，父加载器看不到。解决办法是**线程上下文类加载器**（默认就是应用类加载器）：核心库通过 `Thread.currentThread().getContextClassLoader()` 加载实现类，相当于父加载器反过来请子加载器帮忙
- **Tomcat 隔离 Web 应用**：每个 Web 应用有自己的 WebappClassLoader，除了 JDK 核心类，它优先在应用自己的 `WEB-INF/classes` 和 `WEB-INF/lib` 中查找，找不到才交给父加载器。这样不同的应用可以使用同一个库的不同版本，互不影响
- **热部署**：同一个类加载器不能重新加载已经加载过的类。热部署的做法是丢弃旧的类加载器，用新的类加载器重新加载修改过的类；旧的类在没有引用后，随它的类加载器一起被卸载。OSGi 更进一步，让各模块的类加载器按依赖关系互相委派，形成网状结构

## 代码示例：初始化的时机（输出题）

```java
class Parent {
    static int value = 1;
    static { System.out.println("Parent 初始化"); }
}

class Child extends Parent {
    static final String NAME = "child"; // 编译期常量
    static { System.out.println("Child 初始化"); }
}

public class InitDemo {
    public static void main(String[] args) {
        System.out.println(Child.NAME);  // ①
        Child[] arr = new Child[2];      // ②
        System.out.println(Child.value); // ③
        new Child();                     // ④
    }
}
```

依次输出 `child`、`Parent 初始化`、`1`、`Child 初始化`：

- ① `NAME` 是编译期常量，编译时已经内联进 `InitDemo`，不会触发 Child 的初始化
- ② 创建数组不会初始化 Child
- ③ `value` 是 Parent 声明的字段，通过子类访问只会初始化 Parent
- ④ `new` 才真正初始化 Child；此时 Parent 已经初始化过，不会再执行一次

## 面试官可能追问

::: details 能自己写一个 java.lang.String 替换 JDK 的吗？
不能。按双亲委派，加载 `java.lang.String` 的请求最终会交给启动类加载器，它加载的是 JDK 自己的 String。即使自定义类加载器重写 `loadClass` 绕开委派，`defineClass` 也会拒绝定义包名以 `java.` 开头的类，抛出 SecurityException。
:::

::: details Class.forName 和 ClassLoader.loadClass 有什么区别？
`Class.forName(name)` 默认会初始化这个类，执行静态代码块；`ClassLoader.loadClass(name)` 只加载，不会初始化。早年加载 JDBC 驱动要写 `Class.forName("com.mysql.jdbc.Driver")`，靠的就是驱动类的静态代码块把自己注册到 DriverManager；JDBC 4.0 起驱动通过 SPI 自动注册，这行代码可以省略。
:::

::: details 自定义类加载器怎么写？要打破双亲委派该重写哪个方法？
继承 ClassLoader，重写 `findClass`：按类名找到字节码（比如从指定目录读取，或者先解密），再调用 `defineClass` 把字节数组转成 Class 对象。只重写 `findClass` 会保留双亲委派，因为委派逻辑在 `loadClass` 里，父加载器都加载不了才会调用到 `findClass`。想打破委派，就要重写 `loadClass`，改变"先问父加载器"的顺序，Tomcat 的 WebappClassLoader 就是这样做的。
:::

## 易错点

- 准备阶段赋的是**零值**，不是代码里写的初始值；静态代码块在初始化阶段才执行
- 两个类相同，要求类加载器和全限定名都相同。同一个 class 文件被两个类加载器加载，得到的是两个不同的类，互相强转会抛 ClassCastException，热部署和 Tomcat 里经常遇到
- 双亲委派中的"父"是通过 `parent` 字段组合实现的，不是继承关系
- JDK 9 起应用类加载器不再是 URLClassLoader 的子类，把它强转成 URLClassLoader 来动态添加 jar 的老写法会抛 ClassCastException
