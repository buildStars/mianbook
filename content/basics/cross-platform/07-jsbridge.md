---
difficulty: 2
tags: [原理, 高频]
---

# H5 和原生 App 怎么通信？JSBridge 的原理是什么？

::: tip 一句话回答
**JS 调原生**有两种方式：原生向 WebView **注入对象**，JS 直接调用它的方法（Android 的 `addJavascriptInterface` 或更安全的 `addWebMessageListener`，iOS WKWebView 的 `messageHandlers`）；或者**拦截自定义 URL Scheme**，JS 发起一个 `myapp://` 开头的请求，原生在加载前拦下来解析。**原生调 JS** 是让 WebView **执行一段 JS 字符串**（`evaluateJavascript`）。JSBridge 就是在这两条通道上封装的一层协议：每次调用生成唯一的回调 id，原生执行完按 id 回调，对页面暴露成 Promise 风格的 API。安全上要**只对信任的域名开放**，按域名做**接口白名单**，原生侧**校验参数**。
:::

## 详细解析

### JS 调原生

**注入对象**：原生在页面加载前把一个对象挂到 `window` 上，JS 调它的方法就进入了原生代码。

- **Android**：传统做法是 `addJavascriptInterface(obj, "NativeBridge")`，加了 `@JavascriptInterface` 注解的公开方法才能被 JS 调用，调用是同步的，在另一个线程执行。它不区分页面来源，任何加载进这个 WebView 的页面都能调。官方现在更推荐 `WebViewCompat.addWebMessageListener`：注册时传入允许的源，只有匹配的页面才会被注入对象，回调里还能拿到消息来源
- **iOS**：WKWebView 通过 `userContentController.add(handler, name: "bridge")` 注册，页面里就有了 `window.webkit.messageHandlers.bridge.postMessage(data)`。调用是异步的，`data` 可以是字符串、数字、数组、普通对象等可序列化的值

**拦截 URL Scheme**：JS 创建一个隐藏的 iframe 或改 `location`，访问 `myapp://bridge/scan?id=1`。原生在 WebView 的导航拦截回调里（Android 的 `shouldOverrideUrlLoading`，iOS 的导航策略回调）识别出这个协议，解析参数并阻止真正的跳转。兼容性好，但只能异步、URL 有长度限制，用 `location` 连续触发时还可能丢消息，现在一般只作为兼容老系统的后备方案。

### 原生调 JS

原生直接让 WebView 执行一段 JS 字符串：Android 用 `webView.evaluateJavascript(script, callback)`，iOS 用 `webView.evaluateJavaScript(script)`。通常约定页面上有一个全局函数（如 `window.JSBridge._receive`），原生把结果拼成 JSON 字符串传进去。拼接时要对数据做 JSON 编码，否则引号、换行会让脚本语法出错，甚至被注入。

### 封装成带回调的 API

注入对象和 `postMessage` 本身没有"返回值"这回事，要自己设计协议：

1. JS 调用时生成唯一 id，把 `{ id, method, params }` 发给原生，同时把 `resolve`/`reject` 按 id 存起来
2. 原生执行完，调用 `window.JSBridge._receive({ id, result, error })`
3. JS 按 id 找到对应的回调执行，删掉记录；超时没回来就主动 `reject`

原生主动推送的事件（如网络状态变化、App 回到前台）也走同一个入口，只是没有 id，按事件名分发。

### 安全

- **只对信任的域名开放**：原生收到调用时检查发消息页面的源，不在白名单里直接拒绝。iOS 可以从消息的 `frameInfo.securityOrigin` 拿到源；Android 的 `addJavascriptInterface` 拿不到调用方的源，`webView.getUrl()` 也不可靠，所以优先用带源限制、回调里有 `sourceOrigin` 的 `addWebMessageListener`
- **接口分级白名单**：自家核心页面能调支付、读用户信息，合作方页面只能调分享、关闭页面
- **参数校验**：原生侧对每个参数做类型和范围校验，不要把 JS 传来的路径、URL、SQL 片段直接拿去用
- **不在带桥的 WebView 里打开任意链接**：外部链接交给系统浏览器打开。白名单域名里如果有 XSS，攻击脚本同样能调用桥，敏感操作还需要原生侧二次确认

