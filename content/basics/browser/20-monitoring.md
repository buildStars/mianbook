---
difficulty: 2
tags: [实践, 综合]
---

# 前端监控怎么采集性能和错误数据？

::: tip 一句话回答
前端监控主要采集三类数据：**性能**、**错误**和**用户行为**。性能用 Performance API：Navigation Timing 算页面加载各阶段的耗时，Resource Timing 看资源和接口，`PerformanceObserver` 监听 LCP、CLS、长任务等，实践中直接用 web-vitals 库。错误靠 `error` 事件（在捕获阶段还能抓到资源加载失败）、`unhandledrejection` 和框架的错误钩子。数据用 `navigator.sendBeacon` 合并上报，线上报错借助 SourceMap 还原到源码位置。
:::

## 详细解析

### 性能数据

**Navigation Timing**：`performance.getEntriesByType('navigation')[0]` 拿到页面导航的各个时间点，相减得到各阶段耗时：

| 阶段 | 计算方式 |
| --- | --- |
| DNS 解析 | `domainLookupEnd - domainLookupStart` |
| TCP 连接（含 TLS） | `connectEnd - connectStart` |
| TTFB（首字节时间） | `responseStart - startTime` |
| DOM 解析（常见算法） | `domInteractive - responseEnd` |
| DOMContentLoaded | `domContentLoadedEventEnd - startTime` |
| load | `loadEventEnd - startTime` |

> "DOM 解析"这一项没有标准定义，`domInteractive - responseEnd` 是监控 SDK 的常见算法。HTML 是边下载边解析的，这样算只包含响应接收完之后的那部分解析时间。

- **Resource Timing**：`performance.getEntriesByType('resource')` 列出每个静态资源和接口请求的耗时。跨域资源要服务端返回 `Timing-Allow-Origin` 响应头，否则拿不到各阶段的详细耗时
- **PerformanceObserver**：监听 `largest-contentful-paint`、`layout-shift`、`longtask`（超过 50ms 的长任务）、`event`（交互延迟，用于计算 INP）等类型的条目，加上 `buffered: true` 还能拿到创建观察者之前产生的条目。不同浏览器支持的类型不同，可以先检查 `PerformanceObserver.supportedEntryTypes`
- **web-vitals 库**：`onLCP`、`onINP`、`onCLS` 直接给出 Core Web Vitals（见 [Core Web Vitals](/basics/browser/09-web-vitals)），还处理了后台标签页、何时上报最终值等细节，比自己用 `PerformanceObserver` 计算更可靠

### 错误数据

| 类型 | 采集方式 |
| --- | --- |
| JS 运行时错误 | `window.onerror` 或监听 `window` 的 `error` 事件，能拿到错误信息、文件、行列号和堆栈 |
| 资源加载失败 | 图片、脚本、样式加载失败的 `error` 事件不冒泡，要在**捕获阶段**监听，用 `event.target` 判断是哪个元素 |
| 未处理的 Promise 拒绝 | `unhandledrejection` 事件，`event.reason` 是拒绝的原因 |
| 框架内的错误 | Vue 用 `app.config.errorHandler`，React 用错误边界；框架会自己捕获组件里的错误，不一定会抛到 `window` 上 |
| 接口错误 | 封装请求库，或拦截 `fetch` / XHR，记录 URL、状态码和耗时 |

**跨域脚本只报 "Script error."**：页面引用了其他域名（如 CDN）的脚本，它出错时浏览器只给出 "Script error."，没有文件、行号和堆栈。解决办法是给脚本加上 `crossorigin` 属性，如 `<script src="https://cdn.example.com/app.js" crossorigin="anonymous">`，同时让 CDN 返回 `Access-Control-Allow-Origin` 响应头。两者缺一不可：只加属性、服务器不返回 CORS 头，脚本会直接加载失败。

**白屏检测**：页面加载一段时间后，检查根节点（如 `#app`）是否渲染出了内容；或者在页面上取若干个采样点，用 `document.elementsFromPoint()` 看每个点最上层的元素，如果都是 `html`、`body`、`#app` 这类空白容器，就判定为白屏，可以隔一会儿再检查一次，避免误报。

