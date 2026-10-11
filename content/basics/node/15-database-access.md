---
difficulty: 2
tags: [高频, 实践, 对比]
---

# Node.js 怎么访问数据库？连接池、事务和 ORM 怎么选？

::: tip 一句话回答
建立数据库连接要经过 TCP 握手和认证，开销大，所以服务端用**连接池**：预先建立一批连接反复复用，并限制最大连接数。池的大小要从全局算：**实例数 × 每个实例的进程数 × 每个池的上限**必须小于数据库的 `max_connections`。最常见的坑是**连接泄漏**：手动取出的连接在出错分支里没有归还，池很快被耗尽，所有请求都卡在等连接。事务必须在**同一个连接**上执行，用 try/catch/finally 保证提交或回滚后一定 `release`。SQL 一律用**参数化查询**防注入。ORM 的选择看团队：要类型安全和开发效率用 Prisma 或 Drizzle，要贴近 SQL 用查询构建器（如 Knex、Kysely），无论用哪个都要警惕 **N+1 查询**。
:::

## 详细解析

### 连接池怎么配

```text
          ┌─ 实例 1：4 个进程 × 每个池 10 个连接 = 40
负载均衡 ─┼─ 实例 2：40
          └─ 实例 3：40          合计 120，必须小于 MySQL 的 max_connections（默认 151）
```

- **不是越大越好**：数据库能并行执行的查询受 CPU 核数和磁盘限制，连接太多只会增加数据库的上下文切换和锁竞争。池满时让请求短暂排队，通常比无限加连接更好
- **扩容时重新算**：自动扩容把实例从 3 个扩到 10 个，连接总数跟着翻倍，可能直接打满数据库。连接数很紧张时，在应用和数据库之间加连接代理（如 ProxySQL，或云厂商的数据库代理）
- **设置排队上限和超时**：连接都被占用时，请求排队等待；排队的数量和时间都要有上限，超出就快速失败，避免请求无限堆积、拖垮整个服务
- **空闲连接回收**：数据库或中间的网络设备会关掉长时间空闲的连接，池要能检测并重建，或开启 TCP keepalive

### 连接泄漏

`pool.query()` / `pool.execute()` 会自动取连接、执行完自动归还，大多数查询直接用它们就行。只有事务这种需要在同一个连接上执行多条语句的场景，才用 `pool.getConnection()` 手动取连接，这时**每一条退出路径**都必须 `release()`：

- 中间某条 SQL 抛错，直接 `throw` 出去，`release` 没执行
- 提前 `return`（比如余额不足）时忘了归还
- 在 `await` 了一个永远不返回的下游调用之后才归还

症状是：流量不大但接口越来越慢，最后全部超时，数据库那边连接数却不高。监控连接池的"使用中 / 空闲 / 排队"数量能很快发现问题。

### 参数化查询

```js
// ❌ 拼接：用户输入会被当成 SQL 的一部分解析
pool.query(`SELECT * FROM users WHERE name = '${name}'`)
// ✅ 占位符：值和 SQL 分开处理，只会被当成数据
pool.execute('SELECT * FROM users WHERE name = ?', [name])
```

mysql2 中 `execute` 使用服务端预处理语句；`query` 配合 `?` 占位符时由客户端转义后再拼接，同样安全。占位符只能代替**值**，表名、列名、`ORDER BY` 的字段不能用 `?`，要用白名单校验。更多注入相关的防御见 [Node.js 服务常见的安全问题](/basics/node/16-security)。

### ORM 和查询构建器怎么选

| | 风格 | 优点 | 需要注意 |
| --- | --- | --- | --- |
| Prisma | 用独立的 schema 文件定义模型，生成类型安全的客户端 | 类型推导完善，迁移工具完整，上手快 | 复杂 SQL 要退回原生查询；生成的 SQL 不一定是最优的 |
| Drizzle | 用 TS 代码定义表，API 接近 SQL | 类型安全、轻量，写出来的查询和 SQL 一一对应 | 需要团队熟悉 SQL |
| TypeORM | 用装饰器定义实体，支持 Active Record 和 Data Mapper | 和 NestJS 搭配常见，Java 背景的同学熟悉 | 部分查询的类型推导较弱，复杂关联查询容易写出低效 SQL |
| Knex、Kysely | 查询构建器，不做对象映射 | 贴近 SQL、可控；Kysely 还提供类型推导 | 关联、模型这些要自己处理 |

