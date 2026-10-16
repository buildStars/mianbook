---
difficulty: 2
tags: [手写题, 原理]
---

# 手写一个简易的虚拟 DOM：h 函数和 render 怎么实现？

::: tip 一句话回答
虚拟 DOM 就是用普通对象 `{ type, props, children }` 描述 DOM 结构。**h 函数**创建 vnode，同时规范化 children：拍平嵌套数组，去掉 null 和布尔值，把字符串、数字转成文本节点。**render** 第一次调用时递归创建真实 DOM，设置属性、class、style，把 `onXxx` 转成 `addEventListener`；之后再调用就走 **patch**：类型不同直接替换，类型相同就复用 DOM 元素，只更新变化的属性，再按下标逐个比较子节点。真正的框架会用 key 识别节点，做更复杂的 diff。
:::

## 详细解析

### vnode 的结构

- `type`：标签名，如 `'div'`；文本节点用一个特殊标记；组件是一个函数
- `props`：属性、class、style 和事件，统一放在一个对象里
- `children`：规范化之后的 vnode 数组，后面的代码不用再判断"是字符串还是数组"
- `el`：挂载后指向对应的真实 DOM。patch 时新 vnode 从旧 vnode 继承它，才知道要改哪个元素

整个流程分三步：h 生成 vnode 树；第一次 render 把整棵树递归创建成真实 DOM；状态变化后重新调用 h 得到新树，render 用 patch 对比新旧两棵树，只把差异应用到 DOM 上。

### props 怎么落到 DOM 上

| props 里的键 | 处理方式 |
| --- | --- |
| `onClick` 这类 on 加大写字母开头的 | 去掉 on 再转小写得到事件名，用 `addEventListener` 绑定；更新时先移除旧的回调 |
| `class` | 设置 `el.className`（SVG 元素的 className 不是字符串，要用 `setAttribute('class')`）。Vue 还支持数组和对象写法，先拼成字符串再设置 |
| `style` | 对象写法逐个设置 `el.style[name]`；旧样式里有、新样式里没有的要清空 |
| `value`、`checked` | 直接设置 DOM 属性（property）。`setAttribute('value')` 改的只是默认值，用户输入过之后就不起作用了 |
| 其他 | `setAttribute`；值为 null 或 false 时 `removeAttribute`，为 true 时设成空字符串（如 `disabled`） |

## 代码示例：手写 h、render 和 patch

```js
const TEXT = Symbol('text') // 文本节点的 type
function h(type, props, ...children) {
  // 规范化 children：拍平嵌套数组，去掉 null、undefined 和布尔值，字符串和数字转成文本 vnode
  const normalized = children.flat(Infinity)
    .filter((c) => c != null && typeof c !== 'boolean')
    .map((c) => (typeof c === 'object' ? c : { type: TEXT, text: String(c) }))
  return { type, props: props ?? {}, children: normalized, el: null }
}

function setProp(el, key, next, prev) {
  if (/^on[A-Z]/.test(key)) {
    const event = key.slice(2).toLowerCase() // onClick → click
    if (prev) el.removeEventListener(event, prev)
    if (next) el.addEventListener(event, next)
  } else if (key === 'class') {
    el.className = next ?? ''
  } else if (key === 'style') {
    for (const name in prev ?? {}) if (!(name in (next ?? {}))) el.style[name] = '' // 清掉新样式里没有的
    for (const name in next ?? {}) el.style[name] = next[name]
  } else if (key === 'value' || key === 'checked') {
    el[key] = next
  } else if (next == null || next === false) {
    el.removeAttribute(key)
  } else {
    el.setAttribute(key, next === true ? '' : next)
  }
}

// vnode → 真实 DOM：递归创建子节点，并把 DOM 记到 vnode.el 上
function createEl(vnode) {
  if (vnode.type === TEXT) return (vnode.el = document.createTextNode(vnode.text))
  const el = (vnode.el = document.createElement(vnode.type))
  for (const key in vnode.props) setProp(el, key, vnode.props[key], null)
  for (const child of vnode.children) el.appendChild(createEl(child))
  return el
}

function patch(oldVNode, newVNode) {
  // 类型不同：不再比较子节点，直接用新节点替换
  if (oldVNode.type !== newVNode.type) return oldVNode.el.replaceWith(createEl(newVNode))
  const el = (newVNode.el = oldVNode.el) // 类型相同：复用真实 DOM
  if (newVNode.type === TEXT) {
    if (newVNode.text !== oldVNode.text) el.nodeValue = newVNode.text
    return
  }
  // 更新属性：变化的重新设置，新 props 里没有的移除
  const { props: oldProps, children: oldCh } = oldVNode
  const { props: newProps, children: newCh } = newVNode
  for (const key in newProps) if (newProps[key] !== oldProps[key]) setProp(el, key, newProps[key], oldProps[key])
  for (const key in oldProps) if (!(key in newProps)) setProp(el, key, null, oldProps[key])
  // 子节点按下标比较：公共部分递归 patch，新的多出来就追加，旧的多出来就删除
  const common = Math.min(oldCh.length, newCh.length)
  for (let i = 0; i < common; i++) patch(oldCh[i], newCh[i])
  for (let i = common; i < newCh.length; i++) el.appendChild(createEl(newCh[i]))
  for (let i = common; i < oldCh.length; i++) oldCh[i].el.remove()
}

// 第一次调用时挂载，之后都走 patch；上一次的 vnode 记在容器上
function render(vnode, container) {
  if (container._vnode) patch(container._vnode, vnode)
  else container.appendChild(createEl(vnode))
  container._vnode = vnode
}
```

