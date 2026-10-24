---
difficulty: 3
tags: [系统设计, 场景题]
---

# 设计一个前端监控平台：错误、性能和行为数据怎么采集、上报和分析？

::: tip 一句话回答
整条链路是 **SDK 采集 → 批量上报 → 接收层 → 消息队列 → 清洗和 source map 还原 → 存储 → 看板和告警**。SDK 采三类数据：**错误**（全局 error、unhandledrejection、框架错误钩子）、**性能**（Core Web Vitals 用 web-vitals 库）、**行为**（PV、点击、路由变化），并带上会话 ID 和**面包屑**。上报要**批量合并**，页面变为 hidden 时用 **sendBeacon** 或 **fetch keepalive** 补发，配合采样和限流，SDK 本身不能拖慢页面。服务端按**错误指纹**聚合去重，明细存 **ClickHouse** 这类列式库，告警用阈值加环比降噪。
:::

## 详细解析

### 第一步：需求和规模

- **要回答的问题**：线上报了什么错、影响多少用户、哪个版本引入的；页面加载和交互快不快；用户在出错前做了什么
- **使用者**：前端开发（排查错误）、团队负责人（看趋势和告警）
- **规模（假设值）**：日活 100 万，每人每天产生约 200 条事件（PV、点击、性能、错误），每天约 2 亿条。行为和性能数据按 10% 采样，入库约 2000 万条/天，平均约 230 条/秒，峰值按 5 倍算约 1200 条/秒。每条约 1 KB，每天约 20 GB 明细。错误数据量小得多，全量保留

这和 [前端监控怎么采集性能和错误数据](/basics/browser/20-monitoring) 的区别：那题讲浏览器里的采集 API，这题讲从 SDK 到告警的整套系统。

### 第二步：整体架构

```text
浏览器 SDK（错误 / 性能 / 行为 / 面包屑）
   │ 内存队列 → 批量 → sendBeacon / fetch keepalive
   ▼
接收层（无状态，校验、限流、补 IP 和 UA 信息）
   │
消息队列（削峰、多个下游各自消费）
   │
处理层（清洗、脱敏、source map 还原、计算错误指纹）
   ├──► ClickHouse：事件明细，按天分区
   ├──► 错误聚合表：指纹 → 次数、影响用户数、首次和最近出现时间
   └──► 实时告警（按窗口统计错误率、指标劣化）
             │
        看板 / 告警通知 / 错误详情页
```

### 第三步：关键模块

**SDK：采集**

- 错误：`window.addEventListener('error', fn, true)` 在**捕获阶段**才能拿到图片、脚本这类资源加载失败（它们不冒泡）；`unhandledrejection` 拿未处理的 Promise 错误；Vue 用 `app.config.errorHandler`，React 用错误边界，框架内部捕获的错误不会到全局
- 性能：LCP、INP、CLS 用 web-vitals 库的 `onLCP`、`onINP`、`onCLS`，回调里的 `metric` 带 `name`、`value`、`rating`、`id`，需要定位原因时从 `web-vitals/attribution` 导入；长任务用 `PerformanceObserver` 观察 `longtask`。原理见 [Web Vitals](/basics/browser/09-web-vitals)
- 行为：PV、路由变化（监听 `popstate` 或路由钩子）、点击（事件委托，记录元素的选择器或埋点 ID）
- 会话和用户：首次访问生成匿名设备 ID 存在本地，会话 ID 在长时间无操作后重新生成；登录后关联用户 ID
- **面包屑**：最近 N 条操作（点击、路由、接口请求、console 报错）放在环形缓冲里，出错时随错误一起上报

Core Web Vitals 按第 75 百分位评估，三项都"良好"才算通过：

| 指标 | 良好 | 需改进 | 差 |
| --- | --- | --- | --- |
| LCP | ≤ 2.5 s | 2.5～4.0 s | > 4.0 s |
| INP | ≤ 200 ms | 200～500 ms | > 500 ms |
| CLS | ≤ 0.1 | 0.1～0.25 | > 0.25 |

**SDK：上报**

```js
const queue = []
function track(event) {
  queue.push(event)
  if (queue.length >= 20) flush()
}
function flush() {
  if (!queue.length) return
  const body = JSON.stringify(queue.splice(0))
  // sendBeacon 返回 false 说明没能进入发送队列，改用 keepalive 的 fetch
  if (!navigator.sendBeacon('/collect', body)) {
    fetch('/collect', { method: 'POST', body, keepalive: true }).catch(() => saveToLocal(body))
  }
}
setInterval(flush, 5000)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush()
})
```

