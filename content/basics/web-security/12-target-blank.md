---
difficulty: 1
tags: [安全, 高频]
---

# target="_blank" 有什么安全风险？noopener 和 noreferrer 有什么区别？

::: tip 一句话回答
用 `target="_blank"` 打开的新页面过去能通过 `window.opener` 拿到原页面的引用，把原页面悄悄导航到钓鱼网站，这叫**反向标签页劫持（reverse tabnabbing）**。`rel="noopener"` 让新页面的 `window.opener` 为 `null`；`rel="noreferrer"` 在此基础上**还不发送 Referer**。现代主流浏览器已经让 `_blank` 默认带上 noopener，但显式写上仍是好习惯。
:::

## 详细解析

### 攻击是怎么发生的

```text
1. 用户在 A 站（比如论坛）点击外链，新标签打开 B 站
2. B 站脚本拿到 window.opener，它指向 A 站那个标签页
3. B 站把 opener 导航到一个仿冒 A 站的登录页
4. 用户看完 B 站，切回原标签页，看到"登录已过期"，输入了密码
```

跨源时 B 站读不到 A 站的 DOM 和数据，但**修改 `opener.location` 是被允许的**。用户切回去时注意力不在地址栏，很容易上当。

另一个副作用是性能：有 opener 关系的两个页面可能被放在同一个渲染进程里，新页面的重计算会拖慢原页面。

### noopener 和 noreferrer

| | `window.opener` | 发送 Referer |
| --- | --- | --- |
| 什么都不写（旧浏览器） | 指向原页面 | 按 Referrer-Policy 发送 |
| `rel="noopener"` | `null` | 按 Referrer-Policy 发送 |
| `rel="noreferrer"` | `null` | 不发送 |

- `noreferrer` 隐含 `noopener` 的效果
- 想让对方知道流量从哪来（统计、合作方对账），用 `noopener`；不想暴露来源地址，用 `noreferrer`
- 现在 HTML 规范规定 `target="_blank"` 的链接默认按 noopener 处理，需要保留 opener 时要显式写 `rel="opener"`

Referer 泄露路径、查询参数里的 token 等问题见 [敏感信息泄露](/basics/web-security/08-sensitive-data)。

```html
<a href="https://other.example" target="_blank" rel="noopener noreferrer">外部链接</a>
```

### window.open 也要处理

用 JS 打开新窗口时，`_blank` 的默认规则不一定适用，要在第三个参数里写明：

```js
// 新窗口拿不到 opener；注意此时返回值是 null，拿不到新窗口的引用
const win = window.open(url, '_blank', 'noopener,noreferrer')
```

如果需要先拿到引用再导航，可以先 `window.open()`，手动设置 `win.opener = null`，再给 `win.location` 赋值。

### COOP：从页面一侧切断

前面都是"打开方"的防护。被打开或打开别人的页面还可以设置响应头 `Cross-Origin-Opener-Policy: same-origin`：跨源的窗口之间会被放进不同的浏览上下文组，`window.opener` 之类的引用被切断。它是页面级的兜底，也是启用 `SharedArrayBuffer` 所需的跨源隔离条件之一。

## 面试官可能追问

::: details 既然浏览器默认 noopener 了，还需要写 rel 吗？
建议写。一是旧版浏览器和部分 WebView 没有这个默认行为；二是 `window.open` 不受链接默认规则约束；三是显式写出意图，代码审查和 lint 规则（比如 React 的 `jsx-no-target-blank`）更好检查。
:::

::: details 同源的新标签页有这个问题吗？
同源页面之间本来就能互相读写 DOM，opener 只是其中一条路径。所以同站链接的风险不在 opener，而在页面本身是否可信。这个问题主要针对指向外部网站、或用户可以填写链接（评论、个人主页）的场景。
:::

::: details 什么时候需要保留 opener？
第三方登录、支付弹窗等流程，有时需要新窗口完成后通知原页面。更推荐的方式是用 postMessage 并校验 origin（见 [postMessage 安全](/basics/web-security/10-postmessage-security)），或者回到原页面后由服务端确认结果，而不是让弹窗直接操作 opener。
:::

## 易错点

- 以为跨源页面完全不能动原页面。读不了内容，但能改它的 `location`
- 以为 `noopener` 会阻止发送 Referer，那是 `noreferrer` 的作用
- `window.open` 带上 `noopener` 后还去用返回值，这时返回值是 `null`
