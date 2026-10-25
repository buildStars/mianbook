---
title: 手写虚拟 DOM 的 h 和 render
dom: true
---

## 要求

实现 `h(type, props, ...children)` 和 `render(vnode, container)`。

**h** 返回 vnode：`{ type, props, children }`

- `type` 是标签名，比如 `'div'`
- `props` 没传（null）时是空对象 `{}`
- `children` 要规范化成 vnode 数组：嵌套数组拍平；`null`、`undefined`、`true`、`false` 去掉；字符串和数字转成文本 vnode（结构自己定，数字 0 也要保留）

**render** 第一次在某个 container 上调用时，把 vnode 创建成真实 DOM，追加到 container 里；之后在同一个 container 上再调用，就和上一次的 vnode 比较，只把差异更新到已有的 DOM 上。

props 怎么落到 DOM 上：

- `onClick` 这种 on 加大写字母开头的：去掉 on 再转小写得到事件名，用 `addEventListener` 绑定
- `class`：设置 `className`
- `style`：一个对象，逐个设置 `el.style[name]`
- `value`、`checked`：直接设置 DOM 属性，比如 `el.value = ...`
- 其他：`setAttribute`；值为 true 时设成空字符串，为 null 或 false 时不设置

更新规则：

- 类型不同（标签名不同，或者一个是文本、一个是元素）：用新创建的节点整个替换旧节点
- 类型相同：复用原来的 DOM 节点，文本节点只改内容；变化了的 props 重新设置，旧 props 里有、新 props 里没有的要移除，包括事件回调和 style 里多出来的样式
- 子节点按下标逐个比较：新的多出来的追加到末尾，旧的多出来的删除

## 提示

- 文本 vnode 用一个特殊的 type 标记，比如 `Symbol('text')`；把 vnode 对应的真实 DOM 记在 `vnode.el` 上，上一次 render 的 vnode 记在 container 上
- 写一个 `setProp(el, key, next, prev)` 统一处理新增、更新和删除：`next` 为 null 表示删除；事件和 style 要拿 `prev` 移除旧的回调、清掉多出来的样式
- patch 时先让新 vnode 接过旧 vnode 的 `el`，否则下一次更新找不到要修改的 DOM；类型不同时用 `el.replaceWith(新节点)`
- 子节点：公共长度以内递归 patch，新的多出来的 `appendChild`，旧的多出来的用它的 `el.remove()` 删掉

## 起始代码

```js
function h(type, props, ...children) {
  // 返回 { type, props, children }
}

function render(vnode, container) {
  // 第一次挂载；之后和上一次的 vnode 比较，只更新变化的部分
}
```

## 测试

