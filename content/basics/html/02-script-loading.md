---
difficulty: 1
tags: [高频, 原理]
---

# script 的 async 和 defer 有什么区别？type="module" 呢？

::: tip 一句话回答
普通的 `<script>` 会**暂停 HTML 解析**，等脚本下载并执行完才继续。**defer** 脚本并行下载，等 HTML 解析完后**按书写顺序**执行，执行完才触发 DOMContentLoaded；**async** 脚本也并行下载，但**下载完立刻执行**，多个 async 脚本谁先下完谁先执行。`type="module"` 的脚本默认就按 defer 的方式执行，加上 async 则变成下载完（包括它的依赖）就执行。
:::

## 详细解析

### 时间线

```text
              时间 ──────────────────────────────────────────▶
普通脚本      解析 HTML ──┤ 暂停：下载 ▒▒▒▒ 执行 ▓▓ ├── 继续解析 ──┤
defer         解析 HTML ─────────────────────────────────────┤▓▓ → DOMContentLoaded
                   └─ 下载 ▒▒▒▒（并行，不打断解析）
async         解析 HTML ───────────┤▓▓├─────────────────────┤
                   └─ 下载 ▒▒▒▒ ─┘ 下载完立即执行，执行期间解析暂停
```

| | 下载时是否阻塞解析 | 什么时候执行 | 多个脚本的顺序 | DOMContentLoaded 是否等它 |
| --- | --- | --- | --- | --- |
| 普通脚本 | 是 | 下载完立即执行 | 按书写顺序 | 等 |
| `defer` | 否 | HTML 解析完之后 | 按书写顺序 | 等 |
| `async` | 否 | 下载完立即执行 | 不确定 | 不等 |
| `type="module"` | 否 | 同 defer | 按书写顺序 | 等 |
| `type="module" async` | 否 | 自身和依赖都下载完后立即执行 | 不确定 | 不等 |

几个细节：

- defer 和 async 只对带 `src` 的外链脚本有效，写在内联的普通脚本上没有作用
- 同时写了 async 和 defer，按 async 处理
- 脚本执行前要等它前面的样式表加载完（脚本可能读取样式），defer 脚本也一样。和 DOMContentLoaded 的关系见 [DOMContentLoaded 和 load 的区别](/basics/browser/08-domcontentloaded-load)

### type="module" 的其他特点

- 内联的 module 脚本也会延迟执行，也可以加 async
- 默认是严格模式；顶层声明的变量只在模块内有效，不会挂到 `window` 上
- 可以使用 `import`、`export` 和顶层 `await`
- 同一个 URL 的模块只执行一次，引入多次也一样
- 跨域加载 module 脚本要走 CORS，服务端没返回 `Access-Control-Allow-Origin` 会加载失败
- `<script nomodule>` 只在不支持 ES Module 的老浏览器里执行，以前用来提供降级版本

### 动态 import() 按需加载

`import()` 返回一个 Promise，在运行时才去加载模块。打包工具会把它拆成单独的文件，首屏不用下载这部分代码（见 [代码分割](/basics/build/05-code-splitting)）。

```js
button.addEventListener('click', async () => {
  // 第一次点击时才下载编辑器的代码，之后命中模块缓存
  const { openEditor } = await import('./editor.js')
  openEditor()
})
```

### 放在 head 里还是 body 底部

- 以前的做法是把普通脚本放在 `</body>` 前面，避免阻塞前面内容的解析和渲染，执行时 DOM 也已经就绪
- 现在更推荐**放在 `<head>` 里并加 defer**（或用 module）：不阻塞解析，执行时 DOM 已经解析完，顺序也有保证，而且脚本标签出现得早，浏览器能更早开始下载
- 必须在首次渲染前执行的极小脚本，比如根据本地存储设置暗色主题、避免页面闪一下，适合写成内联的同步脚本放在 `<head>` 里

## 代码示例

```html
<head>
  <!-- 首次渲染前就要确定主题，内联同步执行 -->
  <script>
    document.documentElement.dataset.theme = localStorage.getItem('theme') ?? 'light'
  </script>

  <!-- 有依赖关系、要操作 DOM 的业务代码：defer，按顺序执行 -->
  <script defer src="/js/vendor.js"></script>
  <script defer src="/js/app.js"></script>

  <!-- 打包工具输出的入口通常是 module，本身就是延迟执行 -->
  <script type="module" src="/assets/index.js"></script>

  <!-- 和页面代码无关的第三方统计：async，下载完就执行，不关心顺序 -->
  <script async src="https://analytics.example.com/tag.js"></script>
</head>
```

## 面试官可能追问

::: details async 脚本一定在 DOMContentLoaded 之后执行吗？
不一定。async 脚本下载完就执行，命中缓存或文档很大时，可能在 HTML 解析完之前执行，也可能在之后。DOMContentLoaded 不等 async 脚本，所以 async 脚本里如果要操作 DOM，要先检查 `document.readyState`，已经不是 `loading` 就直接执行，否则再监听 DOMContentLoaded。
:::

::: details 用 JS 动态插入的 script 是什么行为？
用 `document.createElement('script')` 创建并插入的外链脚本不会阻塞解析，默认像 async 一样下载完就执行，多个脚本之间顺序不确定。如果要保证按插入顺序执行，在插入前设置 `script.async = false`。很多第三方 SDK 的加载代码就是这样动态插入的。
:::

::: details module 脚本依赖很多时有什么性能问题？
浏览器下载并解析完一个模块，才知道它还 `import` 了哪些模块，依赖层级深时会形成一层层的请求瀑布。所以生产环境一般还是会打包，减少模块数量；还可以用 `<link rel="modulepreload" href="...">` 提前声明关键依赖，让浏览器并行下载。很多构建工具会自动生成这些 modulepreload 标签。
:::

## 易错点

- 多个 async 脚本的执行顺序不确定，彼此有依赖的脚本（比如插件依赖某个库）不能用 async，要用 defer
- 给内联的普通脚本加 defer 或 async 不起作用；内联的 module 脚本则默认延迟执行
- module 脚本里的顶层函数不在全局作用域里，HTML 上 `onclick="handle()"` 这类内联事件调用不到，要在模块里用 `addEventListener` 绑定
- 给 module 脚本再加 defer 没有意义，它本来就是延迟执行的
