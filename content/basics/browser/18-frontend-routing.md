---
difficulty: 2
tags: [高频, 原理]
---

# 前端路由的 hash 模式和 history 模式有什么区别？

::: tip 一句话回答
前端路由的本质是**改变 URL 但不向服务器请求新页面**，再根据 URL 渲染对应的组件。**hash 模式**利用 URL 中 `#` 后面的部分，它变化时不发请求，通过 `hashchange` 事件监听，不需要服务端配置；**history 模式**用 `history.pushState` / `replaceState` 修改路径，通过 `popstate` 监听前进后退，URL 更美观，但需要服务端把所有前端路由都回退到 `index.html`，否则刷新页面会 404。
:::

## 详细解析

### hash 模式

- URL 形如 `https://example.com/#/user/1`，`#` 后面的部分只在浏览器端使用，**不会发送给服务器**
- 修改 hash（`location.hash = '/user/1'`，或点击 `href="#/user/1"` 的链接）不会刷新页面，会新增一条历史记录，并触发 `hashchange` 事件
- 优点：兼容性好，不需要服务端配置
- 缺点：URL 带 `#` 不美观；`#` 被路由占用后，不能直接用它做页面内的锚点跳转；服务器拿不到 `#` 后面的路径，没法做服务端渲染

### history 模式

- URL 形如 `https://example.com/user/1`
- `history.pushState(state, '', url)` 新增一条历史记录，`replaceState` 替换当前记录，两者都**不刷新页面**（第二个参数已废弃，传空字符串即可）
- `popstate` 在浏览器前进、后退，或调用 `history.back()` / `go()` 时触发（修改 hash 也会触发），**调用 `pushState`、`replaceState` 本身不会触发**。所以路由库要拦截站内链接的点击，调用 `pushState` 之后自己更新视图
- `pushState` 只能修改为同源的 URL，否则会抛出错误

### 服务端配置

用户刷新页面或直接访问 `/user/1` 时，浏览器会真的向服务器请求这个路径，服务器上没有对应的文件就返回 404。需要配置"找不到文件就返回 `index.html`"，交给前端路由处理，例如 Nginx：

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

这样一来，不存在的路径也会返回 200，真正的 404 页面要由前端路由的兜底路由渲染。

### 对比

| | hash 模式 | history 模式 |
| --- | --- | --- |
| URL 形式 | `/#/user/1` | `/user/1` |
| 修改 URL | 修改 `location.hash` | `pushState` / `replaceState` |
| 监听变化 | `hashchange` | `popstate`（前进后退时触发，`pushState` 不触发） |
| 发给服务器的路径 | 只有 `#` 前面的部分 | 完整路径 |
| 服务端配置 | 不需要 | 需要回退到 `index.html` |
| SEO 和 SSR | 差 | 可以配合 SSR |
| Vue Router | `createWebHashHistory()` | `createWebHistory()` |

Vue Router 的导航守卫和完整导航流程见[导航守卫](/basics/vue/16-router-guards)。较新的 Navigation API 提供了 `navigate` 事件，可以统一拦截链接点击、表单提交、前进后退等各种导航，2026 年起主流浏览器的新版本都已支持，老版本还需要兼容。

## 代码示例

```js
// 路由表：路径 → 渲染函数，'*' 兜底
const routes = {
  '/': () => '<h1>首页</h1>',
  '/about': () => '<h1>关于</h1>',
  '*': () => '<h1>404</h1>',
}
const app = document.querySelector('#app')

// 1. hash 路由
function createHashRouter() {
  function render() {
    const path = location.hash.slice(1) || '/' // '#/about' → '/about'
    app.innerHTML = (routes[path] || routes['*'])()
  }
  window.addEventListener('hashchange', render) // 修改 hash、前进后退都会触发
  render() // 首次进入页面时渲染
  return {
    push(path) {
      location.hash = path // 会触发 hashchange，不用手动渲染
    },
  }
}

// 2. history 路由
function createHistoryRouter() {
  function render() {
    app.innerHTML = (routes[location.pathname] || routes['*'])()
  }
  function push(url) {
    history.pushState(null, '', url) // 只改 URL，不会触发 popstate
    render() // 所以要自己更新视图
  }
  window.addEventListener('popstate', render) // 前进、后退时触发

  // 用事件委托拦截站内链接的点击
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a')
    if (!a || a.origin !== location.origin || a.target === '_blank') return
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return // 保留新标签页打开等默认行为
    e.preventDefault()
    push(a.href)
  })

  render()
  return { push }
}
```

## 面试官可能追问

::: details 为什么 history 模式下刷新页面会 404？
站内跳转时，URL 是 `pushState` 改的，浏览器并没有请求服务器。刷新或直接打开 `/user/1` 时，浏览器会真的去请求这个路径，而服务器上只有 `index.html` 和静态资源，没有 `/user/1` 这个文件，就返回 404。解决办法是服务端配置回退：找不到文件时返回 `index.html`，再由前端路由根据路径渲染。
:::

::: details hash 模式对 SEO 有什么影响？
`#` 后面的内容不会发给服务器，对服务器来说所有页面都是同一个 URL，没法针对不同路由做服务端渲染，返回不同的标题和描述。搜索引擎一般也会忽略 URL 中 `#` 后面的部分，容易把它们当成同一个页面。需要 SEO 的站点应该用 history 模式，配合服务端渲染或预渲染。
:::

::: details history 模式下怎样拦截所有站内链接的点击？
在 `document` 上监听 `click`，利用[事件委托](/basics/browser/04-event-delegation)找到被点击的 `<a>`。跳过外部链接、`target="_blank"` 的链接，以及按住 Ctrl、Cmd、Shift 的点击（用户想在新标签页或新窗口打开），其余的调用 `preventDefault()` 阻止整页跳转，再 `pushState` 并渲染。Vue Router 不会拦截普通的 `<a>`，它的 `<RouterLink>` 在点击时做了这些判断，再调用 `router.push`。
:::

## 易错点

- `pushState` / `replaceState` 不会触发 `popstate`，前进、后退时才会触发
- history 模式必须配置服务端回退，否则刷新 404；配置回退后，不存在的路径也返回 200，要由前端渲染 404 页面
- hash 模式下 `#` 后面的内容不会发送给服务器
