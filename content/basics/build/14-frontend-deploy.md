---
difficulty: 2
tags: [实践, 场景题, 高频]
---

# 前端项目怎么部署？缓存、灰度和回滚怎么做？

::: tip 一句话回答
构建产物的文件名带**内容哈希**，内容不变哈希就不变。缓存策略分两类：**HTML 用协商缓存**（`Cache-Control: no-cache`），保证每次都能拿到最新的入口；**带哈希的 JS、CSS、图片设置一年的强缓存**加 `immutable`。发布时**先上传静态资源、再更新 HTML**，旧版本的资源保留一段时间。**灰度**是按用户或比例返回不同版本的 HTML，**回滚**是把 HTML 切回上一个版本，都不需要重新构建。SPA 还要配置 history 路由的 **fallback**，并处理发版后旧页面加载 chunk 失败的问题。
:::

## 详细解析

### 为什么要用内容哈希

构建工具会根据文件内容生成哈希，写进文件名，例如 `index-CFzkvzqM.js`（webpack 用 `[contenthash]`，Vite 默认就带哈希）。这样做有两个好处：

- 内容变了文件名一定变，浏览器会把它当作新文件请求，**不存在缓存没更新的问题**
- 内容没变的文件名保持不变，用户升级版本时只下载变化的部分。把第三方库拆成单独的 chunk，业务代码改动就不会影响它的缓存

### 缓存策略

| 资源 | 响应头 | 原因 |
| --- | --- | --- |
| `index.html` | `Cache-Control: no-cache` | 每次都向服务器确认，内容没变返回 304，变了就拿到新版本 |
| 带哈希的 JS、CSS、字体、图片 | `Cache-Control: public, max-age=31536000, immutable` | 文件名变了就是新文件，旧文件可以放心缓存一年 |
| 不带哈希的文件（`favicon.ico`、`robots.txt`） | 较短的 `max-age` 或协商缓存 | 文件名固定，缓存太久就无法更新 |

`no-cache` 不是"不缓存"，而是"使用前必须重新验证"；真正禁止缓存的是 `no-store`。强缓存和协商缓存的原理见 [HTTP 缓存](/basics/network/01-http-cache)。静态资源通常放在 CDN 上，HTML 可以放在源站或者 CDN 上设置很短的缓存，发版后主动刷新（CDN 原理见 [CDN](/basics/network/12-cdn)）。

### 发布顺序

1. 构建，生成带哈希的静态资源和新的 `index.html`
2. **先上传静态资源**到 CDN 或静态服务器。文件名都是新的，不会覆盖线上正在使用的文件，此时用户看到的还是旧版本
3. **再更新 HTML**，新的 HTML 引用的资源都已就位
4. 旧版本的静态资源保留一段时间（例如最近几个版本），不要随着发布一起删掉

顺序反过来，就会出现新 HTML 引用的 JS 还没上传、页面白屏的情况；先删掉旧资源，正打开着旧页面的用户在懒加载时就会 404。

### 灰度和回滚

**灰度**：每个版本的 HTML 单独保存（例如 `releases/v1/index.html`、`releases/v2/index.html`），静态资源统一放在一起，靠哈希区分。网关或 nginx 根据规则决定返回哪个版本的 HTML：

- 按比例：用用户 ID 或设备 ID 的哈希分桶，固定 10% 的用户看到新版本
- 按名单：内部员工、指定地区、带特定 Cookie 的用户先体验
- 同一个用户要**稳定**落在同一个版本，不能每次刷新都在新旧版本之间跳

观察错误率和关键指标（见 [前端监控](/basics/browser/20-monitoring)），没有问题再逐步扩大比例。只想对某个功能做灰度时，可以用功能开关（feature flag），在同一个版本的代码里按用户决定是否启用。

**回滚**：因为旧版本的 HTML 和资源都还在，回滚只需要把 HTML 的指向切回上一个版本，例如修改软链接或网关配置，几秒钟就能完成，不需要重新构建。用容器部署时，回滚就是切回上一个镜像版本（镜像构建见 [多阶段构建](/basics/container/03-multi-stage)）。

### history 路由的 fallback