### 调试

- **Android**：开启 `WebView.setWebContentsDebuggingEnabled(true)`（只在调试包开启），在电脑上的 Chrome 打开 `chrome://inspect` 调试页面
- **iOS**：用 Mac 上 Safari 的 Web 检查器连接设备。较新的系统上要把 WKWebView 的 `isInspectable` 设为 `true`（默认是 `false`，只在调试包开启）
- **页面内**：接入 vConsole、eruda 这类面板看日志；在普通浏览器里开发时，给 JSBridge 写一个 mock 实现

## 代码示例

页面侧的 JSBridge（原生接口名是自己约定的，下面只是示意）：

```js
const pending = new Map()
let seq = 0

function postToNative(msg) {
  if (window.webkit?.messageHandlers?.bridge) {
    window.webkit.messageHandlers.bridge.postMessage(msg) // iOS
  } else if (window.NativeBridge) {
    window.NativeBridge.postMessage(JSON.stringify(msg)) // Android 注入的对象
  } else {
    throw new Error('不在 App 内')
  }
}

window.JSBridge = {
  call(method, params = {}, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const id = `cb_${++seq}`
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`${method} 超时`))
      }, timeout)
      pending.set(id, { resolve, reject, timer })
      try {
        postToNative({ id, method, params })
      } catch (err) {
        clearTimeout(timer) // 发送失败要清掉记录，否则会一直挂在 pending 里
        pending.delete(id)
        reject(err)
      }
    })
  },
  // 原生执行完后调用：window.JSBridge._receive({ id, result, error })
  _receive({ id, result, error }) {
    const cb = pending.get(id)
    if (!cb) return
    clearTimeout(cb.timer)
    pending.delete(id)
    error ? cb.reject(new Error(error)) : cb.resolve(result)
  },
}

// 使用：const user = await JSBridge.call('getUserInfo')
```

原生侧只列关键调用，Android 和 iOS 的写法完全不同：

```text
// Android（Kotlin，示意）
class Bridge(private val webView: WebView) {
    @JavascriptInterface // 不加注解，JS 调不到这个方法
    fun postMessage(json: String) {
        // 这里拿不到调用方的源，只能校验方法白名单和参数；要按源控制改用 addWebMessageListener
        // 方法在 WebView 的后台线程执行，回调页面要切回主线程
        webView.post { webView.evaluateJavascript("window.JSBridge._receive($replyJson)", null) }
    }
}
webView.addJavascriptInterface(Bridge(webView), "NativeBridge")

// iOS（Swift，示意）
config.userContentController.add(handler, name: "bridge")
webView.evaluateJavaScript("window.JSBridge._receive(\(replyJson))")
```

## 面试官可能追问

::: details 为什么 Android 的 addJavascriptInterface 被认为不安全？
它把对象注入到这个 WebView 加载的所有页面，不检查来源。如果 WebView 被引导打开了攻击者的页面，或者页面里混入了不可信的内容，攻击者就能调用这些原生方法。官方建议只在 WebView 完全加载自己写的内容时使用它，新代码改用能限定源的 `addWebMessageListener`。
:::

::: details 页面怎么判断自己是不是运行在 App 里？
常见做法是 App 在 User-Agent 末尾追加自己的标识，页面检查 UA；或者检查注入的桥对象是否存在。UA 可以伪造，所以它只用来决定展示逻辑，权限判断必须在原生侧完成。
:::

::: details 原生调 JS 时，页面还没加载完怎么办？
`evaluateJavascript` 只能在页面的 JS 环境就绪后执行。可以让页面在初始化完成后主动调用一次 `JSBridge.call('ready')`，原生收到后再推送数据；也可以让原生在页面开始加载时注入一段脚本，提前定义好接收函数，把早到的消息先缓存起来。
:::

## 易错点

- 用普通的 `WKScriptMessageHandler` 时，iOS 的 `postMessage` 拿不到返回值；系统后来提供了带回复的处理器，但要兼容老系统时，还是得自己设计 id 和回传机制
- Android 注入对象的方法在非主线程执行，回调页面、操作界面前要切回主线程
- 只校验 UA 或只在前端隐藏按钮不算安全措施，能力开放的控制必须放在原生侧
