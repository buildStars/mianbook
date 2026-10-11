---
difficulty: 2
tags: [高频, 原理, 实践]
---

# Spring 事务的传播行为有哪些？哪些情况下事务会失效？

::: tip 一句话回答
传播行为决定"一个事务方法被另一个事务方法调用时，是加入已有事务还是新开一个"，共 7 种：**REQUIRED**（默认，有就加入，没有就新建）、**REQUIRES_NEW**（挂起外层，新开一个独立的物理事务）、**NESTED**（在同一个物理事务里设保存点，内层失败只回滚到保存点），以及 SUPPORTS、MANDATORY、NOT_SUPPORTED、NEVER。`@Transactional` 靠 AOP 代理生效，失效的原因基本都能归到几类：调用没经过代理（同类自调用、对象不归 Spring 管）、异常没传到代理（被 catch 吞了）、异常类型不触发回滚（默认只回滚 RuntimeException 和 Error）、换了线程或连接、数据库本身不支持事务。
:::

## 详细解析

### 事务是怎么生效的

调用 `@Transactional` 方法时，先进入代理里的事务拦截器（代理的原理、自调用为什么绕过代理见 [Spring 的 IoC 和 AOP](/basics/java/10-spring-ioc-aop)），按传播行为决定加入当前事务还是开启新事务。以 JDBC 的 `DataSourceTransactionManager` 为例，开启事务就是从连接池借一个连接、关闭自动提交，再通过 `TransactionSynchronizationManager` 把连接**绑定到当前线程**（内部用 [ThreadLocal](/basics/java/09-threadlocal) 保存），MyBatis、JdbcTemplate 执行 SQL 时都从当前线程取这个连接。方法正常返回就提交，抛出异常时按回滚规则决定回滚还是照样提交。

### 七种传播行为

| 传播行为 | 当前已有事务 | 当前没有事务 |
| --- | --- | --- |
| REQUIRED（默认） | 加入 | 新建 |
| REQUIRES_NEW | 挂起当前事务，新建一个独立事务 | 新建 |
| NESTED | 在当前事务里创建保存点，作为嵌套事务执行 | 新建，同 REQUIRED |
| SUPPORTS | 加入 | 以非事务方式执行 |
| MANDATORY | 加入 | 抛异常 |
| NOT_SUPPORTED | 挂起当前事务，以非事务方式执行 | 以非事务方式执行 |
| NEVER | 抛异常 | 以非事务方式执行 |

### REQUIRED、REQUIRES_NEW、NESTED 的区别

以"下单时顺带写一条操作日志"为例：外层 `placeOrder()` 调用另一个 Bean 的 `writeLog()`，比较 `writeLog()` 用三种传播行为时的效果：

| 情况 | REQUIRED | REQUIRES_NEW | NESTED |
| --- | --- | --- | --- |
| 物理事务和连接 | 同一个事务、同一个连接 | 两个独立的事务，各用一个连接 | 同一个事务，内层开始前设保存点 |
| 内层抛异常，外层 catch 住后继续执行 | 整个事务已被标记为只能回滚，外层提交时抛 UnexpectedRollbackException，全部回滚 | 只有内层回滚，外层正常提交 | 回滚到保存点，外层正常提交 |
| 内层成功，外层之后失败 | 一起回滚 | 内层已经提交，不受影响 | 一起回滚 |
| 适合 | 绝大多数业务 | 不管主流程成败都要留下的记录：操作日志、失败记录 | 可选的子步骤：失败不影响主流程，主流程失败要一起撤销 |

两个要注意的地方：

- **REQUIRES_NEW 会多占一个连接**：外层的连接一直被占着，内层还要再借一个。官方文档提醒，并发线程都在外层事务里等内层的连接时，连接池可能被耗尽甚至死锁，连接池大小至少要比并发线程数多 1。如果内层要改外层已经改过（加了行锁）的同一行，内层会一直等外层释放锁，而外层在等内层返回，只能等到锁等待超时
- **NESTED 依赖 JDBC 保存点**：`DataSourceTransactionManager`（包括 Spring Boot 默认配置的子类 `JdbcTransactionManager`）默认支持；`JpaTransactionManager` 默认不允许，手动打开后保存点也只作用于 JDBC 连接，JPA 本身不支持嵌套事务；其他事务管理器要看各自的文档

### 事务失效的常见场景

| 场景 | 原因 | 解决 |
| --- | --- | --- |
| 同一个类里的方法互相调用 | `this.xxx()` 直接调用目标对象，没经过代理 | 把事务方法挪到另一个 Bean；或者注入自身的代理再调用；或者用 TransactionTemplate 编程式事务 |
| 方法是 private、final、static | 代理拦截不到。Spring 6 起 CGLIB 代理下 protected 和包可见的方法可以生效，接口代理仍然只拦截 public 方法 | 改成 public、非 final 的实例方法 |
| 对象是自己 new 出来的 | 不是 Spring 容器里的代理对象 | 从容器注入 |
| 异常在方法里被 catch 后没有抛出 | 代理看不到异常，按正常返回提交 | 重新抛出；或调用 `TransactionAspectSupport.currentTransactionStatus().setRollbackOnly()` |
| 抛出的是受检异常（如 IOException、继承 Exception 的业务异常） | 默认只对 RuntimeException 和 Error 回滚，受检异常照样**提交** | `@Transactional(rollbackFor = Exception.class)`；Spring 6.2 起也可以用 `@EnableTransactionManagement(rollbackOn = RollbackOn.ALL_EXCEPTIONS)` 全局修改 |
| 在新线程、`@Async`、并行流里操作数据库 | 事务绑定在当前线程上，新线程拿到的是另一个连接，不在事务里；子线程的异常也不会让主线程的事务回滚 | 数据库操作留在事务所在的线程，或者拆成各自独立的事务并做好补偿 |
| 传播行为配成了 NOT_SUPPORTED、NEVER，或者没有外层事务时用了 SUPPORTS | 本来就不在事务里执行 | 按需改回 REQUIRED |
| 表是 MyISAM，或多数据源时用错了事务管理器 | 存储引擎不支持事务；事务开在了另一个数据源的连接上 | 换 InnoDB；用 `@Transactional("orderTransactionManager")` 指定事务管理器 |