history 模式下，用户直接访问或刷新 `/user/42`，服务器上并没有这个文件。需要配置成"找不到文件时返回 `index.html`"，再由前端路由渲染对应的页面（原理见 [前端路由](/basics/browser/18-frontend-routing)）。注意 `/assets/` 下的文件找不到时要直接返回 404，不能也返回 HTML，否则浏览器会把 HTML 当作 JS 执行，报出难以理解的语法错误。

### 发版后旧页面加载 chunk 失败

用户在发版前打开了页面，一直没有刷新。发版后他点进一个懒加载的路由，旧代码去请求旧的 chunk：

- 旧资源还在：正常加载，这就是要保留旧版本资源的原因
- 旧资源已被删除：动态导入失败。webpack 抛出 `ChunkLoadError`，Vite 会在 `window` 上触发 `vite:preloadError` 事件

兜底做法是捕获这类错误后刷新页面，拿到新的 HTML；要记录刷新时间，防止资源确实出了问题时无限刷新。更主动的做法是定期请求一个 `version.json`，发现版本变化后提示用户刷新。

## 代码示例

nginx 配置：HTML 协商缓存、静态资源长期缓存、history fallback，并按 Cookie 分桶做灰度：

```nginx
# 按用户 ID 的哈希分桶：10% 的用户进入 v2（要求请求带 uid Cookie）
split_clients "${cookie_uid}" $release {
    10%     v2;
    *       v1;
}
# 没有 uid Cookie 的请求哈希值都相同，会落进同一个桶，实际使用时要先由网关下发 uid

server {
    listen 80;

    # 所有版本带哈希的静态资源都放在同一个目录
    location /assets/ {
        root /var/www/app/shared;
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    # 每个版本的 index.html 单独存放；回滚时删掉 split_clients 里 v2 那一行再 reload nginx
    location / {
        root /var/www/app/releases/$release;
        add_header Cache-Control "no-cache";
        # 找不到文件时内部跳转到 /index.html，会重新匹配这个 location，Cache-Control 照样加上
        try_files $uri /index.html;
    }
}
```

Vite 项目中，旧 chunk 加载失败时刷新页面，并防止反复刷新：

```js
window.addEventListener('vite:preloadError', (event) => {
  const key = 'chunk-reload-at'
  const last = Number(sessionStorage.getItem(key) || 0)
  // 10 秒内已经刷新过一次，说明不是版本问题，交给错误处理流程
  if (Date.now() - last < 10_000) return
  event.preventDefault() // 阻止错误继续抛出
  sessionStorage.setItem(key, String(Date.now()))
  window.location.reload()
})
```

## 面试官可能追问

::: details 静态资源已经带了哈希，为什么 HTML 不能也设置强缓存？
HTML 是整个应用的入口，文件名固定，里面写着这次要加载哪些带哈希的资源。HTML 一旦被强缓存，用户在缓存过期前会一直使用旧的入口，引用旧的资源，新版本发布了也看不到，出了问题也无法通过回滚修复。所以 HTML 必须每次都向服务器确认。
:::

::: details 同一份构建产物怎么部署到测试、预发、生产多个环境？
如果把接口地址这类配置在构建时写死，每个环境就得单独构建，测试过的产物和上线的产物不是同一份。更好的做法是"构建一次，到处部署"：配置放在运行时加载的 `config.json` 里，或者在部署时注入到 HTML 的一个全局变量中，产物本身和环境无关。
:::

::: details 灰度的时候，新旧版本的接口不兼容怎么办？
灰度期间新旧前端会同时访问后端，后端接口必须同时兼容两个版本：先发布兼容新旧两种调用方式的后端，再灰度前端，等旧版前端完全下线后再清理旧的接口逻辑。新增字段只加不删，改动字段含义时用新的字段名，就是为了让这个过程平滑。
:::

## 易错点

- 给 `index.html` 设置了长时间的强缓存，或者 CDN 上的 HTML 没有在发版后刷新，用户迟迟看不到新版本
- 每次发布都清空静态资源目录，打开着旧页面的用户懒加载时报 404
- history fallback 对所有路径都返回 `index.html`，资源 404 变成了 JS 语法错误，问题被掩盖
- 把 `no-cache` 理解成不缓存，把禁止缓存的 `no-store` 用在了静态资源上