**SourceMap**：线上代码经过压缩，报错位置只是 `app.3f9a1c.js:1:23456`，看不出对应哪段源码。构建时生成 SourceMap 并上传到监控平台，由平台把堆栈还原到源码位置。SourceMap 不要部署到公网，否则别人也能还原出源码；Vite 的 `build.sourcemap: 'hidden'` 会生成 SourceMap，但不在产物里写引用注释。

### 数据上报

- `navigator.sendBeacon(url, data)`：异步发送，不阻塞页面，页面卸载时也能可靠地发出；拿不到响应，单次数据量也有限制
- 图片打点：`new Image().src = url + '?' + 参数`，天然跨域、兼容性好，但只能 GET，数据量受 URL 长度限制
- 合并和采样：先放进队列，攒够一批或定时发送；性能数据量大，可以按比例采样
- 上报时机：在 `visibilitychange` 变为 `hidden` 时把剩余数据发出去，用户切换标签页、关闭页面都会经过这个状态，比 `unload` 可靠（见 [DOMContentLoaded 和 load](/basics/browser/08-domcontentloaded-load)）

可以直接用 Sentry 这类现成方案（也能私有部署），也可以自建：SDK 采集，上报服务接收，存储后做聚合分析和告警。

## 代码示例

```js
const REPORT_URL = '/api/monitor'
const queue = []

function report(data) {
  queue.push({ ...data, page: location.href, time: Date.now() })
  if (queue.length >= 10) flush() // 攒够 10 条发一次
}

function flush() {
  if (queue.length === 0) return
  // 字符串会以 text/plain 发送，跨域上报也不会触发预检请求
  navigator.sendBeacon(REPORT_URL, JSON.stringify(queue.splice(0)))
}

// 第三个参数 true：在捕获阶段监听，才能拿到不冒泡的资源加载错误
window.addEventListener('error', (e) => {
  if (e.target !== window) {
    // 资源加载失败：e.target 是出错的元素
    report({ type: 'resource', tag: e.target.tagName, url: e.target.src || e.target.href })
  } else {
    const { message, filename, lineno, colno, error } = e
    report({ type: 'js', message, filename, lineno, colno, stack: error?.stack })
  }
}, true)

// 未处理的 Promise 拒绝
window.addEventListener('unhandledrejection', (e) => {
  report({ type: 'promise', reason: String(e.reason?.stack || e.reason) })
})

// 页面切到后台或关闭前，把剩下的数据发出去
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush()
})
```

## 面试官可能追问

::: details 为什么跨域脚本的错误拿不到详细信息？
出于安全考虑。错误信息里可能带有脚本内容和用户数据，如果把其他源脚本的错误详情暴露给页面，恶意网站就能把别的网站的资源当脚本加载，从报错信息里探测用户在那个网站上的数据或登录状态。所以对没有通过 CORS 检查的跨域脚本，浏览器只报 "Script error."。加上 `crossorigin` 并返回 CORS 头，相当于脚本所在的服务器明确允许当前页面读取这些信息。
:::

::: details 如何统计接口耗时的 P95？
P95 指 95% 的请求耗时都不超过这个值，比平均值更能反映慢请求的情况，平均值容易被大量的快请求拉低。前端在请求封装里或从 Resource Timing 中记录每次请求的耗时并上报；服务端按接口和时间段聚合，排序后取第 95% 位置的值，数据量大时用数据库的分位数函数或近似算法。注意分位数不能简单地相加或取平均，每分钟 P95 的平均值不等于整体的 P95。
:::

::: details 上报太频繁会影响性能吗？怎么控制？
会。每次上报都是一次网络请求，收集和序列化数据也占用主线程。控制方法：
- 采样：性能数据按比例采样；错误可以全量上报，但同一个错误短时间内只报一次
- 合并：攒够一批或定时发送，不要来一条发一条
- 空闲时处理：数据的整理和序列化放进 `requestIdleCallback`（见 [rAF 和 rIC](/basics/browser/14-raf-ric)）
- 防止死循环：上报本身失败时，不要再触发上报
:::

## 易错点

- 资源加载错误不冒泡，必须在捕获阶段监听，`window.onerror` 捕获不到
- `loadEventEnd` 要在 load 事件结束后才有值，在 `load` 回调里直接读到的是 0
- SourceMap 只上传给监控平台，不要部署到公网