- 页面变为 hidden 是最后一个能可靠观察到的时机，比 `unload`、`beforeunload` 可靠；不支持 `visibilitychange` 的环境再用 `pagehide` 兜底
- 大小限制：sendBeacon 排队数据总共 64 KiB；fetch 的 keepalive 也是 64 KiB，而且是同一页面里**所有未完成的 keepalive 请求共享**这个额度，不是每个请求各 64 KiB。所以每批要控制大小
- 失败的批次存进 localStorage 或 IndexedDB，下次启动时重发，设上限避免无限堆积
- SDK 自己不能拖慢页面：异步加载、空闲时处理（`requestIdleCallback`）、所有采集代码包在 try/catch 里；同一个错误短时间内重复出现只报一次

### 第四步：难点和取舍

**source map 还原**：线上代码是压缩过的，堆栈只有 `app.3f2a.js:1:28733`。构建时把 source map 上传到监控平台，**不部署到公开的静态目录**；处理层按版本号找到对应的 map 还原出源码文件和行号（见 [Source Map](/basics/build/08-source-map)）。所以每次上报都要带版本号。

**错误聚合**：同一个 bug 每天可能报几万次。按"错误类型 + 消息（去掉其中的数字、ID）+ 还原后堆栈的前几帧"算出**指纹**，同一指纹归为一个问题，展示次数、影响用户数、首次出现的版本。指纹太粗会把不同的 bug 合并，太细会让一个 bug 拆成很多条。

**采样和限流**：错误全量，性能和行为按比例采样，采样率由服务端下发，可以随时调整。接收层按应用限流，某个页面陷入死循环狂报时，只记录丢弃的数量，不拖垮整个平台。

**存储**：明细是"只追加、按时间和维度做聚合"的数据，适合 ClickHouse 这类列式库，按天分区，过期整块删除；看板上常用的统计提前做成物化视图。思路和 [日志系统](/basics/backend-design/14-log-system) 类似。

**告警降噪**：只用固定阈值，流量低时误报、流量高时漏报。更稳的做法是错误率阈值加环比（和上周同时段比），并要求持续几个窗口才触发；同一问题在恢复前只通知一次，按负责人路由。

**隐私**：不采集输入框的值，URL 里的 token、手机号在 SDK 侧就脱敏；用户 ID 按需哈希；按法规提供关闭采集的开关。

### 第五步：扩展

- **和后端打通**：请求头带上 Trace ID，前端错误能跳到对应的后端链路
- **发布关联**：错误按版本统计，新版本错误率升高时提示回滚
- **会话回放**：录制 DOM 变化重现用户操作，数据量大，只对出错的会话按采样开启

## 面试官可能追问

::: details 为什么不在 unload 或 beforeunload 里上报？
移动端切到后台或直接杀进程时，这两个事件经常不触发；`unload` 还会让页面无法进入 bfcache。`visibilitychange` 变为 hidden 时，页面很可能就此结束，这是最后一个可靠的时机。
:::

::: details 跨域脚本的错误只有 "Script error." 怎么办？
浏览器出于安全考虑隐藏了跨域脚本的错误细节。给 `<script>` 加 `crossorigin="anonymous"`，同时 CDN 返回 `Access-Control-Allow-Origin` 头，就能拿到完整的消息和堆栈。
:::

::: details 怎么判断一个错误该不该告警？
看影响面：影响用户数、错误率，而不是绝对次数。新出现的指纹、刚发布版本里激增的指纹优先告警；第三方脚本、浏览器插件引起的错误按来源过滤掉，否则告警会被噪音淹没。
:::

::: details 采样会不会让数据不准？
PV、性能分位数这类统计量，样本足够大时按采样率放大就够用。错误不采样，因为一个低频错误可能正是关键问题。采样要按会话或用户决定，同一个会话要么全采、要么全不采，不然面包屑和行为链路会断。
:::

## 易错点

- 只用冒泡阶段监听 error，资源加载失败一个都收不到
- 以为 fetch keepalive 每个请求各有 64 KiB，页面关闭时同时发多个大批次，后面的直接失败
- 把 source map 和产物一起部署到公开目录，等于把源码公开
- 错误按消息文本直接聚合，消息里带了 ID 或时间，一个 bug 被拆成成千上万条
