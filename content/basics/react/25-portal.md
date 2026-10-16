---
difficulty: 2
tags: [原理, 实践]
---

# React 的 Portal 是什么？用 Portal 渲染的组件事件怎么冒泡？

::: tip 一句话回答
Portal 用 **`createPortal(children, domNode)`** 把子节点渲染到组件树之外的某个 DOM 节点，常用于弹窗、Tooltip、下拉菜单，用来摆脱父元素的 `overflow: hidden` 和层叠上下文限制。它在 DOM 上挪了位置，但在 **React 树上仍是原来父组件的子节点**：Context 照常可用，事件也**按 React 树冒泡**，弹窗里的点击会触发外层 React 父组件的 onClick。
:::

## 详细解析

### 为什么需要 Portal

弹窗写在业务组件内部最自然，状态和逻辑都在一起。但它的 DOM 如果也在组件内部，会遇到：

- 祖先元素有 `overflow: hidden`，弹窗被裁掉
- 祖先形成了层叠上下文（比如有 `transform`、`opacity` 小于 1），弹窗的 `z-index` 再大也盖不过外面的元素，见 [z-index 为什么不生效](/basics/css/07-position-zindex)
- 祖先有 `transform` 时，`position: fixed` 会相对这个祖先定位，而不是视口

Portal 让组件"逻辑上留在原地，DOM 上挂到 body 下"。

### 基本用法

```jsx
import { createPortal } from 'react-dom'

function Modal({ open, onClose, children }) {
  if (!open) return null
  return createPortal(
    <div className="mask" onClick={onClose}>
      {/* 阻止点击内容区时关闭 */}
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  )
}
```

目标节点也可以是页面里专门准备的 `<div id="modal-root">`。SSR 时服务端没有 `document`，要等客户端挂载后再渲染 Portal。

### 事件按 React 树冒泡

```jsx
function Card() {
  return (
    <div onClick={() => console.log('Card 收到点击')}>
      <Modal open>
        <button>确定</button>
      </Modal>
    </div>
  )
}
```

点击"确定"会打印"Card 收到点击"，尽管 DOM 上按钮在 body 下、不在 Card 的 div 里。原因是 React 的合成事件在根容器上统一监听，触发后沿着 **Fiber 树**收集各层的处理函数，而 Portal 在 Fiber 树里就是 Card 的后代。合成事件的整体机制见 [合成事件](/basics/react/20-synthetic-event)。

同理，Portal 内部可以读到外层 Provider 提供的 Context。

### 带来的坑

- 外层"点击空白处关闭"的逻辑，如果用 React 的 onClick 判断，弹窗内的点击也会冒上来，需要 stopPropagation 或判断来源
- 反过来，用原生 `document.addEventListener` 监听时，判断 `ref.current.contains(e.target)` 会认为弹窗不在组件内，因为原生事件走的是 DOM 树

## 面试官可能追问

::: details 不想让 Portal 里的事件冒泡到外层怎么办？
在 Portal 的根元素上 `onClick={(e) => e.stopPropagation()}`，阻止合成事件继续沿 React 树冒泡。只对需要的事件处理，不要一刀切，否则外层依赖冒泡的逻辑（如埋点）会失效。
:::

::: details 弹窗除了 Portal 还要处理哪些问题？
焦点管理：打开时把焦点移进弹窗，Tab 键在弹窗内循环，关闭后焦点回到触发按钮；按 Esc 关闭；打开时锁住背景滚动；加 `role="dialog"` 和 `aria-modal`。现在也可以用原生 `<dialog>` 的 `showModal()`，它渲染在顶层（top layer），天然不受层叠上下文影响。
:::

::: details Portal 的组件卸载时 DOM 会被清理吗？
会。Portal 的生命周期跟着 React 树走，父组件卸载时，挂在 body 下的那部分 DOM 也会被移除。但如果目标容器是自己 `createElement` 加到 body 上的，要在清理函数里自己移除容器。
:::

## 易错点

- 以为 Portal 改变了组件层级：它只改了 DOM 位置，React 树、Context、事件冒泡都不变
- 原生事件和合成事件的冒泡路径不同，混用时判断"点击是否在组件内"容易出错
- Portal 解决的是层叠上下文和裁剪问题，弹窗自身仍要设置合适的 `position` 和 `z-index`
