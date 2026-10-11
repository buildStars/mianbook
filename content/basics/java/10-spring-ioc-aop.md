---
difficulty: 2
tags: [高频, 原理]
---

# Spring 的 IoC 和 AOP 是什么？Bean 的生命周期是怎样的？

::: tip 一句话回答
**IoC（控制反转）**是把对象的创建和依赖关系交给 Spring 容器管理，代码只声明自己需要什么；**依赖注入**是它的实现方式，好处是解耦、便于测试、便于统一管理。**AOP（面向切面编程）**把日志、事务、权限这类横切逻辑从业务代码中抽离出来，Spring 用**动态代理**实现：JDK 动态代理（要求有接口）或 CGLIB（生成子类）。Bean 的生命周期大致是：实例化 → 属性填充 → Aware 回调 → BeanPostProcessor 前置处理 → 初始化方法 → BeanPostProcessor 后置处理（AOP 代理通常在这里生成）→ 使用 → 销毁。
:::

## 详细解析

### IoC 和依赖注入

没有 IoC 时，类在内部自己 `new` 出依赖的对象，具体用哪个实现被写死在代码里。有了 IoC，类只声明依赖（通常是接口），由容器创建对象并注入进来：

- **解耦**：依赖接口而不是具体实现，替换实现只需改配置，不用改调用方的代码
- **便于测试**：测试时可以直接传入 mock 对象
- **统一管理**：对象的作用域、生命周期和配置都由容器负责，AOP 代理也是在容器创建 Bean 的过程中织入的

注入方式有构造器注入、setter 注入和字段注入。Spring 官方推荐构造器注入：依赖可以声明为 final，对象创建出来就是完整可用的，缺少依赖时启动就会报错。

### Bean 的生命周期（单例）

1. **实例化**：调用构造方法或工厂方法创建对象，构造器注入的依赖在这一步传入
2. **属性填充**：通过字段或 setter 注入 `@Autowired`、`@Value` 等依赖
3. **Aware 回调**：`BeanNameAware`、`BeanClassLoaderAware`、`BeanFactoryAware`，让 Bean 拿到自己的名字、类加载器和容器
4. **BeanPostProcessor 前置处理**：`@PostConstruct` 方法在这一步执行
5. **初始化**：`InitializingBean.afterPropertiesSet()`，然后是自定义的 init-method
6. **BeanPostProcessor 后置处理**：需要 AOP 的 Bean 在这里被替换成代理对象
7. **使用**：放进单例池，之后注入和 `getBean` 拿到的都是它（可能是代理）
8. **销毁**（容器关闭时）：`@PreDestroy` → `DisposableBean.destroy()` → 自定义的 destroy-method

BeanPostProcessor 是 Spring 最重要的扩展点之一，它对每个 Bean 都生效，可以在初始化前后修改甚至替换 Bean。`@Autowired` 注入、`@PostConstruct` 回调、AOP 代理都是靠 BeanPostProcessor（及其子接口）实现的。原型（prototype）Bean 交给调用方之后，容器不再管理它的销毁。

### AOP 和动态代理

AOP 中，**切点**（Pointcut）决定拦截哪些方法，**通知**（Advice）是在方法执行前、后、抛出异常时或环绕方法执行的增强逻辑，两者组合成**切面**（Aspect）。Spring AOP 在运行时为目标 Bean 生成代理对象，调用方拿到的是代理，代理先执行增强逻辑，再调用目标对象的方法。

| | JDK 动态代理 | CGLIB |
| --- | --- | --- |
| 原理 | 运行时生成一个实现了目标接口的代理类 | 运行时生成目标类的子类，重写父类的方法 |
| 要求 | 目标类必须实现接口，只能代理接口里的方法 | 不需要接口；final 类、final 方法、private 方法无法代理 |
| 增强逻辑写在 | `InvocationHandler` | `MethodInterceptor` |

Spring 框架本身的规则是：目标类实现了接口就用 JDK 动态代理，否则用 CGLIB。Spring Boot 2.0 起默认统一使用 CGLIB（`spring.aop.proxy-target-class=true`），避免按实现类注入时因为代理类型不匹配而报错。

### 三级缓存与循环依赖（简述）

A 依赖 B、B 又依赖 A，两者都是单例并且通过 setter 或字段注入时，Spring 用三级缓存解决：一级缓存 `singletonObjects` 存完整初始化好的 Bean，二级缓存 `earlySingletonObjects` 存提前暴露的早期引用（还没完成属性填充和初始化），三级缓存 `singletonFactories` 存用来生成早期引用的工厂。

1. 创建 A：实例化后，把"获取 A 的早期引用"的工厂放进三级缓存，然后填充属性，发现需要 B
2. 创建 B：填充属性时需要 A，依次查一、二、三级缓存，在三级缓存找到工厂，调用它得到 A 的早期引用（A 需要 AOP 时，这里会提前生成代理），放进二级缓存
3. B 完成初始化，放入一级缓存；回到 A，注入 B，A 也完成初始化

