---
difficulty: 2
tags: [新特性, 实践]
---

# 原生的 dialog 和 popover 怎么用？比自己写弹窗好在哪？

::: tip 一句话回答
`<dialog>` 用 **`showModal()`** 打开时是真正的模态框：进入**顶层（top layer）**，页面其他部分变成**惰性**（点不了、聚焦不到，读屏也读不到），按 **Esc** 可以关闭，打开时焦点自动移进弹窗，关闭后回到原来的元素，背景遮罩用 `::backdrop` 设置；`show()` 打开的则是非模态的。`popover` 属性适合菜单、提示这类**非模态浮层**，配合 `popovertarget` 不写 JS 就能开关，默认的 `auto` 模式支持点击外部或按 Esc **轻量关闭**。两者都在顶层渲染，不受父元素 `z-index` 和 `overflow` 的影响。
:::

## 详细解析

### dialog 的基本用法

```html
<button id="delete" type="button">删除</button>

<dialog id="confirm" aria-labelledby="confirm-title">
  <form method="dialog">
    <h2 id="confirm-title">确定删除吗？</h2>
    <p>删除后无法恢复。</p>
    <button value="cancel" autofocus>取消</button>
    <button value="ok">删除</button>
  </form>
</dialog>

<script>
  const dialog = document.getElementById('confirm')
  document.getElementById('delete').addEventListener('click', () => {
    dialog.returnValue = '' // 同一个 dialog 会复用上次的 returnValue，打开前先清空
    dialog.showModal()
  })
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'ok') deleteItem()
  })
</script>
```

- `<form method="dialog">` 提交时不发请求，而是关闭弹窗，并把点击的按钮的 `value` 写进 `dialog.returnValue`
- 也可以用 JS 关闭：`dialog.close('ok')`，参数同样会成为 `returnValue`
- 按 Esc 时先触发 `cancel` 事件，再关闭并触发 `close` 事件。有未保存的内容时，可以在 `cancel` 里调用 `preventDefault()` 阻止关闭。但为了防止页面困住用户，规范做了限制：两次关闭请求之间用户没有点击等其他操作时，第二次的 `cancel` 不能被取消，弹窗照样关闭

| | `show()` | `showModal()` |
| --- | --- | --- |
| 页面其他部分 | 照常可以交互 | 变成惰性，无法点击和聚焦 |
| 渲染位置 | 普通文档流，受 `z-index` 影响 | 顶层，盖在所有内容之上 |
| Esc 关闭 | 默认不会 | 会 |
| `::backdrop` | 没有 | 有，可以设置遮罩颜色、模糊 |
| 读屏 | 非模态对话框 | 隐含 `aria-modal="true"` |

### showModal 自带的焦点处理

- 打开时，焦点移到带 `autofocus` 的元素上；没有的话移到弹窗里第一个可聚焦的元素
- 打开期间，弹窗外的内容都是惰性的，Tab 不会把焦点移到背景页面上
- 关闭后，焦点回到打开之前聚焦的元素，通常就是触发按钮

这些在自己写的弹窗里都要手动实现：焦点陷阱、给背景加 `inert` 或 `aria-hidden`、记住并恢复焦点、监听 Esc。

### popover 属性

```html
<button popovertarget="more-menu">更多</button>
<div id="more-menu" popover>
  <button type="button">编辑</button>
  <button type="button">删除</button>
</div>
```

- **`popover` 或 `popover="auto"`**：点击浮层外部或按 Esc 会自动关闭（轻量关闭）；打开一个 auto 浮层，会关掉其他无关的 auto 浮层，嵌套的子菜单除外
- **`popover="manual"`**：不会轻量关闭，也不会互相关闭，只能通过按钮或 JS 关闭，适合 toast 通知
- **触发按钮**：`<button popovertarget="id">` 默认切换开关，`popovertargetaction` 可以设为 `show`、`hide` 或 `toggle`
- **JS 接口**：`showPopover()`、`hidePopover()`、`togglePopover()`；`:popover-open` 伪类匹配打开状态；`beforetoggle` 和 `toggle` 事件可以监听开关
- **自带的可访问性**：浏览器会自动把触发按钮的展开状态告诉辅助技术，效果相当于 `aria-expanded`，但不会写到 DOM 特性上；打开后 Tab 顺序中浮层紧跟在按钮后面，按 Esc 关闭时焦点回到按钮
- popover 不是模态的：不会让背景变成惰性，也不会困住焦点。默认样式是在视口中居中，要贴着按钮显示，需要自己定位，或者使用 CSS 锚点定位

### 顶层（top layer）

顶层是独立于普通文档之上的一层，进入顶层的元素按打开顺序叠放，总是盖在页面所有内容之上。它们不受祖先元素的 `z-index`、`overflow: hidden`、`transform` 的影响。以前组件库要把弹窗挂到 `body` 下（Vue 的 Teleport、React 的 Portal），就是为了躲开这些问题，详见 [z-index 为什么不生效](/basics/css/07-position-zindex)。

### 兼容性

dialog 和 popover 在较新的主流浏览器中都已经支持。需要兼容老浏览器时，先做特性检测（例如 `'showPopover' in HTMLElement.prototype`），不支持时引入 polyfill 或者降级到原来的弹窗实现。

## 面试官可能追问

::: details 点击遮罩关闭 dialog 怎么实现？
`showModal()` 打开的 dialog 默认点遮罩不会关闭。点在 `::backdrop` 上时，事件的 `target` 是 dialog 元素本身，可以据此判断：`dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close() })`。为了不误判，dialog 本身不要留 padding，内容放在一个内层容器里。部分较新的浏览器还支持 `closedby="any"` 属性，直接开启点外部关闭，用之前要确认目标浏览器的支持情况。
:::

::: details dialog 打开后背景页面还能滚动，怎么处理？
模态 dialog 不会锁定页面滚动。可以用 CSS 处理：`html:has(dialog:modal) { overflow: hidden; }`。`:modal` 只匹配以模态方式打开的 dialog，打开时自动禁止滚动，关闭后恢复，不需要写 JS。
:::

::: details dialog 和 popover 怎么选？
需要用户必须处理才能继续的内容，比如确认删除、填写表单，用 `showModal()` 打开的 dialog。菜单、下拉、提示、工具栏浮层这类用户可以随手忽略的内容，用 popover。非模态、但要一直显示到用户主动关闭的面板，可以用 `show()` 打开的 dialog，或者 `popover="manual"`。
:::

::: details 怎么给 dialog 和 popover 加打开和关闭的动画？
它们关闭时是 `display: none`，普通的 transition 不生效。可以用 `@starting-style` 定义打开前的初始样式，再给 `display` 和 `overlay` 加上 `transition-behavior: allow-discrete`，让元素在退出动画结束后才隐藏、才离开顶层。这几个特性（尤其是 `overlay`）的浏览器支持程度不一，不支持的浏览器会直接显示和隐藏，不影响功能。
:::

## 易错点

- 直接添加 `open` 属性来打开 dialog，得到的是非模态弹窗，没有顶层、遮罩和 Esc 关闭，应该调用 `showModal()`
- 不要给 `<dialog>` 加 `tabindex`，它本身不是可交互元素，焦点应该落在里面的控件上
- 同一个 dialog 反复打开时，`returnValue` 会保留上一次的值，调用不带参数的 `close()` 也不会清空它，打开前要手动重置
- 弹窗里的表单有 `required` 字段时，"取消"按钮也会被校验拦住，要给它加 `formnovalidate`，或者改成 `type="button"` 再调用 `close()`
