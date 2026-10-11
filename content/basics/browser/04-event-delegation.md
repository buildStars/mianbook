---
difficulty: 1
tags: [高频]
---

# 事件流是什么？什么是事件委托？

::: tip 一句话回答
DOM 事件的传播分三个阶段：**捕获**（从 `window` 向下传到目标元素）、**目标阶段**、**冒泡**（从目标元素向上传回 `window`）。**事件委托**就是利用冒泡，把监听器绑在父元素上统一处理子元素的事件，再用 `event.target.closest()` 找到真正要处理的子元素。这样监听器数量少，动态添加的子元素也自动生效。
:::

## 详细解析

### 事件流的三个阶段

以点击页面上的按钮为例，事件先沿着 `window` → `document` → `<html>` → `<body>` → … → 按钮的路径向下传递，在按钮上触发后，再沿原路向上传回 `window`。

`addEventListener` 默认在冒泡阶段触发。第三个参数可以是布尔值 `useCapture`，也可以是选项对象：

- `capture`：为 `true` 时在捕获阶段触发
- `once`：触发一次后自动移除
- `passive`：声明监听器不会调用 `preventDefault()`，见下文
- `signal`：传入 `AbortSignal`，调用 `abort()` 时自动移除监听器

```html
<div id="outer">
  <button id="inner">点我</button>
</div>
```

```js
const outer = document.getElementById('outer')
const inner = document.getElementById('inner')

outer.addEventListener('click', (e) => console.log('outer 捕获', e.eventPhase), true)
outer.addEventListener('click', (e) => console.log('outer 冒泡', e.eventPhase))
inner.addEventListener('click', (e) => console.log('inner', e.eventPhase))
```

点击按钮，依次输出 `outer 捕获 1`、`inner 2`、`outer 冒泡 3`。`eventPhase` 的 1、2、3 分别对应捕获、目标、冒泡阶段。

### target 和 currentTarget

- `event.target`：真正触发事件的元素，上例中始终是按钮
- `event.currentTarget`：当前正在执行的监听器绑定在哪个元素上，上例中 `outer` 的两个监听器里都是 `outer`

### 阻止传播和默认行为

| 方法 | 作用 |
| --- | --- |
| `stopPropagation()` | 阻止事件继续传播到其他元素，当前元素上的其他监听器仍会执行 |
| `stopImmediatePropagation()` | 同样阻止传播，并且当前元素上后续的监听器也不再执行 |
| `preventDefault()` | 阻止默认行为（链接跳转、表单提交、勾选复选框等），不影响传播 |

### 事件委托

```html
<ul id="todo-list">
  <li data-id="1">写周报 <button class="delete-btn">删除</button></li>
  <li data-id="2">修复登录 bug <button class="delete-btn">删除</button></li>
</ul>
```

```js
const list = document.getElementById('todo-list')

list.addEventListener('click', (e) => {
  // 点到的可能是按钮里的子元素（比如图标），用 closest 向上找到按钮本身
  const btn = e.target.closest('.delete-btn')
  // 没找到，或者找到的元素不在列表内，就不处理
  if (!btn || !list.contains(btn)) return

  const item = btn.closest('li')
  console.log('删除', item.dataset.id)
  item.remove()
})

// 后添加的项不用单独绑定监听器，点击删除照样生效
list.insertAdjacentHTML('beforeend', '<li data-id="3">新任务 <button class="delete-btn">删除</button></li>')
```

好处有两个：只需要一个监听器，内存占用少、初始化快；动态增删的子元素不用重新绑定或解绑。

### 不冒泡的事件

`focus` / `blur`、`mouseenter` / `mouseleave`、元素自身的 `scroll` 等事件不会冒泡，没法直接委托。前两组可以改用会冒泡的 `focusin` / `focusout`、`mouseover` / `mouseout`。

### passive 与滚动性能

处理 `touchmove`、`wheel` 这类事件时，如果有非 passive 的监听器，浏览器要先等它执行完，才知道它有没有调用 `preventDefault()` 取消滚动；主线程一忙，滚动就会卡顿。设置 `passive: true` 等于提前声明"不会阻止滚动"，浏览器可以立即开始滚动，不必等监听器执行完（滚动由合成线程处理，见[浏览器的多进程架构](/basics/browser/03-multi-process)）。

```js
el.addEventListener('touchmove', onTouchMove, { passive: true })
```

Chrome 等浏览器对绑定在 `window`、`document`、`<html>`、`<body>` 上的 `touchstart`、`touchmove`、`wheel` 监听默认按 passive 处理（DOM 规范也是这样规定的）。在这些监听器里调用 `preventDefault()` 会被忽略，控制台会给出警告；确实要阻止滚动时，需要显式传入 `{ passive: false }`。

## 面试官可能追问

::: details React 的事件也是委托的吗？
是的。对大部分事件，React 不会在每个 DOM 元素上绑定监听器，而是在顶层统一监听，事件触发后根据 `event.target` 找到对应的组件，模拟捕获和冒泡，依次调用 `onClick` 等处理函数。React 17 之前统一绑在 `document` 上，React 17 起改为绑在渲染的根容器上。这样一个页面里嵌入多个 React 应用、或者和其他技术栈混用时，`stopPropagation()` 的效果更符合预期。
:::

::: details 事件委托有什么局限？
- 不冒泡的事件不能直接委托，要换成会冒泡的替代事件，或者在父元素上用捕获阶段监听（不冒泡的事件同样会经历捕获阶段）
- 中间的元素调用了 `stopPropagation()`，父元素就收不到事件
- 委托的层级太高（比如全都挂在 `document` 上），页面上的每次事件都要执行判断逻辑，`mousemove` 这类高频事件尤其要注意
:::

::: details 如何同时阻止冒泡和默认行为？
分别调用 `e.stopPropagation()` 和 `e.preventDefault()`。`return false` 的效果要看场景：在 `addEventListener` 的监听器里没有任何作用；在 `onclick` 这类事件属性里只相当于 `preventDefault()`；在 jQuery 的事件处理函数里则会同时阻止两者。Vue 中可以直接写 `@click.stop.prevent`。
:::

## 易错点

- 委托时直接比较 `e.target` 容易出错：点到按钮里的图标时，`target` 是图标，要用 `closest()` 向上查找
- `event.currentTarget` 只在事件分发期间有值，在异步回调里读取会得到 `null`
- `preventDefault()` 不会阻止冒泡，`stopPropagation()` 也不会阻止默认行为
