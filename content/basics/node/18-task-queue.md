---
difficulty: 2
tags: [实践, 场景题]
---

# Node.js 里定时任务和后台任务怎么做？

::: tip 一句话回答
`setInterval` 和 node-cron 这类库只在**当前进程**里计时，服务部署了多个实例或多个进程，同一个任务就会**重复执行**；进程重启时正在执行的任务也会丢失。常见做法：耗时的工作不要放在请求里同步完成，而是**投递到任务队列**，由独立的 worker 进程消费，例如基于 Redis 的 **BullMQ**，它支持延迟任务、失败重试、并发控制和定时调度。只能让多个实例中的一个执行的简单定时任务，可以加**分布式锁**。无论哪种方案，任务都可能被执行不止一次，所以任务本身要做成**幂等**的。
:::

## 详细解析

### 进程内定时器的问题

| 问题 | 原因 |
| --- | --- |
| 重复执行 | 3 个实例 × 4 个 cluster 进程，`cron.schedule('0 3 * * *', ...)` 每天 3 点会执行 12 次 |
| 任务丢失 | 发布重启时正在执行的任务被中断；进程不在线的时间段里该执行的任务不会补上 |
| 不可观测 | 执行成功还是失败、执行了多久，只能翻日志 |
| 拖慢服务 | 定时任务和接口跑在同一个事件循环里，重计算会让接口变慢 |

单实例的小工具、开发环境的清理任务，用进程内定时器没问题；生产环境的多实例服务需要下面的方案。

### 把耗时任务从请求中移出

发邮件、生成报表、处理上传的视频、调用很慢的第三方接口，都不应该让用户的请求等着：

```text
请求 → 校验参数 → 写库 → 投递任务 → 立即返回"处理中"（或任务 ID）
                              │
                         任务队列（Redis）
                              │
                worker 进程取出任务执行 → 失败按策略重试 → 结果写库 / 通知用户
```

好处是接口响应快、削峰（瞬时的大量任务在队列中排队，worker 按自己的能力消费），worker 可以独立扩容，崩溃了也不影响接口。消息队列的通用价值见 [为什么要用消息队列](/basics/distributed/04-mq-why)。

### BullMQ 提供了什么

| 能力 | 用法 |
| --- | --- |
| 延迟任务 | `queue.add(name, data, { delay: 60_000 })`，比如下单 30 分钟未支付自动取消 |
| 失败重试 | `attempts` 设置最多执行几次，`backoff` 设置固定间隔或指数退避 |
| 并发控制 | Worker 的 `concurrency` 控制单个进程同时处理几个任务；`limiter` 限制单位时间内处理的数量，用于保护第三方接口 |
| 去重 | 指定 `jobId`，同一个 ID 的任务还保存在 Redis 中（包括已完成但还没清理的）时，不会重复添加 |
| 定时调度 | `queue.upsertJobScheduler(id, { pattern: cron 表达式 }, 任务模板)`，按 ID 幂等地创建或更新，多个实例启动时都调用也只有一个调度器 |
| 可靠性 | worker 取任务时会加锁并定期续期，worker 崩溃后锁过期，任务被判定为卡住（stalled），重新交给其他 worker |

### 分布式锁：只让一个实例执行

不想引入任务队列时，可以在定时任务开始前抢一把锁：用 Redis 的 `SET key value NX PX 过期时间`，抢到的实例执行，其他实例跳过。锁要设置过期时间防止实例崩溃后死锁，释放时要校验是不是自己的锁，细节见 [Redis 分布式锁](/basics/redis/07-distributed-lock)。也可以把定时调度交给外部：Kubernetes 的 CronJob、云厂商的定时触发器，到点只启动一个执行实例。

### 任务必须幂等

重试、worker 崩溃后的重新执行、锁过期后另一个实例接手，都会让同一个任务执行不止一次，"恰好一次"在分布式环境中很难保证。所以任务要设计成执行多次和执行一次效果相同：用业务唯一键做去重（`INSERT ... ON DUPLICATE KEY`）、用状态机限制状态只能单向流转、发送通知前检查是否已发送。方法见 [消息的幂等消费](/basics/distributed/06-mq-idempotent)。

## 代码示例

```ts
import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis' // 较新版本的 BullMQ 不再自带 ioredis，要单独安装

// Worker 使用的连接必须设置 maxRetriesPerRequest: null
const connection = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
})

// ---- 生产者：接口里只负责投递 ----
const emailQueue = new Queue('email', { connection })

export async function onOrderPaid(orderId: string) {
  await emailQueue.add('order-paid', { orderId }, {
    jobId: `order-paid-${orderId}`,                // 同一个订单不会重复投递
    attempts: 5,                                   // 最多执行 5 次
    backoff: { type: 'exponential', delay: 1000 }, // 失败后按指数退避重试
    removeOnComplete: 1000,                        // 只保留最近 1000 个已完成的任务
    removeOnFail: 5000,
  })
}

// 定时任务：每个实例启动时都调用也没关系，同一个 ID 只有一个调度器
await emailQueue.upsertJobScheduler(
  'daily-report',
  { pattern: '0 3 * * *', tz: 'Asia/Shanghai' },
  { name: 'daily-report', data: {} },
)

// ---- 消费者：通常单独部署成 worker 进程 ----
const worker = new Worker('email', async (job) => {
  if (job.name === 'daily-report') return generateReport()
  await sendOrderEmail(job.data.orderId) // 抛出异常即视为失败，按 attempts 重试
}, { connection, concurrency: 5 })

worker.on('failed', (job, err) => {
  console.error(`任务 ${job?.id} 第 ${job?.attemptsMade} 次失败：${err.message}`)
})

// 优雅退出：等正在执行的任务完成再断开
process.on('SIGTERM', async () => {
  await worker.close()
  await connection.quit()
  process.exit(0)
})

declare function sendOrderEmail(orderId: string): Promise<void>
declare function generateReport(): Promise<void>
```

## 面试官可能追问

::: details 重试了 5 次都失败的任务怎么办？
任务会进入失败状态并保留下来（这里 `removeOnFail` 保留最近 5000 个），相当于死信。要对失败数量设置告警，排查原因后在管理界面或用脚本手动重试；对于明确不该重试的错误（如参数不合法），可以抛出 BullMQ 的 `UnrecoverableError` 让任务直接失败，不浪费重试次数。
:::

::: details 任务很耗 CPU，放在 worker 里会有什么问题？
worker 进程同样是单线程执行 JS，重计算会阻塞它的事件循环，导致任务锁不能按时续期，任务被误判为卡住，交给别的 worker 重复执行。CPU 密集的任务可以用 BullMQ 的沙箱处理器（把处理函数放在单独的文件中，在子进程或 worker 线程里运行），或者自己把计算交给 [worker_threads](/basics/node/06-multi-core)。
:::

::: details jobId 去重能保证同一个订单只发一封邮件吗？
不能完全保证。`jobId` 只在这个任务还保存在 Redis 中时起作用，已完成的任务被 `removeOnComplete` 清理后，同样的 ID 可以再次添加；而且任务执行到一半崩溃、重试时，邮件可能已经发出去了。真正的保证要靠任务内部的幂等：发送前检查并记录发送状态。
:::

## 易错点

- 多实例部署时直接用 `setInterval` 或 node-cron 跑定时任务，每个实例都执行一遍
- 在请求里 `await` 发邮件、生成报表这类耗时操作，接口变慢还会因为超时被客户端重试
- 以为任务队列能保证"恰好一次"，任务本身没有做幂等
- 退出时没有 `await worker.close()`，正在执行的任务被中断，只能等锁过期后重新执行
