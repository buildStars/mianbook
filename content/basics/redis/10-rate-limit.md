---
difficulty: 2
tags: [场景题, 手写题]
---

# 怎么用 Redis 实现限流？

::: tip 一句话回答
常见的有三种算法：**固定窗口**用 `INCR` 计数、过期时间作为窗口，最简单，但窗口交界处可能放过两倍的流量；**滑动窗口**用 ZSet 记录每次请求的时间戳，统计最近一个窗口内的请求数，更精确但更占内存；**令牌桶**按固定速率补充令牌、每个请求消耗一个，允许一定的突发。"读取、判断、写回"必须是原子的，所以要用 **Lua 脚本**或原子命令，否则并发请求会读到同样的计数而多放行。服务部署了多个实例时，计数要放在 Redis 这样的**共享存储**里，进程内计数只能限制单个实例。
:::

## 详细解析

### 为什么用 Redis

服务通常部署多个实例，请求经过负载均衡分到不同的实例上。如果每个实例在内存里各自计数，限额 100 次/分钟、部署 5 个实例，实际放行的可能接近 500 次；分配不均时，还会有的实例早早开始拒绝、有的还很空闲。Redis 作为共享的计数器，所有实例看到的是同一个数字。代价是每个请求多一次 Redis 往返，以及要考虑 Redis 不可用时怎么办。

### 固定窗口

```lua
-- KEYS[1]：如 rate:user:1001:28763412（用户 ID + 当前是第几分钟）；ARGV[1]：窗口毫秒数
local n = redis.call('INCR', KEYS[1])
if n == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return n
```

返回值超过限额就拒绝。INCR 和 PEXPIRE 放在同一个脚本里，是为了避免 INCR 成功后客户端崩溃，留下一个没有过期时间的 key：这里的 key 带着分钟编号，后果是它永远不会被清理；如果 key 里不带时间、只靠过期时间划分窗口，这个用户就会被一直限流。

**临界突刺**：限额是每分钟 100 次，用户在 0:59 发了 100 次、1:00 又发了 100 次，两个窗口各自都没超限，但 2 秒内放过了 200 次。

### 滑动窗口

用 ZSet 记录每次请求，score 是请求时间，统计"最近 60 秒"内的请求数，窗口随时间平滑移动，没有临界突刺：

```lua
-- KEYS[1]：限流 key；ARGV：当前毫秒时间、窗口毫秒数、限额、本次请求的唯一 ID
local now, window, limit = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window) -- 清掉窗口之外的记录
if redis.call('ZCARD', KEYS[1]) < limit then
  redis.call('ZADD', KEYS[1], now, ARGV[4])
  redis.call('PEXPIRE', KEYS[1], window)
  return 1
end
return 0
```

缺点是每个请求都要占一个元素，限额很大（比如每分钟上万次）时，内存和 CPU 开销都不小。适合限额不大、要求精确的场景，比如短信验证码。这里的当前时间由调用方传入，多台应用服务器时钟不一致时会有偏差，也可以像下面的令牌桶一样在脚本里取 Redis 的时间。

### 令牌桶和漏桶

| 算法 | 思路 | 特点 |
| --- | --- | --- |
| 令牌桶 | 按固定速率往桶里放令牌，桶满了就不再放；每个请求拿走一个令牌，没有令牌就拒绝 | 长期速率受限，同时允许不超过桶容量的突发 |
| 漏桶 | 请求先进入队列，以固定速率流出处理 | 输出完全平滑，不允许突发，多出来的请求排队或丢弃 |

令牌桶不需要真的有个定时器往桶里放令牌：每次请求时，根据距离上次请求过了多久，算出这段时间应该补充多少令牌就行。这个"读取、计算、写回"必须是原子的，否则两个并发请求读到同样的令牌数，都判断够用，就会多放行，所以要写成 Lua 脚本。

## 代码示例

令牌桶（Node.js + ioredis + Lua）：

```js
const TOKEN_BUCKET = `
local capacity = tonumber(ARGV[1])  -- 桶容量，即允许的最大突发
local rate = tonumber(ARGV[2])      -- 每秒补充的令牌数
local t = redis.call('TIME')        -- 用 Redis 服务器的时间，避免各应用服务器时钟不一致
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local bucket = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(bucket[1]) or capacity
local ts = tonumber(bucket[2]) or now

-- 按流逝的时间补充令牌，最多补满
tokens = math.min(capacity, tokens + math.max(0, now - ts) / 1000 * rate)
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
-- 闲置到桶被补满之后，这个 key 就没有保存的必要了
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate * 1000) + 1000)
return { allowed, math.floor(tokens) }
`

redis.defineCommand('tokenBucket', { numberOfKeys: 1, lua: TOKEN_BUCKET })

// Express 中间件：每个 IP 最多突发 20 次，每秒补充 5 个令牌
async function rateLimit(req, res, next) {
  try {
    const [allowed] = await redis.tokenBucket(`rl:ip:${req.ip}`, 20, 5)
    if (!allowed) return res.status(429).set('Retry-After', '1').send('请求太频繁，请稍后再试')
  } catch (err) {
    console.error('限流组件异常，本次放行', err) // Redis 不可用时放行（fail open）
  }
  next()
}
```

## 面试官可能追问

::: details Redis 挂了，限流怎么办？
先定策略：一般的业务接口选择放行（fail open），保证可用性，同时告警；短信、登录这类防刷场景宁可拒绝（fail closed）。也可以退化成进程内的本地限流，把总限额按实例数平分，虽然不精确，但能挡住大部分流量。调用 Redis 要设置较短的超时，不能让限流组件变慢拖垮业务。
:::

::: details 为什么用 Lua 脚本，而不用 MULTI 事务？
MULTI 只是把命令打包、依次执行，事务里拿不到前一条命令的结果，没法实现"读出令牌数、计算、再写回"这种依赖中间结果的逻辑；用 WATCH 做乐观锁，又会在高并发下频繁失败重试。Lua 脚本在 Redis 里原子执行，读、判断、写一次完成，还减少了网络往返。脚本要短小，它执行期间会阻塞其他命令；Cluster 下脚本用到的 key 必须通过 KEYS 传入，并且在同一个槽里。
:::

::: details 限流按什么维度？被限流时应该返回什么？
常见维度有用户 ID、IP、接口、租户，可以组合使用，比如每个用户每个接口单独限流，同时对整个接口设一个总上限。未登录的请求只能按 IP 限流，要注意同一个出口 IP 后面可能有很多正常用户。被限流时返回 HTTP 429，并用 `Retry-After` 告诉客户端多久后再试，客户端按它退避，而不是立刻重试。
:::

## 易错点

- `INCR` 和 `EXPIRE` 分成两条命令发送不是原子的，可能产生永不过期的计数 key
- 多实例部署时用进程内计数，实际的限额会被成倍放大
- Lua 脚本返回小数时会被截断成整数，需要小数要转成字符串返回
- 窗口的时间如果用应用服务器的本地时间，多台机器时钟不一致会导致计数偏差
