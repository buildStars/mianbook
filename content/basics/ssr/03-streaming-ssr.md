---
difficulty: 3
tags: [原理, 性能优化]
---

# 流式 SSR 是什么？和传统 SSR 有什么区别？

::: tip 一句话回答
传统 SSR 要等页面**所有数据都准备好**、整页渲染成字符串才返回，最慢的那个接口决定了首字节时间。流式 SSR 借助 **HTTP 分块传输**，先把不依赖慢数据的**页面外壳**发出去，慢的部分用 **Suspense 边界**包住、先输出 fallback，数据到了再把这一块的 HTML 和一小段替换脚本追加到同一个响应里。收益是**更早的首字节和首屏**，浏览器能提前下载 CSS 和 JS；配合**选择性水合**，先到的部分先变得可交互。代价是开始输出后**状态码和响应头就不能再改**，错误处理、缓存和 SEO 都要重新考虑。
:::

## 详细解析

### 传统 SSR 慢在哪里

```text
（时间为假设值）
传统 SSR：[取用户 50ms][取商品 80ms][取评论 1500ms][渲染] → 一次性返回整页
流式 SSR：[取用户和商品][渲染外壳] → 立即发送外壳，评论的位置先放 fallback
                   …… 评论数据到了 → 追加评论的 HTML 和替换脚本 → 结束响应
```

用 `renderToString` 这类 API 时：一个慢接口拖住整页；等待期间浏览器什么都收不到，没法提前下载 CSS 和 JS；服务端还要在内存里拼出完整的字符串。

### 流式 SSR 怎么工作

1. 响应不设置 `Content-Length`，HTTP/1.1 下用 `Transfer-Encoding: chunked` 分块发送（HTTP/2 本身就是分帧传输），服务端边渲染边写
2. 所有 Suspense 边界之外的部分叫**外壳**（shell）。外壳渲染完就发出去，挂起的边界先输出 fallback 和一个占位标记
3. 某个边界的数据准备好后，服务端把它的 HTML 放进一个隐藏的容器追加到响应里，再附一段内联脚本，把内容移到占位的位置、替换掉 fallback
4. 所有边界都完成后结束响应

React 输出的分块格式见 [Suspense](/basics/react/16-suspense)。谁先准备好谁先发，慢的部分不会挡住后面的内容，这叫**乱序流式**。

### 选择性水合

外壳到达后，客户端就可以开始水合，不用等所有内容。React 中每个 Suspense 边界**独立水合**：先到达的部分先变得可交互；用户点击了还没水合的区域，React 会提高它的优先级先水合。传统 SSR 是整页一次性水合，页面大时会长时间占住主线程。

### React 和 Vue 的流式 API

```jsx
import { renderToPipeableStream } from 'react-dom/server'

// 以 Express 为例，所有页面请求都交给 React 渲染
app.use((req, res) => {
  let didError = false
  const { pipe, abort } = renderToPipeableStream(<App url={req.url} />, {
    bootstrapScripts: ['/client.js'], // 客户端入口，里面调用 hydrateRoot
    onShellReady() {
      // 外壳渲染完成：这是最后一次设置状态码和响应头的机会
      res.statusCode = didError ? 500 : 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      pipe(res)
    },
    onShellError() {
      // 外壳本身渲染失败，还没输出任何内容，可以返回兜底页面
      res.statusCode = 500
      res.send('<h1>页面出错了</h1>')
    },
    onError(err) {
      didError = true
      console.error(err)
    },
  })
  setTimeout(() => abort(), 10000) // 超时后剩下的边界输出 fallback，交给客户端渲染
})
```

- **React**：`renderToPipeableStream` 输出 Node.js 的流，Web Streams 环境（Deno、边缘运行时）用 `renderToReadableStream`。面向爬虫或做静态生成时，可以改在 `onAllReady` 回调里再 `pipe`，一次性输出完整 HTML
- **Vue**：`vue/server-renderer` 提供 `renderToNodeStream`、`pipeToNodeWritable`、`renderToWebStream` 等。Vue 的流**按文档顺序输出**：遇到异步组件就在那里等它完成，再继续输出后面的内容，没有"先发 fallback、后补内容"的乱序替换。收益主要是更早的首字节，慢数据仍然会挡住它后面的 HTML

