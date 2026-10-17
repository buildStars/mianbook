---
difficulty: 2
tags: [实践]
---

# 单页应用的焦点怎么管理？键盘用户怎么正常使用页面？

::: tip 一句话回答
键盘和读屏用户靠**焦点**定位自己在页面的哪里。单页应用切换路由时页面没有真正刷新，焦点会留在已经被移除的链接上，或者掉回 `body`，读屏也不会播报新页面。要做的是：路由切换后把焦点移到新内容的标题或主区域；用 `tabindex="0"` 让自定义控件可聚焦，用 `tabindex="-1"` 让元素只能被脚本聚焦；用 `:focus-visible` 显示焦点样式；弹窗打开时**困住焦点**，关闭后**把焦点还给**触发它的按钮。
:::

## 详细解析

### tabindex 的三种取值

| 取值 | 能用 Tab 键到达 | 能被 `focus()` 聚焦 | 用途 |
| --- | --- | --- | --- |
| 不写（原生可交互元素） | 能 | 能 | `button`、`a[href]`、`input` 等，优先用它们 |
| `0` | 能，按 DOM 顺序 | 能 | 自定义控件，比如用 `div` 做的标签页 |
| `-1` | 不能 | 能 | 路由切换后的标题、弹窗容器等程序跳转的目标 |
| 正数 | 能，并排到最前 | 能 | 不要用，会打乱整页的 Tab 顺序 |

用 `div` 加 `tabindex="0"` 模拟按钮时，还要自己处理 Enter、Space 和 `role`，所以能用原生元素就用原生元素。ARIA 的整体用法见 [可访问性和 ARIA](/basics/html/04-a11y-aria)。

### 路由切换后的焦点

传统多页应用每次跳转，焦点回到文档开头，读屏会播报新页面标题。单页应用要自己模拟：

1. 路由切换、内容渲染完成后，把焦点移到新页面的 `h1`（加 `tabindex="-1"`）或主内容区
2. 同步更新 `document.title`
3. 必要时用 `aria-live` 区域播报"已进入订单页"

移到标题而不是页面顶部，是为了让用户不用再穿过一遍导航菜单。路由实现本身见 [前端路由](/basics/browser/18-frontend-routing)。

### 跳到主内容链接

页面第一个可聚焦元素放一个"跳到主内容"链接，平时视觉隐藏，获得焦点时显示。键盘用户按一次 Tab 就能跳过头部导航，不用每页都按十几次。

```html
<a class="skip-link" href="#main">跳到主内容</a>
<header>……导航……</header>
<main id="main" tabindex="-1">……</main>
```

### :focus-visible

很多项目为了"鼠标点完有个框不好看"写 `outline: none`，键盘用户就看不到焦点在哪了。`:focus-visible` 由浏览器判断是否需要显示焦点指示：键盘操作时匹配，鼠标点击按钮时通常不匹配。

```css
button:focus { outline: none; }
button:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
```

### 弹窗：焦点陷阱和归还

- 打开时：记住当前焦点元素，把焦点移进弹窗（第一个控件或标题）
- 打开期间：Tab 和 Shift+Tab 只在弹窗内循环，背景内容不可聚焦，也不被读屏读到
- 关闭时：Esc 可以关闭，焦点回到打开它的按钮，否则用户会被丢回页面开头

原生 `dialog` 的 `showModal()` 会把背景设为 inert，并自动处理 Esc 和初始焦点，关闭后浏览器也会尝试恢复焦点，见 [dialog 和 popover](/basics/html/09-dialog-popover)。自己写弹窗时，可以给背景容器加 `inert` 属性，比手写 Tab 拦截可靠。

### roving tabindex

标签页、工具栏、菜单这类组件，期望是 Tab 进入组件、方向键在内部移动、再按 Tab 离开。做法是同一时刻只有当前项 `tabindex="0"`，其余都是 `-1`；方向键移动时交换 tabindex 并调用 `focus()`。

```js
function onKeydown(e, items) {
  const i = items.indexOf(document.activeElement)
  const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
  if (step === undefined || i === -1) return
  e.preventDefault()
  const next = items[(i + step + items.length) % items.length]
  items.forEach((el) => (el.tabIndex = el === next ? 0 : -1))
  next.focus()
}
```

## 面试官可能追问

::: details 列表删除一项后，焦点应该去哪？
被删除元素上的焦点会掉回 `body`。合理的做法是把焦点移到下一项，没有下一项就移到上一项，列表空了就移到列表标题或"新增"按钮，并用 live region 播报"已删除"。
:::

::: details 怎么检查一个页面的键盘可用性？
拔掉鼠标，只用 Tab、Shift+Tab、Enter、Space、Esc、方向键走完核心流程：每一步都能看到焦点在哪，顺序符合视觉顺序，没有到不了的控件，也没有出不去的区域。再配合读屏软件和自动化检查工具（如 axe）补漏。
:::

::: details 焦点陷阱会不会把用户困死？
会，所以陷阱只用在模态弹窗这类必须先处理完的场景，并且一定要有出口：Esc 关闭、关闭按钮可聚焦。非模态的浮层、下拉菜单不应该困住焦点，失焦或按 Esc 时直接关闭。
:::

## 易错点

- 全局写 `*:focus { outline: none }`，又没有用 `:focus-visible` 补上样式
- 用正数 tabindex 调整顺序，结果整页 Tab 顺序错乱。应该调整 DOM 顺序
- 弹窗关闭后不归还焦点，键盘用户回到页面开头
- 路由切换只更新了内容，没有移动焦点和更新标题，读屏用户不知道页面变了
