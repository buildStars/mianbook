---
difficulty: 1
tags: [高频]
---

# == 和 equals 有什么区别？为什么重写 equals 必须重写 hashCode？

::: tip 一句话回答
`==` 对基本类型比较**值**，对引用类型比较**是不是同一个对象**（地址）；`equals` 比较**逻辑上是否相等**，`Object` 的默认实现就是 `==`，`String`、`Integer` 等类重写了它。Java 约定 **equals 相等的两个对象 hashCode 必须相等**，否则放进 `HashMap`、`HashSet` 时会被分到不同的桶，出现"明明相等却查不到、去不了重"的问题。
:::

## 详细解析

### == 比较的是什么

- 基本类型（`int`、`double`、`char` 等）：比较数值本身
- 引用类型：比较两个变量是否指向同一个对象
- 基本类型和包装类型用 `==` 比较时，包装类型会先**自动拆箱**，变成数值比较

### 两个经典例子

`Integer` 自动装箱走 `Integer.valueOf`，它缓存了 -128 到 127 的对象，这个范围内拿到的是同一个实例：

```java
Integer a = 127, b = 127;
Integer c = 128, d = 128;
System.out.println(a == b);      // true，命中缓存，同一个对象
System.out.println(c == d);      // false，超出缓存范围，两个新对象
System.out.println(c.equals(d)); // true，比较的是值
```

字符串字面量会放进字符串常量池，`new String` 则一定在堆上创建新对象：

```java
String s1 = "abc";
String s2 = "abc";
String s3 = new String("abc");
System.out.println(s1 == s2);          // true，都指向常量池里的同一个对象
System.out.println(s1 == s3);          // false，s3 是新对象
System.out.println(s1.equals(s3));     // true
System.out.println(s1 == s3.intern()); // true，intern 返回池里的对象
```

结论：包装类型和字符串比较内容，一律用 `equals`。

### equals 和 hashCode 的约定

`Object` 文档里规定的几条，面试常问的是这两条：

1. 两个对象 `equals` 返回 true，它们的 `hashCode` 必须相等
2. `hashCode` 相等，`equals` 不一定为 true（哈希冲突是允许的）

`HashMap` 查找时先用 `hashCode` 定位桶，再在桶里用 `equals` 逐个比较（见 [HashMap 的底层原理](/basics/java/01-hashmap)）。只重写 `equals` 不重写 `hashCode`，两个逻辑相等的对象用的是 `Object` 默认的 hashCode，通常不同，第一步就落到不同的桶里，`equals` 根本没机会执行。

## 代码示例

```java
import java.util.*;

class User {
    private final String name;
    private final int age;

    User(String name, int age) { this.name = name; this.age = age; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof User)) return false;
        User u = (User) o;
        return age == u.age && Objects.equals(name, u.name);
    }

    // 参与 equals 的字段，也要参与 hashCode
    @Override
    public int hashCode() {
        return Objects.hash(name, age);
    }
}

public class Main {
    public static void main(String[] args) {
        Set<User> set = new HashSet<>();
        set.add(new User("Tom", 18));
        set.add(new User("Tom", 18));
        System.out.println(set.size()); // 1；去掉 hashCode 方法后通常输出 2
    }
}
```

## 面试官可能追问

::: details 只重写 hashCode 不重写 equals 会怎样？
两个对象能落到同一个桶，但桶里比较时用的是默认的 `equals`（也就是 `==`），不是同一个对象就判定不相等。`HashSet` 里还是会存两份，`HashMap` 用一个新建的"相等"对象当 key 也取不到值。
:::

::: details 为什么 hashCode 常用 31 做乘数？
`String.hashCode` 的公式是 `s[0]*31^(n-1) + ... + s[n-1]`。31 是奇质数，分布效果不错，而且 `31 * i` 可以优化成 `(i << 5) - i`。`Objects.hash` 内部用的也是 31。
:::

::: details 对象放进 HashSet 后修改了参与 hashCode 的字段，会发生什么？
对象还在原来的桶里，但它现在的 hashCode 变了。之后 `contains` 和 `remove` 会去新的桶找，找不到它，就产生了"删不掉"的对象，严重时是内存泄漏。所以作为 key 的对象最好是不可变的，`String` 就是典型。
:::

::: details 用 Lombok 的 @Data 有什么要注意的？
`@Data` 会基于所有字段生成 `equals` 和 `hashCode`。JPA 实体如果有懒加载关联或自增 id，可能导致加入集合后 hashCode 变化，或者双向关联互相调用导致栈溢出。实体类一般手写，或者只用 id 这类稳定字段。
:::

## 易错点

- `Integer` 缓存只对 `valueOf`（自动装箱）生效，`new Integer(127)` 每次都是新对象；这个构造器已经废弃，不要用
- `equals` 的参数类型必须是 `Object`，写成 `equals(User u)` 是重载不是重写，集合类不会调用它；加上 `@Override` 编译器能帮你发现
- 包装类型和 `null` 比较、或 `Integer == int` 时会拆箱，变量为 `null` 就抛 `NullPointerException`
