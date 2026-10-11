---
difficulty: 2
tags: [高频, 原理, 实践]
---

# 死锁是怎么产生的？怎么预防和排查？

::: tip 一句话回答
死锁是两个或多个线程**互相等待对方持有的资源**，谁都无法继续。它同时需要四个条件：**互斥、持有并等待、不可剥夺、循环等待**，破坏任意一个就不会死锁。工程上最常用的是**固定加锁顺序**来破坏循环等待，再配合**加锁超时**和**缩小锁的范围**。排查时先拿到所有线程的堆栈：Java 用 `jstack`，Go 看 goroutine dump，MySQL 看 `SHOW ENGINE INNODB STATUS` 里的死锁日志。
:::

## 详细解析

### 四个必要条件

| 条件 | 含义 | 破坏的办法 |
| --- | --- | --- |
| 互斥 | 资源同一时刻只能被一个线程持有 | 一般破坏不了；可以用无锁结构、读写锁减少互斥 |
| 持有并等待 | 拿着一个资源，又去申请另一个 | 一次性申请所有资源，拿不全就都不拿 |
| 不可剥夺 | 已持有的资源不能被强行拿走 | 申请不到就主动释放已持有的（tryLock + 超时后回退） |
| 循环等待 | A 等 B，B 等 A，形成环 | **按固定顺序加锁**，比如按 ID 从小到大 |

最典型的场景是转账：线程 1 执行 A 转给 B，先锁 A 再锁 B；线程 2 同时执行 B 转给 A，先锁 B 再锁 A。两边各拿到一把锁，都在等对方那一把。

### 预防和避免

- **固定加锁顺序**：最常用、最有效。所有代码都按同一个全局顺序加锁，就不会形成环
- **加锁超时**：用 `tryLock(timeout)`（Java 的 `ReentrantLock`）或数据库的锁等待超时，拿不到就释放已有的锁、稍后重试。要加随机退避，否则双方可能同步地不断重试，变成活锁
- **一次性申请**：把需要的锁一起拿到，适合资源少且能提前确定的情况
- **缩小锁的范围**：持有锁时不要调用外部接口、不要做 I/O，也不要在持有一把锁时调用可能加别的锁的未知代码（比如回调）
- **银行家算法**：每次分配前检查分配后系统是否还处在"安全状态"。它要求预先知道每个线程的最大需求，教科书里常讲，实际工程中很少用

### 排查

- **Java**：`jstack <pid>` 打印所有线程堆栈，JVM 能识别 `synchronized` 和 `java.util.concurrent` 锁构成的死锁，输出末尾有 `Found one Java-level deadlock`，列出各线程持有和等待的锁
- **Go**：所有 goroutine 都阻塞时，运行时直接报 `fatal error: all goroutines are asleep - deadlock!`。但真实服务里总有 goroutine 在等网络 I/O，这个检测不会触发，要通过 pprof 抓 goroutine dump（`/debug/pprof/goroutine?debug=2`），找调用栈停在 `sync.(*Mutex).Lock` 上、等待时间很长的 goroutine（状态栏会显示等待原因和分钟数，较新版本显示为 `sync.Mutex.Lock`，老版本是 `semacquire`），对比它们分别持有和等待哪把锁
- **C/C++**：`gdb -p <pid>` 后执行 `thread apply all bt`，看每个线程卡在哪个锁上
- **MySQL**：InnoDB 会自动检测死锁并回滚其中一个事务，用 `SHOW ENGINE INNODB STATUS` 查看最近一次死锁的详情，见 [MySQL 的锁](/basics/mysql/07-locks)

共同的现象是：CPU 不高，请求却卡住不返回，线程或连接数越积越多。

## 代码示例

两个 goroutine 交叉加锁（Go）：

```go
package main

import (
	"fmt"
	"sync"
	"time"
)

func main() {
	var a, b sync.Mutex
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		a.Lock()
		defer a.Unlock()
		time.Sleep(100 * time.Millisecond) // 放大时间窗口，让对方先拿到 b
		b.Lock()                           // 等待 b
		defer b.Unlock()
		fmt.Println("g1 done")
	}()
	go func() {
		defer wg.Done()
		b.Lock()
		defer b.Unlock()
		time.Sleep(100 * time.Millisecond)
		a.Lock() // 等待 a，形成环
		defer a.Unlock()
		fmt.Println("g2 done")
	}()
	wg.Wait() // fatal error: all goroutines are asleep - deadlock!
}
```

修复：按账户 ID 固定加锁顺序。

```go
type Account struct {
	ID      int
	mu      sync.Mutex
	Balance int
}

func Transfer(from, to *Account, amount int) {
	if from == to {
		return // sync.Mutex 不可重入，自己转给自己会锁死自己
	}
	first, second := from, to
	if first.ID > second.ID {
		first, second = second, first // ✅ 总是先锁 ID 小的
	}
	first.mu.Lock()
	defer first.mu.Unlock()
	second.mu.Lock()
	defer second.mu.Unlock()
	from.Balance -= amount
	to.Balance += amount
}
```

## 面试官可能追问

::: details 死锁、活锁和饥饿有什么区别？
死锁是大家都阻塞着等，谁也不动；活锁是线程都在运行，但不断地相互谦让、重试，事情始终做不完，比如两个线程拿不到锁就同时释放、同时重试；饥饿是某个线程长期拿不到资源，其他线程却在正常推进，比如非公平锁下的低优先级线程。活锁可以通过随机退避解决，饥饿可以用公平锁或调整优先级缓解。
:::

::: details 只有一把锁会死锁吗？
会。不可重入的锁被同一个线程再次加锁，就会自己等自己，Go 的 `sync.Mutex` 就是不可重入的。另外，加锁后忘记释放（比如异常路径上没有 unlock），后面所有想拿这把锁的线程都会永远等待，现象和死锁一样。用 `defer` 或 `try/finally` 保证释放。
:::

::: details 分布式系统里会有死锁吗？
会。多个服务各自持有一个分布式锁又去申请对方的锁，同样会形成环。分布式锁一般都设置过期时间，相当于自带超时，能打破无限等待，但锁过期时业务可能还没执行完，需要续期或做好幂等，见 [分布式锁](/basics/redis/07-distributed-lock)。
:::

## 易错点

- 四个条件是"必要条件"，同时满足才可能死锁，破坏一个就够了，不需要四个都处理
- 只给锁加超时而不做退避，容易从死锁变成活锁
- Go 的死锁检测只在"所有 goroutine 都阻塞"时才生效，不能依赖它发现线上服务的局部死锁
