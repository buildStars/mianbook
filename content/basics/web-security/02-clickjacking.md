---
difficulty: 1
tags: [安全]
---

# 点击劫持是什么？怎么防御？

::: tip 一句话回答
点击劫持是攻击者把目标网站放进一个**透明的 iframe**，叠在自己诱饵页面的按钮上。用户以为点的是诱饵，实际点中了目标网站的按钮，在已登录的状态下完成了关注、授权、删除这类操作。防御的核心是**不让别人嵌入自己的页面**：响应头设置 `Content-Security-Policy: frame-ancestors 'self'`，同时保留 `X-Frame-Options: SAMEORIGIN` 兼容老浏览器，两者都设置时，支持 `frame-ancestors` 的浏览器以它为准。用 JS 判断 `top !== self` 再跳出的做法可以被绕过，不能当主要手段。
:::

## 详细解析

### 原理

1. 攻击者做一个诱饵页面，比如"点击领取奖品"
2. 在页面里用 iframe 加载目标网站的某个操作页，把 iframe 设成完全透明并放在最上层
3. 调整位置，让目标网站的真实按钮正好盖住诱饵按钮
4. 用户在目标网站是登录状态，这一下点击就以用户的身份完成了操作

攻击者读不到 iframe 里的内容，也拿不到 Cookie，只是"借"了用户的一次点击。它和 CSRF 都是冒用身份，区别在于：请求是目标页面自己发出的，CSRF Token 照样会被带上，所以 CSRF 的防御挡不住它。同样的思路还可以诱导用户拖拽、输入，原理都一样：让用户在看不见的目标页面上操作。

### 防御：禁止被嵌入

浏览器在渲染 iframe 之前会检查被嵌入页面的响应头，不允许就不显示。有两个响应头可以用：

| | `X-Frame-Options` | CSP `frame-ancestors` |
| --- | --- | --- |
| 取值 | `DENY`（谁都不能嵌入）、`SAMEORIGIN`（只允许同源） | `'none'`、`'self'`、一个或多个具体的源 |
| 允许指定的外部站点 | 不行，`ALLOW-FROM` 已废弃，现代浏览器遇到它会忽略整个响应头 | 可以列出多个源 |
| 嵌套的多层 iframe | `SAMEORIGIN` 要求所有祖先页面都同源 | 逐层检查每一个祖先，有一个不匹配就拦截 |
| 用 meta 标签设置 | 无效 | 无效 |
| 两者同时设置 | 被支持 `frame-ancestors` 的浏览器忽略 | 优先 |

推荐两个都设置，值保持一致：新浏览器按 `frame-ancestors` 执行，只认识 `X-Frame-Options` 的老浏览器也能防住。站点已经有完整的 CSP 时，把 `frame-ancestors` 写进去即可；也可以单独下发一个只有这条指令的 CSP 响应头，多个 CSP 响应头会同时生效。CSP 的其他指令见 [CSP](/basics/web-security/01-csp)。

```nginx
server {
    # always：错误页（4xx、5xx）也带上这两个响应头
    add_header Content-Security-Policy "frame-ancestors 'self'" always;
    add_header X-Frame-Options SAMEORIGIN always;

    location /api/ {
        # 当前层级只要写了 add_header，就不再继承上一级的，安全响应头要重写一遍
        add_header Cache-Control no-store;
        add_header Content-Security-Policy "frame-ancestors 'self'" always;
        add_header X-Frame-Options SAMEORIGIN always;
    }
}
```

### 需要被别人嵌入时

- **白名单**：只能用 `frame-ancestors 'self' https://partner.example.com`，`X-Frame-Options` 表达不了
- **缩小范围**：只给需要嵌入的页面（比如专门做的嵌入挂件路由）放开，其他页面仍然禁止
- **敏感操作二次确认**：在嵌入页面里转账、授权、删除时，弹出新窗口或要求输入密码、验证码。攻击者很难让用户在看不见的界面上完成多步操作
- **Cookie 设置 SameSite**：`Lax` 或 `Strict` 的 Cookie 不会在跨站的 iframe 请求中发送，目标页面在 iframe 里就是未登录状态，攻击也就失去了意义。它只是补充手段：同站的页面嵌入时不起作用，`SameSite=None` 的 Cookie 照样携带

### 为什么 JS 跳出不可靠

早期的做法是页面脚本判断自己是否在 iframe 里（`window.top !== window.self`），是的话就把顶层页面跳转到自己。这种做法的问题：

- 攻击者可以给 iframe 加上 `sandbox` 属性，不允许它导航顶层页面甚至不允许执行脚本，跳转直接失败
- 依赖脚本能正常加载和执行，脚本被拦截、报错就失效
- 脚本执行之前页面已经显示出来，存在时间窗口

响应头由浏览器在显示页面之前强制检查，没有这些问题。JS 跳出最多作为只能修改页面、改不了响应头时的临时补充。

## 面试官可能追问

::: details X-Frame-Options 和 frame-ancestors 同时设置，以谁为准？
支持 `frame-ancestors` 的浏览器会忽略 `X-Frame-Options`，规范这样设计就是为了让两者能一起部署。注意只有执行模式的 CSP 才会覆盖它，写在 `Content-Security-Policy-Report-Only` 里的 `frame-ancestors` 只上报、不拦截。两者的值不一致时，新老浏览器的表现会不同，所以要保持一致。
:::

::: details 自家的后台嵌在另一个子域名的门户里，应该怎么配？
子域名之间是不同源的，`SAMEORIGIN` 和 `'self'` 都会拦住。要在被嵌入的页面上写明门户的源：`frame-ancestors 'self' https://portal.example.com`。只认识 `X-Frame-Options` 的老浏览器没法表达这种白名单，如果必须支持，只能放弃这部分浏览器的防护，或者让门户改用跳转而不是嵌入。
:::

::: details 怎么确认自己的网站防住了？
在开发者工具的网络面板里查看页面响应头，确认首页、登录页、操作页以及错误页都有 `frame-ancestors` 或 `X-Frame-Options`。再在本地写一个普通的测试页，用 iframe 嵌入自己的网站，控制台会提示拒绝显示。安全扫描工具一般也会检查这两个响应头是否缺失。
:::

## 易错点

- 在 meta 标签里设置 `X-Frame-Options` 或 `frame-ancestors`：都不生效，必须用响应头
- 以为 `default-src 'none'` 能防止被嵌入：`frame-ancestors` 不会回退到 `default-src`，不写就是允许任何人嵌入
- 用了已废弃的 `ALLOW-FROM`：现代浏览器会忽略整个 `X-Frame-Options`，相当于没设置
- Nginx 在子 `location` 里写了别的 `add_header`，上一级配置的安全响应头就不再继承，这部分页面悄悄失去了防护
