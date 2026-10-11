---
difficulty: 2
tags: [高频, 实践]
---

# Go 的 database/sql 连接池怎么配置？事务和 ORM 怎么用？

::: tip 一句话回答
`sql.DB` 不是一个连接，而是**并发安全的连接池**，整个进程创建一个、全局复用。上线前要设置 `SetMaxOpenConns`（最大连接数，默认不限）、`SetMaxIdleConns`（最大空闲连接数，默认 2）、`SetConnMaxLifetime` 和 `SetConnMaxIdleTime`，总连接数按"实例数 × 每实例最大连接数"不超过数据库的 `max_connections` 来算。查询用带 Context 的方法并传入 ctx，用完 **rows 一定要 Close**；事务用 `BeginTx` 加 `defer tx.Rollback()`。SQL 一律用**参数占位符**防注入。ORM 按团队偏好在 GORM、sqlx、sqlc 之间选。
:::

## 详细解析

### sql.DB 是连接池

`sql.Open` 只校验参数、创建池对象，**不会真正连接数据库**，要用 `PingContext` 检查能否连通。正确的用法是程序启动时 Open 一次，注入到各个模块里使用；每个请求都 Open、Close，等于不用连接池。每次查询从池里取一个空闲连接，没有就新建；达到 MaxOpenConns 上限时排队等待，直到有连接被归还或者 ctx 超时。驱动返回 `driver.ErrBadConn` 表示连接已失效时，池会丢弃它、换一个连接重试，业务代码一般不用自己处理重连。

### 四个参数怎么配

| 方法 | 含义 | 默认值 | 配置思路 |
| --- | --- | --- | --- |
| `SetMaxOpenConns(n)` | 最多同时打开的连接数（使用中 + 空闲） | 0，不限 | 不设的话流量高峰会把数据库连接数打满，一定要设 |
| `SetMaxIdleConns(n)` | 池里最多保留的空闲连接数 | 2 | 太小时连接用完就被关掉，高峰期频繁新建连接，一般设成和 MaxOpen 相同 |
| `SetConnMaxLifetime(d)` | 一个连接从创建起最多使用多久 | 不限 | 要比数据库的 `wait_timeout`，以及中间代理、负载均衡关闭空闲连接的时间短 |
| `SetConnMaxIdleTime(d)` | 连接空闲多久后关闭 | 不限 | 低峰期释放多余连接 |

MaxOpenConns 要从数据库这边倒推。假设 MySQL 的 `max_connections` 是 1000，扣掉给运维和其他服务预留的部分剩下 800，服务最多扩容到 20 个实例，每个实例最多 40 个连接。连接也不是越多越好，数据库的并发处理能力有限，连接太多只会加剧锁竞争和上下文切换。MySQL 驱动 go-sql-driver/mysql 的文档也建议 MaxIdle 和 MaxOpen 设成一样，ConnMaxLifetime 设得比 5 分钟短。用 `db.Stats()` 观察连接池：`WaitCount`、`WaitDuration` 持续增长说明连接不够用、请求在排队；`MaxIdleClosed` 涨得快说明 MaxIdle 太小。建议把这些指标接入监控。

### 查询、事务和参数化

- **传 ctx**：用 `QueryContext`、`QueryRowContext`、`ExecContext`，请求超时或客户端断开时，查询和等待连接都能及时取消
- **rows 必须关闭**：`QueryContext` 返回的 rows 占着一个连接，直到遍历完或者调用 Close 才归还。忘了 Close（比如提前 return）就是连接泄漏，最终所有请求都卡在等连接上。遍历结束后还要检查 `rows.Err()`
- **ErrNoRows**：`QueryRow(...).Scan` 查不到数据时返回 `sql.ErrNoRows`，用 `errors.Is` 判断，转换成业务的"不存在"错误，见 [Go 的错误处理](/basics/go/10-error-handling)
- **事务**：`tx, err := db.BeginTx(ctx, nil)` 之后紧跟 `defer tx.Rollback()`。中途任何一步 return 都会自动回滚；Commit 成功后再 Rollback 只会返回 `sql.ErrTxDone`，没有副作用。ctx 被取消时，database/sql 也会回滚事务。事务的原理见 [事务的 ACID](/basics/mysql/04-transaction-acid)
- **参数化**：值一律用占位符传，MySQL 用 `?`，PostgreSQL 用 `$1`，不要用 `fmt.Sprintf` 拼 SQL。表名、列名、排序方向不能用占位符，要用白名单校验