### 需要注意的问题

- **状态码和响应头**：第一块发出后响应头就固定了。外壳之后才发现的 404、重定向改不了状态码，框架只能在 HTML 里插入跳转脚本或 `noindex` 标签。需要正确状态码的判断（资源是否存在、是否登录）要在外壳渲染之前完成
- **Cookie**：Set-Cookie 也是响应头，开始输出后就不能再设置，刷新登录态要在渲染前做
- **错误处理**：外壳出错走 `onShellError`，返回兜底页面；边界内的组件出错不会中断响应，React 会输出这个边界的 fallback，再在客户端重试渲染，客户端也失败才交给错误边界
- **中间层缓冲**：反向代理、压缩中间件、部分 CDN 会把整个响应缓冲完再转发，流式就失效了。比如 Nginx 默认开启 `proxy_buffering`，需要针对 SSR 关闭
- **缓存**：整页缓存时缓存的是最终完整的 HTML，命中缓存后流式的意义不大；流式更适合不能缓存的动态页面
- **SEO**：流式内容在同一个 HTML 响应里，搜索引擎能拿到。`<title>`、`<meta>` 最好放在外壳里输出；对只读静态 HTML 的爬虫，可以识别 User-Agent 后改在 `onAllReady` 里一次性返回完整页面，Next.js 对这类爬虫也会先解析完元数据再输出

## 面试官可能追问

::: details Suspense 边界应该怎么划分？
外壳要"小而完整"：导航、标题、主要内容放在外壳里，让用户第一眼看到有意义的页面；慢的、次要的数据（评论、推荐、个性化模块）各自包一个 Suspense。整个应用只包一层 Suspense，外壳就只剩一个大 loading；边界太碎，fallback 此起彼伏，页面跳来跳去。fallback 的尺寸要和真实内容接近，避免布局偏移。
:::

::: details 为什么流式 SSR 能让 CSS、JS 更早加载？
浏览器收到第一块 HTML 就开始解析，遇到 `<head>` 里的 `<link>`、`<script>` 立即发起请求。传统 SSR 下这些标签要等整页渲染完才发出，"服务端取数据"和"浏览器下载资源"是串行的；流式 SSR 让两者并行。
:::

::: details Next.js 和 Nuxt 里怎么用流式渲染？
Next.js 的 App Router 默认流式输出：`loading.js` 会给页面自动包一层 Suspense，也可以在组件里手动放 `<Suspense>`，服务端组件 await 数据时挂起，见 [App Router](/basics/ssr/04-next-app-router)。Nuxt 默认等页面渲染完再整体返回，流式输出目前是需要在配置里显式开启的实验性功能（`experimental.ssrStreaming`），具体以所用版本的文档为准；慢数据也可以用 `lazy` 或 `server: false` 放到客户端获取，见 [Nuxt 的数据获取](/basics/ssr/07-nuxt-data-fetching)。
:::

::: details 流式 SSR 和 BigPipe 是什么关系？
思路一样。BigPipe 是 Facebook 早年的做法：先输出页面骨架，再把各个模块（pagelet）的内容和脚本依次推送下去，由前端脚本放到对应位置。React 的流式 SSR 把这个模式和组件模型结合起来：开发者只需要声明 Suspense 边界，分块、占位、替换和水合都由框架完成。
:::

## 易错点

- 以为开始流式输出后还能重定向、改状态码或者设置 Cookie
- 以为 Vue 的流式渲染和 React 一样会先发 fallback：Vue 按顺序输出，慢的异步组件会挡住后面的内容
- 本地验证有效，线上被反向代理或压缩中间件缓冲，流式失效
- 整个应用只包一个 Suspense，外壳里没有有意义的内容
