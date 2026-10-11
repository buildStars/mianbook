---
difficulty: 3
tags: [实践, 场景题, 性能优化]
---

# Node.js 服务 CPU 飙高怎么排查？

::: tip 一句话回答
Node.js 只有一个主线程执行 JS，CPU 飙高往往意味着**主线程被同步代码占满**，表现是所有接口一起变慢、事件循环延迟升高。常见原因有：同步的重计算、**正则回溯**（ReDoS）、序列化或解析很大的 JSON、死循环、GC 过于频繁。排查思路是先用监控确认是**哪个进程、什么时候**开始的，再**采样 CPU profile**：本地用 `--cpu-prof` 或 `--inspect` 连 Chrome DevTools，线上从负载均衡摘掉一个实例后短时间采样，然后看**火焰图**里哪个函数的"平顶"最宽，它就是热点。
:::

## 详细解析

### 常见原因

| 原因 | 典型表现 | 处理 |
| --- | --- | --- |
| 同步重计算 | 某个接口一调用，所有接口一起变慢 | 优化算法；移到 worker_threads，见 [利用多核](/basics/node/06-multi-core) |
| 正则回溯（ReDoS） | 特定输入让单个请求卡住几秒甚至更久 | 改写正则、限制输入长度，见下文 |
| 大 JSON | 返回或解析几 MB 的数据，`JSON.stringify` / `JSON.parse` 占满 CPU | 分页、只取需要的字段、流式处理 |
| 死循环 | CPU 长期 100%，接口完全无响应，健康检查也超时 | 采样后看卡在哪个函数 |
| GC 频繁 | 内存接近上限，CPU 花在垃圾回收上 | 用 `--trace-gc` 观察，再按 [内存泄漏](/basics/node/08-memory-leak) 的思路排查 |
| 同步 API | 请求里调用 `fs.readFileSync`、`crypto.pbkdf2Sync`、`zlib.gzipSync` | 换成异步版本 |

**正则回溯**：JS 的正则引擎是回溯式的，嵌套量词这类写法（如 `(a+)+$`）在匹配失败时会尝试指数级数量的组合，一段很短的恶意输入就能把主线程卡住几秒以上。防御办法：避免嵌套量词和有重叠的分支；对输入先做长度限制；用户可控的正则交给 RE2 这类线性时间引擎（如 npm 的 `re2` 包）；用 eslint 的正则检查插件在开发阶段发现危险写法。

### 第一步：确认问题在主线程

- 系统层面：`top -H -p <pid>` 看是主线程还是其他线程（libuv 线程池、GC 线程）占用高
- 事件循环延迟：`perf_hooks.monitorEventLoopDelay()` 统计主线程被阻塞的程度，p99 持续升高说明有同步代码长时间占着主线程（原理见 [怎么发现事件循环被阻塞](/basics/node/02-io-model)）；`performance.eventLoopUtilization()` 反映事件循环有多大比例的时间在忙
- 关联变更和流量：是发布之后、某个大客户调用之后，还是定时任务触发时开始的

### 第二步：采样 CPU profile

| 方式 | 用法 | 适合 |
| --- | --- | --- |
| `--cpu-prof` | `node --cpu-prof --cpu-prof-dir=./prof app.js`，进程退出时写出 `.cpuprofile` 文件 | 本地复现、脚本类任务 |
| `--inspect` + DevTools | Chrome 打开 `chrome://inspect`，在 Performance 面板录制一段时间 | 本地或测试环境交互式分析 |
| `node:inspector` 模块 | 代码里调用 Profiler 采样指定时长，见下方示例 | 线上按需采样 |
| `--prof` | 输出 V8 的 tick 日志，再用 `node --prof-process` 生成文本报告 | 没有图形界面时 |
| 系统级工具 | Linux 的 `perf` 配合 `--perf-basic-prof`，以及 0x 这类火焰图工具 | 需要看到原生代码和系统调用 |

`.cpuprofile` 文件可以直接拖进 Chrome DevTools 的 Performance 面板或 VS Code 打开。

### 怎么读火焰图

