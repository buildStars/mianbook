---
difficulty: 2
tags: [原理, 实践]
---

# Service Worker 是什么？怎么实现离线缓存？

::: tip 一句话回答
Service Worker 是在浏览器后台运行、独立于页面的 Worker，能**拦截和处理页面发出的网络请求**，相当于页面和网络之间一个可编程的代理。离线缓存的做法是：`install` 阶段把静态资源预缓存到 Cache Storage，`activate` 阶段清理旧版本的缓存，`fetch` 事件里按缓存策略返回缓存或请求网络。它必须在 HTTPS 下使用（localhost 除外），也是 PWA 离线能力的基础。
:::

## 详细解析

### 基本特点

- 运行在独立的线程，不能访问 DOM，通过 `postMessage` 和页面通信
- 必须在 HTTPS 下使用，`localhost` 除外，方便本地开发
- 作用域（scope）默认是脚本所在的目录：`/sw.js` 能控制整个站点，`/static/sw.js` 默认只能控制 `/static/` 下的页面
- 由事件驱动：空闲时浏览器可能把它终止，有事件时再启动，所以不能把状态存在全局变量里，要存到 IndexedDB 或 Cache Storage

### 生命周期

```text
register → install（预缓存）→ waiting（有旧版本在控制页面时）→ activate（清理旧缓存）→ 拦截 fetch 等事件
```

- 在 `install`、`activate` 中用 `event.waitUntil(promise)` 让浏览器等待异步操作完成；`install` 里的 Promise 失败，这次安装就失败
- 第一次注册时，当前页面在 Service Worker 生效之前就已经加载了，不受它控制，刷新后才会经过它；在 `activate` 里调用 `self.clients.claim()` 可以立即接管

### 更新机制

- 用户访问作用域内的页面时，浏览器会检查 Service Worker 脚本，内容有变化就安装新版本
- 新版本装好后进入 waiting，默认要等**所有**被旧版本控制的页面都关闭后才激活。只刷新一次通常不够，因为刷新时新旧页面会短暂重叠，旧版本控制的页面始终没有全部关闭
- 在 `install` 里调用 `self.skipWaiting()` 可以跳过等待，配合 `clients.claim()` 让新版本立即接管。代价是页面由旧版本加载，后续请求却由新版本处理，可能出现新旧资源不一致，比如旧页面按需加载的 chunk 在新缓存里已经没有了

### 缓存策略

| 策略 | 做法 | 适合 |
| --- | --- | --- |
| Cache First | 先查缓存，没有再请求网络 | 带 hash 的 JS、CSS，字体、图片等不会变的资源 |
| Network First | 先请求网络，失败（如离线）再用缓存 | HTML、需要较新数据的接口 |
| Stale-While-Revalidate | 先返回缓存，同时请求网络更新缓存，下次用上新内容 | 头像、非关键接口等允许短暂旧数据的资源 |
| Network Only | 只走网络 | 实时数据、支付，以及 POST 等非 GET 请求 |
| Cache Only | 只读缓存 | 预缓存的离线页面等 |

缓存存放在 **Cache Storage** 中：`caches.open(name)` 打开一个缓存，`cache.addAll(urls)` 请求并存入，`cache.put(request, response)` 写入，`caches.match(request)` 查找，`caches.delete(name)` 删除。它只能存 GET 请求，也不会自动过期，什么时候更新、删除完全由代码决定。

### PWA 与工具

PWA = Web App Manifest（名称、图标、启动方式等）+ Service Worker（离线能力），可以安装到桌面或手机主屏幕。Service Worker 还能用于推送通知、后台同步。实际项目一般用 Workbox 封装缓存策略，Vite 项目可以用基于 Workbox 的 vite-plugin-pwa。调试在 DevTools 的 Application 面板：查看状态、手动更新或注销、勾选 Update on reload，在 Cache Storage 里查看缓存内容。

## 代码示例

```js
// 页面中注册：等页面加载完再注册，避免和首屏资源抢带宽
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
  })
}
```

```js
// sw.js
const CACHE_NAME = 'static-v2' // 资源有变化就改版本号
const PRECACHE_URLS = ['/', '/assets/app.js', '/assets/app.css', '/assets/logo.png']

self.addEventListener('install', (event) => {
  // 预缓存静态资源；任何一个请求失败，这次安装就失败
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)))
})

self.addEventListener('activate', (event) => {
  // 删除旧版本的缓存
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith('static-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  const isApi = url.pathname.startsWith('/api/')
  // 只处理同源的 GET 静态资源；不调用 respondWith 的请求照常走网络
  if (request.method !== 'GET' || url.origin !== self.location.origin || isApi) return
  event.respondWith(cacheFirst(request))
})

// Cache First：先查缓存，没有再请求网络，并把结果存起来
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok) {
    cache.put(request, response.clone()) // 响应体只能读一次，缓存的是副本
  }
  return response
}
```

示例里 HTML（`/`）也是缓存优先，发布新版本时必须修改 `CACHE_NAME`：sw.js 内容变了才会触发更新、重新预缓存。对 HTML 更稳妥的做法是 Network First。

## 面试官可能追问

::: details Service Worker 和 Web Worker 有什么区别？
- 用途：[Web Worker](/basics/browser/15-web-worker) 用来分担页面的计算任务；Service Worker 用来拦截请求、离线缓存、推送
- 生命周期：Web Worker 跟随创建它的页面，页面关闭就结束；Service Worker 独立于页面，一个可以控制作用域内的多个页面，页面关闭后还能被推送等事件唤醒
- 限制：Service Worker 必须在 HTTPS 下使用，只能用 `fetch` 发请求，不能用 `XMLHttpRequest`
:::

::: details 怎么让用户及时用上新版本？
页面监听 `registration` 的 `updatefound` 事件，发现新的 Service Worker 安装完成、进入 waiting 状态后，提示用户"有新版本，点击刷新"。用户确认后，页面给等待中的 Service Worker 发消息，让它调用 `skipWaiting()`；页面再监听 `navigator.serviceWorker` 的 `controllerchange` 事件，新版本接管后执行 `location.reload()`。vite-plugin-pwa 提供了现成的"提示更新"模式。
:::

::: details 为什么要求 HTTPS？
Service Worker 能拦截作用域内页面的所有请求，还能返回任意伪造的响应，而且注册后会长期存在。如果允许在 HTTP 下注册，中间人就能注入恶意的 Service Worker，用户离开那个网络之后它仍然生效。
:::

## 易错点

- 新版本默认不会立即生效，要等旧版本控制的所有页面都关闭；只刷新一次页面通常不够
- 缓存名不带版本号、`activate` 时不清理旧缓存，用户会一直用旧资源，缓存也越积越多
- 有问题的 Service Worker 很难清除：删掉服务器上的 sw.js 不会让它失效，要在原路径部署一个新版本，激活后注销自己（`self.registration.unregister()`）并清空缓存
