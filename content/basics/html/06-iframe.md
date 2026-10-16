---
difficulty: 2
tags: [安全, 实践]
---

# iframe 有哪些问题？怎么安全地嵌入别人和防止被别人嵌入？

::: tip 一句话回答
iframe 会加载一个**完整的独立文档**，带来额外的请求、内存和渲染开销，还会**推迟父页面的 load 事件**，不在首屏的可以加 `loading="lazy"`。嵌入别人的内容时，用 **`sandbox`** 收紧它的能力，再按需用 `allow-*` 放开；用 `allow` 属性控制摄像头、全屏这类权限。注意 `allow-scripts` 和 `allow-same-origin` 同时开启时，同源的页面可以自己去掉沙箱。防止自己被别人嵌入，用响应头 `X-Frame-Options` 或 CSP 的 `frame-ancestors`。父子页面通信用 `postMessage`，接收时**必须校验 origin**。
:::

## 详细解析

### iframe 带来的问题

- **性能**：每个 iframe 都有自己的文档、JS 环境、样式和资源，页面上嵌得越多，内存和请求越多
- **推迟 load**：父页面的 `load` 事件要等 iframe 里的内容加载完。地图、视频、评论这类不在首屏的 iframe，加 `loading="lazy"` 让它接近视口时再加载
- **布局**：iframe 的高度不会随内容自动变化，需要子页面通过 `postMessage` 把高度告诉父页面
- **可访问性**：要加 `title` 说明嵌入的是什么，否则读屏用户得进到 iframe 里才知道
- **SEO**：iframe 里的内容一般不会被算作父页面的内容

### sandbox：收紧被嵌入页面的能力

只写 `sandbox`（不带值）时限制最严：不能运行脚本、不能提交表单、不能打开弹窗、不能导航顶层窗口、不能下载，而且页面被当作一个**特殊的不透明源**，和任何源都不同源，读不到自己源下的 Cookie 和 localStorage。再按需逐项放开：

| 值 | 放开的能力 |
| --- | --- |
| `allow-scripts` | 运行脚本（但仍然不能打开弹窗） |
| `allow-same-origin` | 保留页面真实的源，可以访问自己源的存储 |
| `allow-forms` | 提交表单 |
| `allow-popups` | `window.open`、`target="_blank"` 打开新窗口 |
| `allow-popups-to-escape-sandbox` | 打开的新窗口不继承沙箱限制，适合嵌入的广告点击后打开正常页面 |
| `allow-top-navigation-by-user-activation` | 只在用户点击时允许跳转顶层窗口，比 `allow-top-navigation` 安全 |
| `allow-modals` | `alert`、`confirm`、`prompt` |
| `allow-downloads` | 触发文件下载 |

**`allow-scripts` 加 `allow-same-origin` 的风险**：如果被嵌入的内容和父页面同源，它的脚本可以直接访问父页面的 DOM，找到自己所在的 iframe 元素，删掉 `sandbox` 属性再重新加载自己，沙箱就形同虚设。所以展示用户提交的 HTML 时，通常放在 `srcdoc` 里或者单独的域名下，只给 `allow-scripts`，不给 `allow-same-origin`。

### allow：控制浏览器权限

```html
<iframe src="https://meet.example.com/room/1"
        allow="camera; microphone; fullscreen"
        title="视频会议"></iframe>
```

跨域 iframe 默认不能使用摄像头、麦克风、地理位置等能力，要通过 `allow` 授权，使用时还要用户在浏览器弹窗里同意。`allow` 是在父页面 `Permissions-Policy` 响应头之上再做限制，父页面自己没有的权限，也给不了 iframe。旧写法 `allowfullscreen` 相当于 `allow="fullscreen *"`。

### 防止被别人嵌入

```text
Content-Security-Policy: frame-ancestors 'self' https://partner.example.com
X-Frame-Options: SAMEORIGIN
```

- `X-Frame-Options`：`DENY` 禁止任何页面嵌入，`SAMEORIGIN` 只允许同源页面嵌入，不能指定其他源
- CSP 的 `frame-ancestors`：可以列出多个允许嵌入的源，更灵活。两个都设置时，支持 CSP 的浏览器以 `frame-ancestors` 为准，`X-Frame-Options` 只对很老的浏览器起作用
- 两者都只能通过**响应头**设置，写在 `<meta>` 里无效
- 不设置的话，页面可能被放进透明 iframe 做点击劫持，见 [点击劫持是什么](/basics/web-security/02-clickjacking)

### postMessage 通信

```js
// 父页面 https://shop.example.com
const frame = document.querySelector('#pay')
frame.addEventListener('load', () => {
  // 第二个参数写明目标 origin，iframe 被导航到别的网站时消息不会发过去
  frame.contentWindow.postMessage({ type: 'init', orderId: 42 }, 'https://pay.example.com')
})

window.addEventListener('message', (e) => {
  if (e.origin !== 'https://pay.example.com') return // 只认这个来源
  if (e.source !== frame.contentWindow) return // 而且必须来自这个 iframe
  if (e.data?.type === 'resize') frame.style.height = `${Number(e.data.height)}px`
})

// iframe 页面 https://pay.example.com
parent.postMessage({ type: 'resize', height: document.documentElement.scrollHeight }, 'https://shop.example.com')
```

收到的 `e.data` 要当作不可信输入处理，不要直接拼进 `innerHTML` 或当代码执行。更多跨窗口通信方式见 [多个标签页之间怎么通信](/basics/browser/17-cross-tab)。

## 面试官可能追问

::: details frame-src 和 frame-ancestors 有什么区别？
方向相反。`frame-src` 写在父页面的 CSP 里，限制**我的页面能嵌入哪些来源**的 iframe；`frame-ancestors` 写在被嵌入页面的 CSP 里，限制**谁能把我嵌进去**。防止被嵌入用后者，防止自己的页面被注入陌生的 iframe 用前者。
:::

::: details 没有 allow-same-origin 的沙箱 iframe 里能用 localStorage 和 Cookie 吗？
不能。页面被当作不透明源，访问 `localStorage` 或 `document.cookie` 都会抛出 `SecurityError`，它发出的请求里 `Origin` 头也是 `null`。所以嵌入的第三方页面如果依赖登录态，就必须加 `allow-same-origin`；这时更要确认它和父页面不同源，不然沙箱会被它自己拆掉。
:::

::: details 怎么判断 origin 才算严格？
用完整的字符串相等比较，或者和一个白名单数组比较。不要用 `e.origin.includes('example.com')` 或 `endsWith('example.com')` 这类模糊判断，前者 `example.com.evil.net` 就能绕过，后者 `evilexample.com` 也能通过。需要匹配子域名时，用 `new URL(e.origin)` 拿到 hostname，判断它等于主域名或以 `.example.com` 结尾，同时确认 protocol 是 `https:`。
:::

## 易错点

- 嵌入同源内容时同时开启 `allow-scripts` 和 `allow-same-origin`，等于没有沙箱
- 在 `<meta>` 里写 `frame-ancestors` 或 `X-Frame-Options`，都不会生效
- `postMessage` 发送时目标 origin 写 `'*'`，接收时不校验 `e.origin`，数据可能发给或来自错误的页面
- 用 JS 判断 `top !== self` 后跳出来防嵌入并不可靠，攻击者可以用沙箱 iframe 禁止它跳转，要靠响应头
