---
difficulty: 2
tags: [高频, 性能优化]
---

# HTTP 缓存：强缓存和协商缓存有什么区别？

::: tip 一句话回答
**强缓存**命中时浏览器不发请求，直接使用本地副本，由 `Cache-Control`（优先）和 `Expires` 控制。强缓存过期后走**协商缓存**：浏览器带上 `If-None-Match`（对应 ETag）或 `If-Modified-Since`（对应 Last-Modified）询问服务器，资源没变就返回 **304**，继续用本地缓存；变了就返回 200 和新内容。
:::

## 详细解析

### 完整流程

```text
请求资源
└─ 有缓存且没过期（Cache-Control: max-age / Expires）？
   ├─ 是 → 强缓存命中，直接使用（DevTools 显示 from memory cache / from disk cache）
   └─ 否 → 发请求，带上 If-None-Match / If-Modified-Since
           ├─ 资源没变 → 304 Not Modified，使用本地缓存
           └─ 资源变了 → 200 + 新资源 + 新的缓存响应头
```

### Cache-Control 常用指令

| 指令 | 含义 |
| --- | --- |
| `max-age=N` | N 秒内有效，是相对时间，优先级高于 `Expires` |
| `no-cache` | 可以缓存，但每次使用前都要向服务器验证（走协商缓存） |
| `no-store` | 完全不缓存 |
| `public` / `private` | 是否允许 CDN 等中间代理缓存 |
| `immutable` | 有效期内资源不会变化，刷新页面时也不用重新验证 |

### ETag 和 Last-Modified

- **Last-Modified** 只精确到秒，1 秒内的多次修改识别不出来；文件内容没变、只是修改时间变了（比如重新部署），也会让缓存失效
- **ETag** 是根据内容生成的标识，更精确，但服务器计算有开销
- 两者同时存在时，服务器优先校验 ETag

### 前端项目的常用策略

| 资源 | 缓存策略 | 原因 |
| --- | --- | --- |
| HTML | `Cache-Control: no-cache` | 入口文件要保证每次都是最新的 |
| 带 hash 的 JS/CSS/图片（如 `app.3f9a1c.js`） | `Cache-Control: max-age=31536000, immutable` | 内容一变文件名就变，可以放心长期缓存 |

## 面试官可能追问

::: details 地址栏回车、普通刷新、强制刷新，对缓存的影响有什么不同？
- 地址栏回车（正常访问）：正常使用强缓存
- 普通刷新（F5）：主文档会重新向服务器验证；在 Chrome 中，其他子资源仍然可以使用强缓存
- 强制刷新（Ctrl + F5）：跳过所有缓存，重新请求全部资源
:::

::: details 发布新版本后，为什么用户看到的还是旧页面？
常见原因是 HTML 被强缓存了，或者 CDN 节点上缓存了旧文件。解决：HTML 设置 `no-cache`；静态资源文件名带 hash；必要时主动刷新 CDN 缓存。
:::

::: details 304 和强缓存命中，哪个更快？
强缓存更快。304 仍然要发一次请求、等服务器响应，只是省掉了响应体的传输。
:::

## 易错点

- `no-cache` 不是"不缓存"，而是"使用前先验证"；不缓存是 `no-store`
- 304 也是一次完整的网络往返，只是没有响应体
