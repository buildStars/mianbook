---
difficulty: 1
tags: [高频]
---

# 接口和抽象类有什么区别？什么时候用哪个？

::: tip 一句话回答
语法上：一个类只能**继承一个**抽象类，但可以**实现多个**接口；抽象类可以有构造器、普通成员变量和各种访问修饰符的方法，接口的变量只能是 `public static final` 常量，方法可以是抽象方法、`default`、`static` 和 `private` 方法。设计上：抽象类表达 **is-a**，用来给一组相似的类复用代码；接口表达**能力约定**（can-do），用来定义契约、解耦调用方和实现。拿不准时优先用接口。
:::

## 详细解析

### 语法差异

| | 抽象类 | 接口 |
| --- | --- | --- |
| 继承 / 实现 | 单继承，`extends` | 多实现，`implements`；接口之间可以多继承 |
| 构造器 | 有，子类构造时调用 | 没有 |
| 成员变量 | 任意，可以有实例状态 | 只能是 `public static final` 常量 |
| 方法 | 抽象方法和普通方法，任意访问修饰符 | 抽象方法、`default`、`static`、`private` 方法 |
| 实例化 | 不能直接 `new` | 不能直接 `new` |

接口的方法在较早的版本里只能是抽象的；后来加入了 `default` 和 `static` 方法，再后来又允许 `private` 方法，用来抽取多个 `default` 方法里的公共逻辑。但接口依然**不能有实例字段**，所以 `default` 方法没法保存状态，这是它和抽象类最本质的差距。

### 设计语义

- **抽象类**：几个类本质上是同一类东西，共享一部分字段和实现，只有少数步骤不同。典型是模板方法模式：抽象类定义流程骨架，子类实现具体步骤
- **接口**：只规定"能做什么"，不关心是什么。`Comparable`、`Runnable`、`AutoCloseable` 都是能力，任何类都可以具备。依赖接口而不是具体类，方便替换实现、写 Mock 做测试

### 为什么加 default 方法

为了在不破坏已有实现类的前提下给接口加方法。比如集合框架给 `Collection` 加了 `stream()`、`removeIf()`，如果是抽象方法，所有第三方实现类都会编译失败。

### 怎么选

1. 定义对外的契约、需要多实现、希望解耦：用接口
2. 多个子类有共同的状态和大段重复代码：用抽象类
3. 两者结合也很常见：接口定义契约，抽象类提供骨架实现，具体类继承抽象类。集合框架的 `List` 接口加 `AbstractList` 就是这样

## 代码示例

```java
interface Flyable {
    void fly();

    default void land() {           // default 方法，实现类可以不重写
        log("landing");
    }

    private void log(String msg) {  // private 方法，只给接口内部复用
        System.out.println(msg);
    }
}

abstract class Animal {
    protected final String name;    // 抽象类可以有实例状态和构造器

    Animal(String name) { this.name = name; }

    // 模板方法：流程固定，具体叫声交给子类
    public final void introduce() {
        System.out.println(name + " says " + sound());
    }

    protected abstract String sound();
}

class Bird extends Animal implements Flyable {
    Bird(String name) { super(name); }

    @Override protected String sound() { return "tweet"; }
    @Override public void fly() { System.out.println(name + " flying"); }
}

public class Main {
    public static void main(String[] args) {
        Bird b = new Bird("Kiwi");
        b.introduce(); // Kiwi says tweet
        b.fly();       // Kiwi flying
        b.land();      // landing
    }
}
```

## 面试官可能追问

::: details 一个类实现的两个接口有同名的 default 方法，会怎样？
编译报错，类必须自己重写这个方法。重写时可以用 `A.super.method()` 指定调用某个接口的默认实现。如果父类里有同签名的方法，父类优先（"类优先"规则）。
:::

::: details 抽象类可以没有抽象方法吗？
可以。用 `abstract` 修饰只是为了禁止直接实例化，强制别人通过子类使用。反过来，有抽象方法的类一定要声明成抽象类。
:::

::: details 函数式接口是什么？
只有一个抽象方法的接口（`default`、`static` 方法不算），可以用 Lambda 表达式实现，比如 `Runnable`、`Comparator`、`Function`。加 `@FunctionalInterface` 注解后，编译器会检查是不是真的只有一个抽象方法。
:::

## 易错点

- 接口里声明的变量即使不写修饰符也是 `public static final`，必须初始化，不能当实例字段用
- 接口方法不写修饰符默认是 `public abstract`，实现类重写时不能降低访问权限，写成包级私有会编译失败
- 有了 `default` 方法不等于接口能替代抽象类，接口依然不能保存实例状态、不能有构造器