### 用法

页面里放一个 `<div id="app"></div>`，在它后面的 `<script>` 标签里放上面的代码和下面这段，打开页面就能点按钮看到效果：

```js
let count = 0
const app = document.getElementById('app')
function update() {
  const vnode = h('div', { class: count % 2 ? 'counter odd' : 'counter', style: { color: count > 2 ? 'red' : 'black' } },
    h('p', null, '点击次数：', count),
    h('button', { onClick: () => { count++; update() } }, '+1'),
    count > 2 && h('span', null, '超过 2 次了'), // false 会被 h 过滤掉
    h('ul', null, Array.from({ length: count }, (_, i) => h('li', null, `第 ${i + 1} 项`))),
  )
  render(vnode, app) // 每次都生成完整的新树，由 patch 找出差异
}
update()
```

## 面试官可能追问

::: details 按下标比较子节点有什么问题？真正的框架怎么做？
中间插入或删除一项，后面的节点就全部错位。上面的例子第 3 次点击时，span 出现在 ul 原来的位置，按下标比较会把 ul 替换成 span，再整棵重新创建一个 ul；在列表头部插入一项也一样，每个位置都要更新，输入框这类自带状态的元素还会把状态错位到别的项上。框架的做法：给子节点加 key，按 key 找到可以复用的旧节点，只移动、新增、删除必要的节点，算法见 [Vue 3 的 diff 算法](/basics/vue/07-vdom-diff)；条件渲染的位置留一个占位（Vue 的 v-if 会留一个注释节点），让兄弟节点的位置保持稳定。
:::

::: details 怎么支持函数组件？
组件就是一个接收 props、返回 vnode 的函数。在 createEl 和 patch 里加一个分支：`type` 是函数时，先调用 `type(props)` 得到它渲染的子树，把子树存在 vnode 上，再对子树执行原来的创建或 patch 逻辑。真正的框架还要为组件维护实例、状态和生命周期，并且只在组件依赖的数据变化时才重新执行它。
:::

::: details 每次渲染都会创建新的事件回调，会不会反复解绑和绑定？
会。上面的写法里，`onClick` 每次都是新的箭头函数，patch 时新旧回调总是不相等，于是先 `removeEventListener` 再 `addEventListener`。Vue 的优化是给每个事件只绑定一次一个固定的调用函数（invoker），真正的回调存在它身上，更新时只替换这个引用，不再操作 DOM 事件。
:::

## 易错点

- patch 时一定要把旧 vnode 的 `el` 交给新 vnode，否则下一次 patch 找不到要修改的 DOM
- 删除属性容易漏：旧 props 有、新 props 没有的键要移除，事件要 `removeEventListener`，style 里多余的样式要清空
- 条件渲染 `count > 2 && h(...)` 会产生 false，h 要把布尔值过滤掉；但数字 0 是有效内容，会渲染成文本 "0"
- 类型不同就整个替换，旧节点下的子树不会被复用，即使它们的内容完全一样
