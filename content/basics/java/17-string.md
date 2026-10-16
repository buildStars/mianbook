---
difficulty: 1
tags: [高频]
---

# String 为什么是不可变的？String、StringBuilder、StringBuffer 有什么区别？

::: tip 一句话回答
`String` 是 `final` 类，内部保存字符的数组是 `private final` 的，而且没有任何方法会修改这个数组，所以对象一旦创建内容就不会变。不可变带来了**常量池复用、线程安全、hash 值可缓存、可以安全地作为 HashMap 的 key**。三者区别：`String` 不可变；`StringBuilder` 可变、非线程安全、最快；`StringBuffer` 可变、方法加了 `synchronized`、线程安全但有额外开销。
:::

## 详细解析

### 内部存储

- 较早的版本里，`String` 内部是 `char[] value`，每个字符固定占 2 字节
- 后来的版本改成 `byte[] value` 加一个 `coder` 字段（Compact Strings）：全是 Latin-1 字符时每个字符只占 1 字节，有其他字符时才用 UTF-16 编码。英文为主的应用能省下不少堆内存

不可变靠的是三点一起：类是 `final`，不能被继承后篡改行为；数组字段是 `private final`，引用不能换；所有"修改"方法（`substring`、`replace`、`concat`）都返回新对象。`final` 只保证引用不变，数组内容不变是靠"不暴露、不修改"做到的。

### 不可变的好处

| 好处 | 说明 |
| --- | --- |
| 字符串常量池 | 相同字面量可以共享一个对象，如果可变，改一处就影响所有引用 |
| 线程安全 | 不可变对象天然可以在多线程间共享，无需同步 |
| 缓存 hash | `hash` 字段第一次计算后就缓存下来，做 HashMap 的 key 很快 |
| 安全 | 类名、文件路径、URL 用字符串传递，校验后不会被别人偷偷改掉 |

### 字符串拼接是怎么编译的

- 全是编译期常量的拼接，比如 `"a" + "b"`，编译器直接折叠成 `"ab"`，结果在常量池里
- 有变量参与时，较早的版本由 `javac` 翻译成 `new StringBuilder().append(...).toString()`；后来的版本改成 `invokedynamic` 调用 `StringConcatFactory`，由运行时选择拼接策略
- 循环里用 `+=` 拼接，每轮都会生成新的中间对象，应该在循环外创建一个 `StringBuilder`

### intern

`intern()` 会去常量池查找内容相同的字符串：有就返回池里的对象，没有就把当前字符串放进池里再返回。大量重复的字符串（比如从数据库读出的状态值）可以用它去重，但池本身是一张哈希表，滥用会让它变得很大。

### 三者对比

| | String | StringBuilder | StringBuffer |
| --- | --- | --- | --- |
| 可变性 | 不可变 | 可变 | 可变 |
| 线程安全 | 安全（不可变） | 不安全 | 安全（`synchronized`） |
| 性能 | 频繁修改时最差 | 最好 | 略差于 StringBuilder |
| 场景 | 少量操作、做 key | 单线程拼接，绝大多数情况 | 多线程共享同一个缓冲区，很少见 |

## 代码示例

```java
public class Main {
    public static void main(String[] args) {
        String a = "hello";
        String b = "hel" + "lo";          // 编译期折叠
        String part = "hel";
        String c = part + "lo";           // 运行时拼接，产生新对象
        System.out.println(a == b);           // true
        System.out.println(a == c);           // false
        System.out.println(a == c.intern());  // true

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 3; i++) {
            sb.append(i).append(',');
        }
        sb.setLength(sb.length() - 1);    // 去掉最后一个逗号
        System.out.println(sb);           // 0,1,2
    }
}
```

## 面试官可能追问

::: details String s = new String("abc") 创建了几个对象？
如果常量池里还没有 `"abc"`，类加载解析这个字面量时会在池里创建一个，`new` 再在堆上创建一个，一共两个；如果池里已经有了，就只有 `new` 出来的一个。
:::

::: details 用反射能修改 String 的内容吗？
在较早的版本里可以通过反射拿到 `value` 数组并修改，会破坏常量池里所有共享这个对象的地方。后来的版本有模块系统的强封装，默认不允许反射访问 `java.lang` 的私有字段。这说明不可变是设计约定，不是物理上做不到。
:::

::: details StringBuilder 是怎么扩容的？
内部也是一个数组，默认容量 16。`append` 时容量不够就扩到大约原来的 2 倍加 2，如果还不够就直接用需要的长度，然后把旧数据拷贝过去。能预估长度时用 `new StringBuilder(capacity)` 指定初始容量，减少拷贝。
:::

## 易错点

- `final` 修饰数组只是引用不能改，并不能阻止改数组元素；String 不可变是 `private final` 加上"没有修改方法"共同保证的
- `s.replace("a", "b")` 不会改变 `s`，忘记接收返回值是常见 bug
- 简单的一行拼接用 `+` 就行，编译器会优化；要换成 StringBuilder 的是循环里的拼接