## 代码示例

```go
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	_ "github.com/go-sql-driver/mysql" // 匿名导入，注册 mysql 驱动
)

var ErrUserNotFound = errors.New("user not found")

type User struct {
	ID   int64
	Name string
}

func openDB(dsn string) (*sql.DB, error) { // dsn 如 user:pass@tcp(127.0.0.1:3306)/shop?parseTime=true
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(40)
	db.SetMaxIdleConns(40)
	db.SetConnMaxLifetime(3 * time.Minute)
	db.SetConnMaxIdleTime(time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil { // Open 不连库，这里才真正连接
		db.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return db, nil
}

func getUser(ctx context.Context, db *sql.DB, id int64) (*User, error) {
	var u User
	err := db.QueryRowContext(ctx, "SELECT id, name FROM users WHERE id = ?", id).Scan(&u.ID, &u.Name)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get user %d: %w", id, err)
	}
	return &u, nil
}

func listUsers(ctx context.Context, db *sql.DB, limit int) ([]User, error) {
	rows, err := db.QueryContext(ctx, "SELECT id, name FROM users ORDER BY id LIMIT ?", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close() // 不关闭，这个连接就一直不会归还
	users := make([]User, 0, limit)
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Name); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err() // 遍历中途的错误只能从这里拿到
}

func transfer(ctx context.Context, db *sql.DB, from, to, amount int64) error {
	tx, err := db.BeginTx(ctx, nil) // 之后的语句都要用 tx 执行，用 db 会拿到另一个连接，不在事务里
	if err != nil {
		return err
	}
	defer tx.Rollback() // 提交成功后再调用只返回 ErrTxDone，没有副作用
	if _, err := tx.ExecContext(ctx, "UPDATE accounts SET balance = balance - ? WHERE id = ?", amount, from); err != nil {
		return err // 任何一步出错直接 return，defer 负责回滚
	}
	if _, err := tx.ExecContext(ctx, "UPDATE accounts SET balance = balance + ? WHERE id = ?", amount, to); err != nil {
		return err
	}
	return tx.Commit()
}
```

## 面试官可能追问

::: details GORM、sqlx、sqlc 怎么选？
三者的思路不同。GORM 是完整的 ORM，有关联、钩子、自动迁移，CRUD 写得快，但复杂查询生成的 SQL 不直观，要注意 N+1 查询和零值字段不更新这类坑。sqlx 是 database/sql 的增强，SQL 自己写，提供把结果扫描到结构体、命名参数等便利。sqlc 根据手写的 SQL 和表结构**生成**类型安全的 Go 代码，SQL 写错在生成阶段就能发现。注重性能和 SQL 可控的团队常用 sqlc 或 sqlx，后台管理类、CRUD 多的项目用 GORM 更省事。Node.js 这边的对比见 [Node.js 怎么访问数据库](/basics/node/15-database-access)。
:::

::: details 带参数的查询，database/sql 底层是怎么执行的？
以 go-sql-driver/mysql 为例，默认情况下会在连接上先 prepare 语句，再带着参数执行，然后关闭语句，一次查询要和数据库来回多次，但 SQL 和参数是分开传的，能防注入。它可以开启 `interpolateParams=true`，由驱动在客户端把参数安全地转义后拼进 SQL，一次往返就够了；驱动文档提醒，在 GBK 等部分多字节字符集下不要开启。
:::

::: details 连接数不够时会发生什么？怎么发现？
达到 MaxOpenConns 后，新的查询会阻塞等待空闲连接，等到 ctx 超时就返回错误，表现为接口变慢、偶发超时，数据库那边反而很空闲。看 `db.Stats()` 的 WaitCount、WaitDuration 能确认。先排查是不是有 rows 没关闭、事务没结束、在事务里调用了耗时的外部接口，确认确实是并发高再调大连接数。
:::

## 易错点

- 每次请求都调用 `sql.Open`，或者用完立刻 `db.Close()`，连接池形同虚设；只设了 MaxOpenConns，MaxIdleConns 还是默认的 2，高峰期连接被反复创建和关闭
- 在循环里 `defer rows.Close()`，defer 要等函数返回才执行，循环期间连接全都占着，应该把每次查询拆成单独的函数
- 开了事务却用 db 执行其中一部分语句，这部分不在事务里；或者在 rows 没遍历完时用同一个 tx 执行其他语句，部分驱动会报错
