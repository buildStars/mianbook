---
difficulty: 1
tags: [高频]
---

# DOMContentLoaded 和 load 有什么区别？

::: tip 一句话回答
**DOMContentLoaded** 在 HTML 解析完成、DOM 树构建完毕后在 `document` 上触发，它会等同步脚本和 defer 脚本执行完，但不等图片、iframe 和 async 脚本。**load** 要等页面上所有资源（图片、样式表、脚本、iframe 等）都加载完，才在 `window` 上触发。所以 DOMContentLoaded 总是先于 load。
:::

## 详细解析

### 触发时机

```text
1. 开始解析 HTML，readyState 为 loading
   ├─ 同步脚本：暂停解析，下载并执行完再继续
   ├─ defer 脚本：并行下载，等 HTML 解析完再按顺序执行
   └─ async 脚本：并行下载，下载完立即执行
2. HTML 解析完成，readyState 变为 interactive
   ├─ 按顺序执行 defer 脚本
   └─ 在 document 上触发 DOMContentLoaded
3. 图片、样式表、iframe、async 脚本等全部加载完成，readyState 变为 complete
   └─ 在 window 上触发 load
```

| | DOMContentLoaded | load |
| --- | --- | --- |
| 触发对象 | `document` | `window` |
| 等待同步脚本、defer 脚本 | 是 | 是 |
| 等待图片、iframe、async 脚本 | 否 | 是 |
| 适合做什么 | 查询和操作 DOM、绑定事件 | 依赖图片尺寸等资源信息的操作 |

```js
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM 已就绪，可以操作元素了')
})

window.addEventListener('load', () => {
  console.log('图片等资源都加载完了')
})
```

### 样式表会推迟 DOMContentLoaded 吗

样式表本身不会，HTML 解析不用等 CSS 下载。但脚本执行前要等已经解析到的样式表加载完，因为脚本可能会读取样式（比如调用 `getComputedStyle`）。所以如果样式表后面跟着同步脚本，脚本要等样式表，HTML 解析也跟着暂停，DOMContentLoaded 就被**间接推迟**了。defer 脚本同样要等样式表，也会间接推迟它。

### 在 DevTools 中查看

Network 面板底部会显示 DOMContentLoaded 和 Load 的时间，瀑布图中分别对应**蓝线**和**红线**。

### 页面离开相关的事件

| 事件 | 用途 |
| --- | --- |
| `beforeunload` | 页面有未保存的内容时，弹出离开确认框 |
| `pagehide` | 跳转到其他页面或关闭页面时触发，页面进入往返缓存（bfcache）时也会触发 |
| `visibilitychange` | 页面可见性变化时触发，切换标签页、最小化、切到其他 App、关闭页面时都会触发 |

`unload` 并不可靠：移动端页面切到后台后，可能被系统直接回收，`unload` 根本不会触发；而且在 Firefox 和桌面版 Chrome 中，监听 `unload` 会让页面无法进入 bfcache。所以数据上报应该在 `visibilitychange` 变为 `hidden` 时，用 `navigator.sendBeacon` 发送（见[前端监控](/basics/browser/20-monitoring)）：

```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // 由浏览器在后台发送，页面随后被关闭也不影响
    navigator.sendBeacon('/log', JSON.stringify(collectData()))
  }
})
```

## 面试官可能追问

::: details async 和 defer 脚本与这两个事件是什么关系？
- defer 脚本在 HTML 解析完后按书写顺序执行，DOMContentLoaded 会等它们全部执行完。`type="module"` 的脚本默认也是这种行为
- async 脚本下载完就执行，可能在 DOMContentLoaded 之前，也可能在之后，DOMContentLoaded 不等它；但 load 会等它

两者的区别见[从输入 URL 到页面显示](/basics/browser/01-url-to-page)。
:::

::: details 脚本执行时，怎么判断页面是否已经加载完？
检查 `document.readyState`。脚本如果是异步加载的，执行时 DOMContentLoaded 可能已经触发过了，这时再绑定监听器，回调永远不会执行：

```js
function onReady(fn) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fn)
  } else {
    // interactive 或 complete：DOM 已经解析完，直接执行
    fn()
  }
}
```
:::

::: details 为什么不推荐使用 unload 事件？
- 不可靠：移动端页面切到后台后可能被直接回收，浏览器崩溃或进程被结束时也不会触发
- 影响性能：在 Firefox 和桌面版 Chrome 中，监听 `unload` 会让页面无法进入 bfcache，用户点"后退"时只能重新加载整个页面
- 替代方案：保存状态、上报数据用 `visibilitychange`（变为 `hidden`）或 `pagehide`，发送请求用 `navigator.sendBeacon` 或带 `keepalive: true` 的 fetch
:::

## 易错点

- DOMContentLoaded 不等图片，在它的回调里读取图片尺寸可能得到 0，要在 load 或图片自己的 `load` 事件里读取
- 样式表本身不推迟 DOMContentLoaded，是脚本（包括 defer 脚本）要等样式表加载完才能执行，才间接推迟了它
- 从 bfcache 恢复的页面不会再触发 DOMContentLoaded 和 load，需要监听 `pageshow`，并通过 `event.persisted` 判断
