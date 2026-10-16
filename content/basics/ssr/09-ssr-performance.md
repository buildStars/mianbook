---
difficulty: 3
tags: [性能优化, 场景题]
---

# SSR 应用的性能和稳定性怎么保障？

::: tip 一句话回答
SSR 把渲染从浏览器搬到了服务器，**渲染是 CPU 密集的同步计算**，Node 进程只有一个线程执行 JS，并发一高就会被打满，所有请求一起变慢。保障手段分几层：**缓存**，能整页缓存的放 CDN，再加组件级和数据级缓存，但个性化内容绝不能缓存给别人；**超时和降级**，渲染或接口太慢就返回客户端渲染的空壳；**避免跨请求共享可变状态**，否则会内存泄漏，甚至把一个用户的数据渲染给另一个用户；**压测和监控**首字节时间、渲染耗时、事件循环延迟和内存；最后用**多进程和容器扩容**提高吞吐。
:::

## 详细解析

### 为什么 SSR 服务容易被打满

渲染一个页面要执行整棵组件树、拼出 HTML 字符串，这段时间事件循环被占住，其他请求只能排队。假设一个页面渲染要 50ms，单个进程每秒最多渲染约 20 个页面，再多请求就开始排队，响应时间迅速上升，连健康检查都可能超时，导致实例被判定为故障。所以 SSR 优化的优先级是：先想办法**少渲染**（缓存），再让**渲染得快**，最后才是**加机器**。

让单次渲染更快：服务端只渲染首屏需要的部分，首屏以下、不影响 SEO 的组件放到客户端渲染；渲染函数里不做重计算；多个接口并行请求；用 `pick` 之类的手段减小序列化到 HTML 里的数据；能流式输出的页面用[流式 SSR](/basics/ssr/03-streaming-ssr)。

### 缓存：分三层

- **整页缓存**：所有人看到的内容相同的页面（首页、文章页、商品详情的公共部分），设置 `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` 之类的头，让 CDN 或反向代理缓存，过期后先返回旧页面、后台更新。命中缓存的请求根本不到 Node
- **组件级缓存**：和用户无关、渲染开销大的片段（导航菜单、页脚、推荐楼层），按 key 缓存渲染结果。框架支持时直接用，例如 Next.js 的 `'use cache'` 可以加在组件上
- **数据缓存**：接口数据在服务端用 LRU 内存缓存或 Redis 缓存，设置条目上限和过期时间。没有上限的缓存就是内存泄漏，见 [Node.js 内存泄漏排查](/basics/node/08-memory-leak)

个性化内容的底线：带登录态、按用户区分的页面设置 `Cache-Control: private, no-store`；CDN 的缓存键默认不包含 Cookie，同一个 URL 被缓存后会原样返回给所有人。常见做法是匿名访问走缓存、带登录 Cookie 的请求绕过缓存，或者页面主体缓存、个性化部分在客户端请求。

### 超时控制和降级

```js
const MAX_INFLIGHT = 50 // 假设值，按压测得出的单进程容量设置
let inflight = 0

app.use(async (req, res) => {
  // 正在渲染的请求太多，直接降级，避免把进程拖垮
  if (inflight >= MAX_INFLIGHT) return sendCsrShell(res)
  inflight++
  try {
    const html = await withTimeout(render(req.url), 3000)
    res.send(html)
  } catch (err) {
    console.warn('SSR 降级为客户端渲染', req.url, err.message)
    sendCsrShell(res)
  } finally {
    inflight--
  }
})

function sendCsrShell(res) {
  // 只有挂载点和脚本，由浏览器自己渲染；降级的页面不能被缓存
  res.set('Cache-Control', 'no-store')
  res.send('<!doctype html><div id="app"></div><script type="module" src="/client.js"></script>')
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`超过 ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
```

- 超时只是让响应先返回，已经开始的渲染还在占用 CPU；下游接口要各自设置超时，并用 `AbortSignal` 取消请求。React 的流式渲染可以调用 `abort()` 停止渲染，剩下的交给客户端
- 客户端入口要能区分两种情况：有服务端 HTML 时水合，降级的空壳则直接挂载
- 非核心数据（推荐、评论）失败时用默认值，不要让整页渲染失败，写法见 [BFF](/basics/node/17-bff)

### 请求之间不能共享可变状态

Node 服务是长期运行的进程，模块顶层的变量被所有请求共享。在里面存"当前请求"的数据，并发时就会串号：

```js
// ❌ 模块顶层的对象被所有请求共享
const store = { user: null }