选择时看几点：团队对 SQL 的熟悉程度、对类型安全的要求、迁移工具是否好用、复杂查询能不能方便地退回原生 SQL。不管用哪个，都要能看到它**实际生成的 SQL**，开启查询日志并关注慢查询，见 [慢查询怎么排查](/basics/mysql/08-slow-query)。

### N+1 查询

```js
// ❌ 1 次查文章 + N 次查作者：100 篇文章就是 101 次查询
const [posts] = await pool.query('SELECT * FROM posts LIMIT 100')
for (const p of posts) {
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [p.userId])
  p.author = rows[0]
}

// ✅ 2 次查询：先查文章，再用 IN 一次查出所有作者，在内存中组装
const ids = [...new Set(posts.map((p) => p.userId))]
// mysql2 的 query 会把数组展开成 (1, 2, 3)，execute 不支持这种展开；ids 为空时要提前返回
const [users] = await pool.query('SELECT * FROM users WHERE id IN (?)', [ids])
const userMap = new Map(users.map((u) => [u.id, u]))
for (const p of posts) p.author = userMap.get(p.userId)
```

ORM 的懒加载最容易藏住 N+1：循环里访问 `post.author` 时，每次都悄悄发一条查询。用 ORM 提供的预加载（如 Prisma 的 `include`、TypeORM 的 `relations`）或 JOIN 一次取回；GraphQL 这类按字段解析的场景，用 DataLoader 把同一轮的多次查询合并成一次。

## 代码示例

```js
import mysql from 'mysql2/promise'

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: 'shop',
  connectionLimit: 10,      // 每个进程最多 10 个连接
  waitForConnections: true, // 连接用完时排队等待，而不是立即报错
  queueLimit: 100,          // 排队上限，超过就快速失败
  enableKeepAlive: true,
})

// 转账：两条更新要么都成功，要么都回滚
export async function transfer(fromId, toId, amount) {
  const conn = await pool.getConnection() // 事务必须在同一个连接上执行
  try {
    await conn.beginTransaction()
    const [res] = await conn.execute(
      'UPDATE account SET balance = balance - ? WHERE id = ? AND balance >= ?',
      [amount, fromId, amount],
    )
    if (res.affectedRows !== 1) throw new Error('余额不足')
    await conn.execute('UPDATE account SET balance = balance + ? WHERE id = ?', [amount, toId])
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release() // 无论成功失败都要归还，否则连接泄漏
  }
}
```

## 面试官可能追问

::: details 事务里能调用外部 HTTP 接口吗？
尽量不要。事务期间这个连接一直被占用，更新过的行上的锁也一直持有，外部接口慢几秒，就会有更多请求排队等锁、等连接。做法是把外部调用移到事务之外：先调用、再开事务写库；或者先提交事务，再通过消息队列异步通知。需要跨服务的一致性时，见 [分布式事务](/basics/distributed/02-distributed-transaction)。
:::

::: details Node.js 是单线程的，为什么还需要多个连接？
单线程只是说 JS 在一个线程上执行，数据库查询是异步 I/O，同一时刻可以有很多查询在等待结果。一个连接同一时间只能执行一条语句，后面的查询要排队；多个连接才能让多条查询在数据库端并行执行。但连接数受数据库承受能力限制，见上面的计算。
:::

::: details 怎么在多个 Service 之间共享同一个事务？
最直接的是把连接（或 ORM 的事务对象）作为参数传给每个函数。参数传递繁琐时，可以用 [AsyncLocalStorage](/basics/node/12-async-local-storage) 把当前事务放进上下文，数据访问层优先从上下文取事务连接，取不到再用连接池。一些 ORM 和 NestJS 的事务插件就是这么实现的。
:::

## 易错点

- 手动 `getConnection()` 后在异常分支忘了 `release`，连接池被慢慢耗尽
- 在事务中用 `pool.query()`：它会从池里另取一个连接，不在当前事务里
- 用占位符代替表名或排序字段，或者对它们直接拼接用户输入
- 只按单个进程配置池大小，忽略了实例数和进程数，扩容后打满数据库
