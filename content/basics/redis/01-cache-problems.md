---
difficulty: 2
tags: [高频, 场景题]
---

# 缓存穿透、缓存击穿、缓存雪崩分别是什么？怎么解决？

::: tip 一句话回答
**穿透**：查询一个根本不存在的数据，缓存和数据库都没有，每次请求都打到数据库，用缓存空值或布隆过滤器解决。**击穿**：某个热点 key 过期的瞬间，大量并发请求同时打到数据库，用互斥锁或逻辑过期解决。**雪崩**：大量 key 同时过期或 Redis 宕机，用随机过期时间、高可用集群和限流降级解决。
:::

## 详细解析

| 问题 | 原因 | 解决方案 |
| --- | --- | --- |
| 缓存穿透 | 请求的数据在缓存和数据库里都不存在，常见于恶意请求（如 `id = -1`） | 缓存空值（过期时间设短一些）；布隆过滤器提前拦截；接口做参数校验 |
| 缓存击穿 | **单个**热点 key 过期，大量并发请求同时查库 | 互斥锁（只让一个请求重建缓存）；逻辑过期（不设 TTL，发现过期后异步刷新）；热点数据不过期 |
| 缓存雪崩 | **大量** key 同时过期，或 Redis 整体不可用 | 过期时间加随机值；主从 + 哨兵或集群保证高可用；多级缓存；限流、降级、熔断 |

## 代码示例

下面用互斥锁防击穿，顺带处理穿透和雪崩（Node.js + ioredis）：

```js
async function getProduct(id) {
  const key = `product:${id}`
  const cached = await redis.get(key)
  // 空字符串表示缓存的"数据不存在"
  if (cached !== null) return cached === '' ? null : JSON.parse(cached)

  // SET NX EX：原子地加锁并设置过期时间，防止进程崩溃后锁一直不释放
  const lockKey = `lock:${key}`
  const locked = await redis.set(lockKey, '1', 'EX', 10, 'NX')
  if (!locked) {
    await sleep(50)
    return getProduct(id) // 没抢到锁，稍后重试
  }

  try {
    // 双重检查：等锁期间别的请求可能已经重建了缓存
    const again = await redis.get(key)
    if (again !== null) return again === '' ? null : JSON.parse(again)

    const product = await db.findProduct(id)
    if (product) {
      // 过期时间加随机值，防止大量 key 同时过期
      await redis.set(key, JSON.stringify(product), 'EX', 3600 + Math.floor(Math.random() * 600))
    } else {
      await redis.set(key, '', 'EX', 60) // 缓存空值，防止穿透
    }
    return product
  } finally {
    await redis.del(lockKey)
  }
}
```

## 面试官可能追问

::: details 布隆过滤器的原理和缺点？
它由一个位数组和多个哈希函数组成。写入时用多个哈希函数算出几个位置并置为 1；查询时只要有一个位置是 0，就**一定不存在**；全是 1 只能说明**可能存在**。缺点是存在误判，而且标准的布隆过滤器不支持删除（可以用计数布隆过滤器）。
:::

::: details 互斥锁和逻辑过期怎么选？
互斥锁保证数据一致，但没抢到锁的请求要等待，接口会变慢；逻辑过期性能好，过期后先返回旧数据、再异步重建，但会短时间返回旧数据。看业务更看重一致性还是可用性。
:::

::: details 上面代码里的锁有什么问题？
释放锁时直接 `del`，可能误删别人的锁：如果业务执行时间超过了锁的 10 秒过期时间，锁已经被别的请求拿到，这时删掉的就是别人的锁。正确做法是加锁时写入唯一值，释放时用 Lua 脚本判断"是自己的锁才删除"，保证判断和删除是原子操作。
:::

## 易错点

- 击穿针对**一个**热点 key，雪崩针对**一大批** key 或整个缓存层，不要混淆
- 缓存空值要设较短的过期时间，否则数据真正写入后，在空值过期前都查不到