- 0x 这类工具画的经典火焰图（speedscope 的 Left Heavy 视图同理）：纵轴是**调用栈**，下面的函数调用了上面的函数；横轴是**采样占比**，同一个调用栈的样本合并在一起，宽度代表在 CPU 上花的时间，不代表时间先后
- Chrome DevTools Performance 面板显示的是**火焰图表**（flame chart）：横轴是**时间线**，调用栈从上往下长，能看到每次调用发生的时刻。要看汇总的热点，切到 Bottom-Up 视图按 Self Time 排序
- 在经典火焰图中找**顶部又宽又平的块**：它是自己在执行（self time 高），而不是在等子函数，最可能是热点
- 某个业务函数整体很宽、但最上层是 `JSON.stringify`、`RegExp` 或 GC 相关的帧，说明时间花在序列化、正则或回收上
- 特殊节点：`(idle)` 是空闲，大片的 `(idle)` 说明 CPU 并不忙，问题可能在 I/O 或下游；`(garbage collector)` 是 GC 时间；`(program)` 是引擎自身和原生代码中无法归到某个 JS 函数的时间

### 线上采样的安全做法

1. 先把目标实例从负载均衡中摘掉，或者挑一个实例单独引流，避免采样影响用户
2. 只采 10～30 秒，采样本身也会增加 CPU 开销
3. 调试端口只监听 `127.0.0.1`，通过 SSH 隧道访问；不要把 9229 暴露到公网，连上调试端口就能执行任意代码
4. 代码里提供的采样入口要鉴权，或者只在内网的管理端口上开放，并限制并发和频率

## 代码示例

```js
import { Session } from 'node:inspector/promises'
import { writeFile } from 'node:fs/promises'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'

// 事件循环延迟监控：每秒检查一次 p99
const h = monitorEventLoopDelay({ resolution: 20 })
h.enable()
setInterval(() => {
  const p99 = h.percentile(99) / 1e6 // 结果单位是纳秒，转成毫秒
  if (p99 > 100) console.warn(`事件循环延迟 p99=${p99.toFixed(0)}ms`)
  h.reset()
}, 1000).unref()

// 按需采样：只采一小段时间，写成 .cpuprofile 拿到本地分析
export async function captureCpuProfile(ms) {
  const session = new Session()
  session.connect()
  try {
    await session.post('Profiler.enable')
    await session.post('Profiler.start')
    await sleep(ms)
    const { profile } = await session.post('Profiler.stop')
    const file = `cpu-${Date.now()}.cpuprofile`
    await writeFile(file, JSON.stringify(profile))
    return file
  } finally {
    session.disconnect()
  }
}
```

## 面试官可能追问

::: details CPU 很高，但 profile 里看不到明显的业务热点，可能是什么？
看看采样里 GC 的占比和 `--trace-gc` 的输出：内存接近 `--max-old-space-size` 上限时，V8 会频繁做完整的垃圾回收，CPU 被 GC 吃掉，这时根因是内存问题。另一种可能是热点在原生代码里（如压缩、加解密），JS 层的 profile 只能看到一个调用入口，要用 `perf` 这类系统级工具才能看清。
:::

::: details 进程已经卡死（死循环），还能采样吗？
主线程被死循环占住时，代码里的采样入口和定时器都不会执行。在 Linux、macOS 上可以向进程发送 `SIGUSR1` 让它开启调试器（默认监听 `127.0.0.1:9229`）：信号和调试协议都由单独的线程处理，暂停请求通过 V8 的中断机制送到主线程，循环体执行时会检查中断，所以 DevTools 连上后点暂停，能直接看到卡在哪个函数、哪一行，也可以录一小段 CPU profile。也可以用 `perf` 从外部采样。排查完要重启进程，并关闭调试端口。
:::

::: details 怎么避免 CPU 问题再次发生？
监控事件循环延迟和 CPU 使用率并设置告警；对外部输入限制长度和大小（请求体、正则输入、批量查询条数）；把重计算放到 worker_threads 或单独的服务；在 CI 中对关键接口做基准测试，发现性能退化；用 lint 规则禁止在请求路径里使用同步 API。
:::

## 易错点

- 分不清两种图：经典火焰图的横轴是采样占比，左右顺序没有意义；DevTools 的火焰图表横轴才是时间线
- 在线上直接把 `--inspect` 绑定到 `0.0.0.0`，等于开放了远程执行代码的入口
- 只看平均 CPU：一个请求卡住 2 秒，平均值可能并不高，事件循环延迟的 p99 更能反映问题
- 把 CPU 问题都归结为"Node 不适合计算"：先采样定位，很多时候只是一个正则或一次大 JSON 序列化