### 事务和 MySQL 隔离级别

`@Transactional(isolation = ...)` 默认是 `Isolation.DEFAULT`，即沿用数据库自己的级别，InnoDB 是可重复读。指定其他级别时，事务管理器会在开启事务时调用 `Connection.setTransactionIsolation` 修改这个连接的隔离级别，结束后再恢复。各级别能避免什么问题见 [事务隔离级别](/basics/mysql/05-isolation-levels)。

隔离级别、超时、只读这些设置**只在新开事务时生效**。方法以 REQUIRED 加入外层事务时，自己声明的这些设置会被静默忽略，沿用外层事务的；想在隔离级别或只读设置不一致时直接报错，可以把事务管理器的 `validateExistingTransaction` 设为 true。

## 代码示例：日志用独立事务，受检异常也回滚

```java
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuditLogService {
    private final AuditLogMapper auditLogMapper; // MyBatis Mapper，定义省略

    public AuditLogService(AuditLogMapper auditLogMapper) {
        this.auditLogMapper = auditLogMapper;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW) // 独立提交，不受下单结果影响
    public void record(String message) {
        auditLogMapper.insert(message);
    }
}
```

```java
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderService {
    private final OrderMapper orderMapper; // MyBatis Mapper，定义省略
    private final StockMapper stockMapper; // 同上
    private final AuditLogService auditLogService; // 另一个 Bean，调用会经过它的代理

    public OrderService(OrderMapper orderMapper, StockMapper stockMapper, AuditLogService auditLogService) {
        this.orderMapper = orderMapper;
        this.stockMapper = stockMapper;
        this.auditLogService = auditLogService;
    }

    // StockException 是继承 Exception 的受检异常，不加 rollbackFor 时抛出它事务会提交
    @Transactional(rollbackFor = Exception.class)
    public void placeOrder(long productId, int quantity) throws StockException {
        orderMapper.insert(productId, quantity);
        try {
            auditLogService.record("下单，商品 " + productId);
        } catch (RuntimeException e) {
            // 日志写失败只回滚日志自己的事务，下单继续
        }
        // 条件更新：UPDATE stock SET num = num - ? WHERE product_id = ? AND num >= ?，返回影响行数
        if (stockMapper.deduct(productId, quantity) == 0) {
            throw new StockException("库存不足"); // 订单回滚；上面已经独立提交的日志保留
        }
    }
}
```

## 面试官可能追问

::: details 内层 REQUIRED 方法抛了异常，外层 catch 住了，为什么还是报 UnexpectedRollbackException？
内层和外层是同一个物理事务。内层的事务拦截器看到异常后，会把这个共享的事务标记为"只能回滚"；外层虽然 catch 住了异常，最后仍然尝试提交，Spring 发现标记后执行回滚，并抛出 UnexpectedRollbackException，告诉调用方"你以为提交了，其实回滚了"。想让内层失败不影响外层，内层要用 REQUIRES_NEW 或 NESTED，或者内层根本不要声明事务。
:::

::: details 事务提交之后才发 MQ、删缓存，应该怎么写？
在事务方法里直接发消息，事务后面回滚了，消息却已经发出去了。可以发布一个 Spring 事件，用 `@TransactionalEventListener` 监听，它默认在事务提交成功后（AFTER_COMMIT 阶段）才执行；也可以用 `TransactionSynchronizationManager.registerSynchronization` 注册 `afterCommit` 回调。回调里如果还要写数据库，要放进 REQUIRES_NEW 的新事务，因为原事务已经提交，不会再提交一次。
:::

::: details 在 @Transactional 方法里用 synchronized 防止超卖，为什么还会超卖？
synchronized 包住的是方法体，而事务是在代理里、方法返回之后才提交的。线程 A 执行完方法体、释放了锁，但还没提交，线程 B 拿到锁后读到的还是旧库存，照样扣减。锁的范围必须覆盖事务的提交，比如在调用事务方法的外层加锁；多实例部署时要用数据库行锁（`SELECT ... FOR UPDATE`）、条件更新（`UPDATE ... SET stock = stock - 1 WHERE stock > 0`）或分布式锁。
:::

## 易错点

- 默认只对 RuntimeException 和 Error 回滚，抛出受检异常时事务会**提交**
- REQUIRES_NEW 的内层提交后，外层再回滚也撤销不了它
- NESTED 不是新开一个事务，而是同一个事务里的保存点，外层回滚时内层一起回滚
- 加入已有事务时，内层声明的隔离级别、超时、readOnly 都不起作用
