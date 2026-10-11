---
difficulty: 2
tags: [场景题]
---

# 浏览器多个标签页之间怎么通信？

::: tip 一句话回答
**同源**页面首选 `BroadcastChannel`，同名频道里的页面可以互相广播消息；也可以用 `localStorage` 加 `storage` 事件，或者让 `SharedWorker`、Service Worker 做中转。**非同源**页面要通过 `window.open` 返回的窗口引用或 iframe 的 `contentWindow` 调用 `postMessage`，发送方指定目标 origin，接收方校验 `event.origin`。典型场景有登录状态同步、购物车同步，以及多个标签页只保留一个 WebSocket 连接。
:::

## 详细解析

### 方案对比

| 方案 | 要求同源 | 复杂度 | 适用场景 |
| --- | --- | --- | --- |
| BroadcastChannel | 是 | 低 | 同源页面之间广播消息，首选 |
| localStorage + storage 事件 | 是 | 低 | 简单的状态同步 |
| SharedWorker | 是 | 中 | 需要一个中心统一维护状态或连接 |
| Service Worker | 是 | 中 | 项目里已经用了 Service Worker |
| IndexedDB + 轮询 | 是 | 中 | 不推荐，有延迟又浪费资源 |
| window.postMessage | 否 | 中 | 跨域页面，前提是持有对方的窗口引用 |

### 同源页面

- **BroadcastChannel**：`new BroadcastChannel('频道名')`，同名频道里的同源页面、iframe、Worker 都能收到消息，发送者自己收不到。数据经过结构化克隆，可以直接传对象
- **localStorage + storage 事件**：一个页面修改 localStorage 后，同源的**其他**页面会收到 `storage` 事件，事件对象里有 `key`、`oldValue`、`newValue`；修改它的当前页面不会收到。只能存字符串，写入相同的值也不会触发
- **SharedWorker**：多个页面连接同一个 [SharedWorker](/basics/browser/15-web-worker) 实例，它在 `connect` 事件里保存每个页面的 `port`，收到消息后转发给其他页面
- **Service Worker**：页面把消息发给 Service Worker，它用 `self.clients.matchAll()` 拿到所有受控页面，再逐个 `postMessage`
- **IndexedDB + 轮询**：写入 IndexedDB，其他页面定时读取比对，不推荐

### 非同源页面：window.postMessage

需要拿到对方窗口的引用：`window.open` 的返回值，或者 iframe 的 `contentWindow`；被打开的页面可以用 `window.opener` 反过来通信。拿不到引用的两个页面，一般只能借助服务端中转，比如都连上同一个 WebSocket 服务。对方加载完成前发出的消息会丢失，所以通常让对方先发一条"已就绪"：

```js
// A 页面（https://a.com）：打开 B 页面，等它就绪后再发消息
const child = window.open('https://b.com/page')
window.addEventListener('message', (e) => {
  if (e.origin !== 'https://b.com') return // 只处理来自 b.com 的消息
  if (e.data.type === 'ready') {
    child.postMessage({ type: 'init', theme: 'dark' }, 'https://b.com') // 指定接收方的 origin
  }
})

// B 页面（https://b.com/page）
window.addEventListener('message', (e) => {
  if (e.origin !== 'https://a.com') return
  console.log('收到：', e.data)
})
window.opener?.postMessage({ type: 'ready' }, 'https://a.com') // 告诉打开者自己已就绪
```

### 典型场景

- **登录状态同步**：一个标签页登录或退出后广播消息，其他标签页刷新或跳转到登录页
- **购物车数量同步**：加购后广播最新数量，其他标签页更新角标
- **只让一个标签页维持 WebSocket 连接**：可以用 Web Locks API 选出一个"主标签页"，由它建立连接，再用 BroadcastChannel 把消息转发给其他标签页；也可以用 SharedWorker 统一维护连接

```js
const channel = new BroadcastChannel('ws')

// 所有标签页都去抢同一把锁，同一时间只有一个能拿到
navigator.locks.request('ws-leader', async () => {
  const ws = new WebSocket('wss://example.com/ws')
  ws.addEventListener('message', (e) => {
    handleMessage(e.data) // 自己处理
    channel.postMessage(e.data) // 再转发给其他标签页
  })
  await new Promise(() => {}) // 永不 resolve：一直持有锁，标签页关闭后锁自动释放，由下一个标签页接替
})

// 其他标签页从频道接收
channel.addEventListener('message', (e) => handleMessage(e.data))
```

## 代码示例

```js
// BroadcastChannel：所有同源页面都执行这段代码
const channel = new BroadcastChannel('auth')

// 当前标签页退出登录后，通知其他标签页
function notifyLogout() {
  channel.postMessage({ type: 'logout' })
}

// 发送者自己收不到，这里收到的都来自其他页面
channel.addEventListener('message', (e) => {
  if (e.data.type === 'logout') location.reload()
})
```

```js
// localStorage + storage 事件
// 发送：带上时间戳，保证每次写入的值都不同，否则不会触发事件
function broadcast(type, payload) {
  localStorage.setItem('tab-message', JSON.stringify({ type, payload, time: Date.now() }))
}

// 接收：只有同源的其他标签页会收到，写入的页面自己收不到
window.addEventListener('storage', (e) => {
  if (e.key !== 'tab-message' || !e.newValue) return
  const { type, payload } = JSON.parse(e.newValue)
  if (type === 'cart') updateCartBadge(payload.count)
})

broadcast('cart', { count: 3 })
```

## 面试官可能追问

::: details 为什么 storage 事件在当前页面不触发？
规范就是这样设计的：`storage` 事件用来通知**其他**共享同一存储的页面"数据被别人改了"。当前页面是修改者，本来就知道数据变了，直接调用自己的更新逻辑就行。想统一处理，可以封装一个写入函数，写完后在本页手动执行一次同样的更新。
:::

::: details postMessage 有哪些安全注意事项？
- 发送时第二个参数写明确的目标 origin，不要用 `'*'`：对方窗口可能已经被导航到别的网站，数据会发给错误的接收方
- 接收时先校验 `event.origin`，只处理白名单里的来源
- `event.data` 要当作不可信的输入，不能直接拿去 `eval` 或插入 `innerHTML`
:::

::: details 多个标签页同时修改同一份数据，怎么避免冲突？
- Web Locks：修改前用 `navigator.locks.request('cart', async () => { ... })` 加锁，同名的锁同一时间只有一个页面能拿到，"读取、修改、写回"就不会交错
- 版本号：数据带上版本号，写入前检查版本是否和读取时一致，不一致说明被别人改过，重新读取后再合并（乐观锁）
- 以服务端为准：标签页之间只广播"数据变了"，各自重新拉取最新数据
:::

## 易错点

- `storage` 事件只在**其他**同源页面触发，修改者自己收不到；写入相同的值也不会触发
- BroadcastChannel 的发送者收不到自己发的消息
- 跨域 `postMessage` 要等对方页面加载完成再发，否则消息会丢失