三级缓存存的是工厂而不是对象，是为了**只在真正发生循环依赖时才提前生成代理**，没有循环依赖时代理仍然在初始化之后才生成。构造器注入的循环依赖解决不了（对象还没实例化，没有早期引用可以暴露），原型 Bean 的循环依赖也不行。Spring Boot 2.6 起默认禁止循环依赖，需要时要显式开启。

### @Transactional 失效的常见原因

事务也是通过 AOP 代理实现的，调用绕过了代理，或者异常没有传到代理，事务就不会生效：

- **同一个类里的方法自调用**：在类的内部调用 `saveOrder()`，相当于 `this.saveOrder()`，直接调用目标对象，没有经过代理（原理见下面的代码示例）。解决办法是把事务方法挪到另一个 Bean，或者注入自身的代理再调用
- **方法不是 public**：基于代理的事务传统上只对 public 方法生效，Spring 6 起放宽到 CGLIB 代理下的 protected 和包可见方法；private、final、static 方法无论哪个版本都拦截不到
- **异常在方法内部被 catch 掉了**：代理感知不到异常，就不会回滚
- **抛出的是受检异常**：默认只对 RuntimeException 和 Error 回滚，其他异常要配置 `rollbackFor`
- 其他：对象不归 Spring 管理（自己 `new` 出来的对象没有代理）、传播行为配置成了不使用事务的方式（如 `NOT_SUPPORTED`）、在新开的线程里操作数据库（不是同一个连接）、表的存储引擎不支持事务（如 MySQL 的 MyISAM）

## 代码示例：自调用为什么绕过了代理

下面用 JDK 动态代理模拟 Spring AOP 的增强，不依赖 Spring 就能运行：

```java
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;

public class SelfInvocationDemo {
    public interface UserService {
        void register(String name);
        void sendEmail(String name);
    }

    public static class UserServiceImpl implements UserService {
        public void register(String name) {
            System.out.println("注册 " + name);
            sendEmail(name); // 相当于 this.sendEmail(name)：this 是目标对象，不是代理
        }

        public void sendEmail(String name) {
            System.out.println("发送邮件给 " + name);
        }
    }

    public static void main(String[] args) {
        UserService target = new UserServiceImpl();
        InvocationHandler handler = (proxyObj, method, methodArgs) -> {
            System.out.println("[增强] 开始 " + method.getName());
            Object result = method.invoke(target, methodArgs); // 调用目标对象的方法
            System.out.println("[增强] 结束 " + method.getName());
            return result;
        };
        UserService proxy = (UserService) Proxy.newProxyInstance(
                UserService.class.getClassLoader(), new Class<?>[] {UserService.class}, handler);
        proxy.register("tom");
    }
}
```

输出：

```text
[增强] 开始 register
注册 tom
发送邮件给 tom
[增强] 结束 register
```

`sendEmail` 没有被增强：代理只能拦截通过代理对象发起的调用，而 `register` 内部调用 `sendEmail` 用的是目标对象自己。Spring 的 CGLIB 代理也一样，代理对象会把调用转给原始的目标对象执行，目标方法里的 `this` 仍然不是代理。这就是同类自调用时 `@Transactional` 失效的原因。

## 面试官可能追问

::: details BeanFactory 和 ApplicationContext 有什么区别？
BeanFactory 是最基础的容器接口，提供 getBean 和依赖注入，单例 Bean 默认在第一次获取时才创建。ApplicationContext 继承了它，增加了事件发布、国际化、资源加载等功能，会自动注册 BeanPostProcessor，并在启动时就创建所有非懒加载的单例 Bean，配置错误能尽早暴露。平时用的基本都是 ApplicationContext。
:::

::: details Spring 的单例 Bean 是线程安全的吗？
Spring 不做任何保证，单例 Bean 被所有线程共享。Controller、Service 通常是无状态的（只有注入的依赖，没有可变的成员变量），所以没有问题。如果在成员变量里保存了请求相关的数据就会出错，应该改成局部变量或方法参数，或者用 [ThreadLocal](/basics/java/09-threadlocal) 保存请求上下文。
:::

::: details 为什么推荐构造器注入，而不是在字段上写 @Autowired？
构造器注入的依赖可以是 final 的，对象一创建就完整可用，不会出现依赖为 null 的半成品；依赖关系写在构造方法上一目了然，参数太多时也在提醒你这个类的职责太重；写单元测试时直接 new 并传入 mock 即可，不需要启动容器或用反射注入。另外，构造器注入的循环依赖在启动时就会报错，会倒逼你调整设计。
:::

## 易错点

- AOP 代理在 BeanPostProcessor 的**后置处理**中生成（发生循环依赖时会提前生成），容器里保存和注入的是代理对象，不是原始对象
- 初始化回调的顺序是 `@PostConstruct` → `afterPropertiesSet()` → 自定义 init-method；销毁时也是注解、接口、自定义方法的顺序
- 三级缓存只能解决**单例 + setter 或字段注入**的循环依赖，构造器注入和原型 Bean 的循环依赖都解决不了
- 同类自调用不经过代理，`@Transactional`、`@Async`、`@Cacheable` 这些基于代理的注解都会失效
