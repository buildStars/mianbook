---
difficulty: 2
tags: [实践, 高频]
---

# 移动端 H5 有哪些常见的兼容问题？怎么处理？

::: tip 一句话回答
高频的几类：**刘海屏和底部横条**遮挡内容，用 `viewport-fit=cover` 配合 `env(safe-area-inset-*)` 留出安全区域；**软键盘弹起**挡住输入框或让吸底栏错位，监听 `visualViewport` 拿到真实可视区域再调整；**弹层滚动穿透**，用 `overscroll-behavior: contain` 并锁住背景页面；**`100vh` 包含了地址栏**导致底部被遮，改用 `dvh`、`svh`；**iOS 输入框字号小于 16px** 聚焦时页面被放大；用 `overscroll-behavior` 控制回弹和下拉刷新。点击的 300ms 延迟在设置了 `width=device-width` 后已经不存在了。
:::

## 详细解析

### 安全区域：刘海屏和底部横条

viewport 里加上 `viewport-fit=cover`，页面才会铺满整个屏幕，`env(safe-area-inset-*)` 才有非零值。吸顶、吸底的元素把安全距离加进内边距；用 `max()` 可以保证在没有安全区域的设备上也有基础间距。viewport 的完整写法见 [常用的 meta 标签](/basics/html/03-meta)，1px 和整体适配方案见 [移动端适配](/basics/css/12-mobile-adapt)。

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

```css
.tab-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  /* 至少 8px，有底部横条时用安全距离 */
  padding-bottom: max(8px, env(safe-area-inset-bottom));
}
```

### 软键盘弹起遮挡输入框

键盘弹出时，多数移动浏览器默认只缩小**可视视口**，布局视口不变，所以 `position: fixed; bottom: 0` 的输入栏可能被键盘盖住，或者随页面滚动错位。`window.visualViewport` 反映真实可见的区域，监听它的 `resize` 和 `scroll` 就能算出被挡住的高度。聚焦时再把输入框滚进可见区域。各浏览器、各 App 内 WebView 的表现差别很大，要在真机上验证。

```js
const vv = window.visualViewport
const bar = document.querySelector('.input-bar') // position: fixed; bottom: 0

function followKeyboard() {
  // 布局视口高度 - 可视区域的底边位置 = 被键盘挡住的高度
  const covered = document.documentElement.clientHeight - (vv.offsetTop + vv.height)
  bar.style.transform = `translateY(${-Math.max(0, covered)}px)`
}

if (vv) {
  vv.addEventListener('resize', followKeyboard)
  vv.addEventListener('scroll', followKeyboard)
}

document.addEventListener('focusin', (e) => {
  if (e.target.matches('input, textarea')) {
    // 等键盘弹出、视口尺寸变化后再滚动
    setTimeout(() => e.target.scrollIntoView({ block: 'center' }), 300)
  }
})
```

### 弹层的滚动穿透

弹层里的列表滚到底后继续滑，背后的页面跟着滚，这叫滚动链。弹层的滚动区域加 `overscroll-behavior: contain` 截断滚动链，遮罩加 `touch-action: none` 不响应滑动。部分 iOS 版本上只给 `body` 设 `overflow: hidden` 挡不住触摸滚动，更稳的做法是把 `body` 固定住，关闭时恢复滚动位置。

```css
.modal-body {
  max-height: 60vh;
  overflow-y: auto;
  overscroll-behavior: contain; /* 滚到边界后不再带动背后的页面 */
}
.mask {
  touch-action: none; /* 在遮罩上滑动不触发滚动 */
}
```

```js
let savedY = 0
function lockScroll() {
  savedY = window.scrollY
  Object.assign(document.body.style, { position: 'fixed', top: `-${savedY}px`, left: '0', right: '0' })
}
function unlockScroll() {
  Object.assign(document.body.style, { position: '', top: '', left: '', right: '' })
  window.scrollTo(0, savedY) // 不恢复的话，关闭弹层后页面会跳回顶部
}
```

### 视口高度：100vh 和 dvh、svh

移动浏览器的地址栏会随滚动伸缩，`100vh` 通常按地址栏收起时的最大高度计算，页面刚打开时底部会被遮住一截。新的视口单位把几种情况分开：`svh` 按地址栏展开时的最小高度，`lvh` 按收起时的最大高度，`dvh` 随地址栏实时变化。

```css
.page {
  height: 100vh; /* 不支持新单位时的回退 */
  height: 100dvh; /* 始终等于当前可见高度 */
}
.hero {
  min-height: 100svh; /* 首屏不会被地址栏遮住，滚动时也不会跳动 */
}
```

### 输入框放大、回弹和下拉刷新

- **iOS 聚焦放大**：输入框计算后的字号小于 16px 时，iOS Safari 聚焦会自动放大页面。把 `input`、`textarea`、`select` 的字号设为 16px 及以上。不要用 `user-scalable=no` 禁止缩放，会影响需要放大阅读的用户，而且 iOS Safari 默认会忽略它
- **回弹和下拉刷新**：滚到页面顶部继续下拉，安卓 Chrome 会触发下拉刷新，自己实现了下拉刷新的页面要关掉它；`contain` 只阻止滚动链和下拉刷新，`none` 连回弹效果也去掉

```css
input,
textarea,
select {
  font-size: 16px;
}
body {
  overscroll-behavior-y: contain; /* 关闭浏览器的下拉刷新，保留边界效果 */
}
```

## 面试官可能追问

::: details 点击的 300ms 延迟现在还要处理吗？
基本不用了。早期移动浏览器要等 300ms 判断是不是双击缩放，所以 `click` 会延迟。现在只要 viewport 设置了 `width=device-width`，主流浏览器都不再延迟；还可以给元素加 `touch-action: manipulation` 明确禁用双击缩放。FastClick 这类库在新项目里不需要引入了。
:::

::: details 安卓和 iOS 键盘弹出的表现有什么不同？
iOS Safari 只缩小可视视口，页面可能被整体往上推，`fixed` 元素容易错位。安卓 Chrome 现在默认也只缩小可视视口，和 iOS 对齐；如果希望键盘直接缩小布局视口，让 `fixed` 吸底元素自然出现在键盘上方，可以在 viewport 里加 `interactive-widget=resizes-content`，但这个设置并非所有浏览器都支持，iOS 上不生效。App 内嵌的 WebView 还受原生配置影响（比如安卓窗口的软键盘模式），同一个页面在不同 App 里表现可能不同。
:::

::: details 移动端 H5 怎么调试？
安卓用 USB 连接电脑，在 Chrome 打开 `chrome://inspect` 调试手机上的页面和开启了调试的 WebView；iOS 用 Mac 上 Safari 的开发菜单连接设备。没有电脑时，在页面里接入 vConsole、eruda 看日志和网络请求。还可以用 Whistle、Charles 这类代理工具抓包，把线上资源映射到本地。
:::

## 易错点

- 没有设置 `viewport-fit=cover` 时，`env(safe-area-inset-*)` 通常是 0，写了也看不出效果
- 锁定滚动用 `position: fixed` 时要记录并恢复 `scrollY`，否则关闭弹层后页面会跳回顶部
- `dvh` 会随地址栏实时变化，用作首屏高度时滚动过程中布局会跳动，不需要实时变化的场景用 `svh` 更稳