async function renderPage(req) {
  store.user = await getUser(req) // 请求 A 写入
  await getRecommendations() // 等待期间，请求 B 也写入了 store.user
  return `<p>你好，${store.user.name}</p>` // A 可能渲染出 B 的名字
}

// ✅ 每个请求创建自己的状态
async function renderPageSafe(req) {
  const store = { user: await getUser(req) }
  await getRecommendations()
  return `<p>你好，${store.user.name}</p>`
}
```

所以每个请求都要新建应用实例、router、store；只读的配置可以共享。在模块顶层的数组、Map 里不断追加数据，就是内存泄漏。需要在调用链深处拿到当前请求的信息时，用 [AsyncLocalStorage](/basics/node/12-async-local-storage)，不要用全局变量。

### 压测和监控

- **压测**：用 autocannon、k6 等工具逐步加压，找出单进程能承受的并发和吞吐，作为扩容和降级阈值的依据；分别测缓存命中和不命中的情况；长时间压测观察内存是否持续上涨
- **监控**：首字节时间（看 P95、P99，不只看平均值）、SSR 渲染耗时、下游接口耗时、事件循环延迟（`perf_hooks.monitorEventLoopDelay`）、堆内存和 GC、错误率、**降级比例**
- **告警**：降级比例升高、事件循环延迟升高往往比错误率更早暴露问题

### 多进程和扩容

一个进程只用一个 CPU 核，按核数启动多个进程（cluster、PM2，或者每个容器一个进程、部署多个副本），见 [Node.js 利用多核](/basics/node/06-multi-core)。按 CPU 使用率自动扩容；SSR 服务和 API 服务分开部署，互不拖累；静态资源全部交给 CDN。

## 面试官可能追问

::: details SSR 服务 CPU 突然飙升、响应变慢，怎么排查？
先看是不是流量问题：请求量是否上涨、CDN 缓存命中率是否下降（缓存规则被改、缓存被清空都会让请求全部打到源站）。流量正常就是单次渲染变慢了：抓 CPU Profile 看火焰图（方法见 [CPU 飙高排查](/basics/node/13-cpu-profiling)），找出是哪个组件或函数耗时，常见原因有渲染了过长的列表、在渲染中做了大量计算、某次发布引入了很重的依赖。同时看内存，GC 频繁也会推高 CPU。
:::

::: details 首字节时间很长，怎么定位是哪一段慢？
把一次请求拆成几段分别打点：排队等待、下游接口、渲染、序列化和发送。接口慢就并行请求、加缓存、给非核心接口设置更短的超时；渲染慢就减少服务端渲染的范围；排队久说明并发超过了处理能力，需要扩容或降级。可以通过 `Server-Timing` 响应头把各段耗时带到浏览器的 Network 面板里。
:::

::: details 怎么发现跨请求的状态污染？
它在本地单人测试时几乎不出现，要靠代码规范和并发测试发现：禁止在模块顶层保存请求相关的数据；store、router 必须由工厂函数按请求创建；压测时用不同的用户并发请求，校验返回页面里的用户信息是否和请求一致。线上出现"看到别人的数据"一定要当成安全事故处理。
:::

## 易错点

- 只做了超时却没取消下游请求和渲染，超时的请求仍在消耗资源
- 把带登录态的页面也放进 CDN 缓存，或者降级的空壳页面被缓存
- 在模块顶层创建 store 单例，或者用全局变量保存当前用户
- 只看平均响应时间，P99 和事件循环延迟更能反映 SSR 服务的真实状况
