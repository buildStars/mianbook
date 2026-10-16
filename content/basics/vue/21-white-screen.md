---
difficulty: 2
tags: [高频, 场景题]
---

# Vue 项目首页白屏可能是什么原因？怎么排查和解决？

::: tip 一句话回答
白屏说明 `#app` 里没有渲染出内容，常见原因有五类：**资源路径配错**（`base` / `publicPath`）、**history 模式刷新 404**（服务端没回退到 index.html）、**JS 报错中断挂载**、**首包太大加载慢**、**浏览器不兼容新语法**。排查顺序是先看控制台报错，再看 Network 里 JS 是否 404 或很慢，线上靠错误监控定位。修复对应地改配置、加回退规则、加错误处理，慢的问题用懒加载、骨架屏或 SSR。
:::

## 详细解析

### 为什么会"白"

Vue 单页应用的 index.html 里只有一个空的 `<div id="app">`，所有内容都要等 JS 下载、执行、`app.mount('#app')` 之后才出现。中间任何一环失败或太慢，用户看到的就是白屏。所以排查就是找"哪一环断了"。

### 常见原因和修复

| 原因 | 现象 | 修复 |
| --- | --- | --- |
| 资源路径错 | Network 里 js/css 404，或返回的是 HTML | 部署在子路径时配置 Vite 的 `base` 或 Vue CLI 的 `publicPath` |
| history 模式没回退 | 首页正常，刷新子路由 404 | 服务端把未知路径回退到 index.html |
| JS 运行时报错 | 控制台有红色报错，`mount` 没执行或根组件 setup 抛错 | 修代码；加 `app.config.errorHandler` 和兜底 UI |
| 首包过大 | 白屏几秒后才出来，弱网更明显 | 路由懒加载、拆包、压缩、CDN、骨架屏 |
| 浏览器兼容 | 只在老设备白屏，报 `SyntaxError` | 调整构建目标或引入兼容插件 |

还有一些边缘情况：发布后用户缓存了旧的 index.html，引用的旧 chunk 已被删除；或者接口挂了，而页面又写成"拿到数据才渲染"。发布顺序问题见 [前端部署](/basics/build/14-frontend-deploy)。

### history 模式的回退配置

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

浏览器刷新 `/user/1` 时，请求真的会发到服务器，服务器上没有这个文件就会 404。`try_files` 让找不到的路径都返回 index.html，再由前端路由接管。原理见 [前端路由](/basics/browser/18-frontend-routing)。

### 排查步骤

1. 打开控制台，看有没有报错。`Uncaught SyntaxError` 多半是兼容或资源返回了 HTML，`TypeError` 多半是代码问题
2. 看 Network：主 JS 是 404、返回类型不对，还是下载很久
3. 看 Elements：`#app` 里是否为空。不为空但看不见，是样式问题而不是白屏
4. 本地 `vite build && vite preview` 复现生产包，排除开发环境和生产环境的差异
5. 线上无法复现时，看错误监控里的报错和设备信息。白屏检测的做法见 [前端监控](/basics/browser/20-monitoring)

## 代码示例

```ts
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

const app = createApp(App)

// 组件渲染、生命周期、事件处理里的错误都会到这里
app.config.errorHandler = (err, instance, info) => {
  console.error('[vue error]', info, err)
  // 上报到监控平台
}

// 懒加载的路由 chunk 加载失败（常见于发布后旧 chunk 被删）
router.onError((err) => {
  if (/Failed to fetch dynamically imported module/.test(String(err))) {
    location.reload()
  }
})

app.use(router).mount('#app')
```

在 index.html 的 `#app` 里直接写一段骨架屏或 loading 的 HTML，挂载时会被替换掉。这样即使 JS 慢，用户也不会面对纯白页面。

## 面试官可能追问

::: details errorHandler 能捕获所有导致白屏的错误吗？
不能。它只管 Vue 内部调用的代码，比如渲染函数、生命周期、`setup`、侦听器。在 `createApp` 之前抛的错、语法错误导致整个文件没执行、资源 404，它都捕获不到。这些要靠 `window.onerror` 和 `error` 事件（捕获阶段可以拿到资源加载失败）。
:::

::: details 首屏慢导致的白屏怎么从根上解决？
先减量：路由懒加载、按需引入组件库、分析包体积去掉大依赖，见 [代码分割](/basics/build/05-code-splitting)。再提前出内容：骨架屏只是让体验好一些，真正让首屏有 HTML 的是 SSR 或预渲染，见 [SSR 和水合](/basics/vue/18-ssr-hydration)。
:::

::: details 本地正常、部署后白屏，最可能是什么？
最常见的是资源路径：项目部署在 `/admin/` 这样的子路径，但 `base` 还是 `/`，资源都请求到了根路径。另外常见的是 history 模式服务端没配回退，以及生产环境变量没配，代码里读到 `undefined` 后报错。
:::

## 易错点

- 改了 `base` 还要同步改路由：`createWebHistory(import.meta.env.BASE_URL)`，否则资源对了，路由匹配不上
- 资源 404 时，服务端如果统一回退 index.html，浏览器拿到的是 HTML，控制台报的是语法错误而不是 404，容易误判
- 页面"白"不一定是没渲染，也可能是渲染了但样式让内容不可见，先看 Elements 再下结论