```js
test('h 返回 { type, props, children }，children 规范化成 vnode 数组', () => {
  const vnode = h('ul', null, 'a', [h('li', null, 'b'), ['c', null]], undefined, false, true, 0)
  expect(vnode.type).toBe('ul')
  expect(vnode.props).toEqual({})
  expect(vnode.children).toHaveLength(4) // 'a'、li、'c'、0
  expect(vnode.children[1].type).toBe('li')
  expect(vnode.children.map((c) => typeof c)).toEqual(['object', 'object', 'object', 'object'])
  expect(h('div', { id: 'x' }).props).toEqual({ id: 'x' })
})

test('第一次 render 创建真实 DOM，追加到容器里', () => {
  const container = document.createElement('div')
  render(h('div', { id: 'box', class: 'card' }, h('span', null, '你好'), ' 数字：', 0), container)
  expect(container.childNodes.length).toBe(1)
  const div = container.firstChild
  expect(div.tagName).toBe('DIV')
  expect(div.id).toBe('box')
  expect(div.className).toBe('card')
  expect(div.childNodes.length).toBe(3) // span 和两个文本节点
  expect(div.innerHTML).toBe('<span>你好</span> 数字：0')
})

test('onClick 这类 props 绑定成事件', () => {
  const container = document.createElement('div')
  const onClick = fn()
  render(h('button', { onClick }, '点我'), container)
  const button = container.firstChild
  button.click()
  button.click()
  expect(onClick).toHaveBeenCalledTimes(2)
  expect(onClick.calls[0][0].type).toBe('click')
  expect(button.hasAttribute('onclick')).toBe(false)
})

test('style 逐个设置；属性值为 true 时设成空字符串，null 和 false 不设置', () => {
  const container = document.createElement('div')
  render(h('div', { style: { color: 'red', fontSize: '12px' }, hidden: true, title: null, 'data-x': false, 'aria-label': '标签' }), container)
  const div = container.firstChild
  expect(div.style.color).toBe('red')
  expect(div.style.fontSize).toBe('12px')
  expect(div.getAttribute('hidden')).toBe('')
  expect(div.hasAttribute('title')).toBe(false)
  expect(div.hasAttribute('data-x')).toBe(false)
  expect(div.getAttribute('aria-label')).toBe('标签')
})

test('再次 render 时复用原来的 DOM，只更新变化的部分', () => {
  const container = document.createElement('div')
  render(h('div', { class: 'a' }, h('p', null, '旧文字'), h('input', { value: '旧值' })), container)
  const div = container.firstChild
  const [p, input] = div.children
  input.value = '用户输入' // 模拟用户在输入框里输入过
  render(h('div', { class: 'b' }, h('p', null, '新文字'), h('input', { value: '新值' })), container)
  expect(container.childNodes.length).toBe(1)
  expect(container.firstChild).toBe(div) // 还是原来那个元素，不是新建的
  expect(div.children[0]).toBe(p)
  expect(div.children[1]).toBe(input)
  expect(div.className).toBe('b')
  expect(p.textContent).toBe('新文字')
  expect(input.value).toBe('新值')
})

test('更新时移除旧的属性、样式和事件回调', () => {
  const container = document.createElement('div')
  const oldClick = fn()
  const newClick = fn()
  render(h('button', { title: '提示', style: { color: 'red', fontSize: '12px' }, onClick: oldClick }, '按钮'), container)
  const button = container.firstChild
  render(h('button', { style: { color: 'blue' }, onClick: newClick }, '按钮'), container)
  expect(button.hasAttribute('title')).toBe(false)
  expect(button.style.color).toBe('blue')
  expect(button.style.fontSize).toBe('')
  button.click()
  expect(oldClick).toHaveBeenCalledTimes(0)
  expect(newClick).toHaveBeenCalledTimes(1)
  render(h('button', null, '按钮'), container)
  button.click()
  expect(newClick).toHaveBeenCalledTimes(1)
  expect(button.style.color).toBe('')
})

test('子节点按下标比较：多出来的追加，少了的删除，可以连续更新', () => {
  const container = document.createElement('div')
  const list = (n) => h('ul', null, Array.from({ length: n }, (_, i) => h('li', null, `第 ${i + 1} 项`)))
  render(list(2), container)
  const ul = container.firstChild
  const first = ul.firstChild
  render(list(4), container)
  expect(ul.children.length).toBe(4)
  expect(ul.firstChild).toBe(first)
  expect(ul.lastChild.textContent).toBe('第 4 项')
  render(list(1), container)
  expect(ul.children.length).toBe(1)
  expect(ul.firstChild).toBe(first)
  expect(ul.textContent).toBe('第 1 项')
  render(list(3), container)
  expect(ul.textContent).toBe('第 1 项第 2 项第 3 项')
})

test('类型不同时用新节点整个替换旧节点', () => {
  const container = document.createElement('div')
  render(h('div', null, h('p', null, '段落'), '文字'), container)
  const div = container.firstChild
  const p = div.firstChild
  render(h('div', null, h('span', null, '段落'), h('b', null, '加粗')), container)
  expect(container.firstChild).toBe(div) // 根节点类型没变，要复用原来的元素
  expect(div.innerHTML).toBe('<span>段落</span><b>加粗</b>')
  expect(p.parentNode).toBeNull()
  render(h('section', null, '新的根节点'), container)
  expect(container.innerHTML).toBe('<section>新的根节点</section>')
  render(h('section', null, '再更新一次'), container)
  expect(container.innerHTML).toBe('<section>再更新一次</section>')
})
```

## 参考答案

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
