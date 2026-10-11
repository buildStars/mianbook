---
difficulty: 2
tags: [原理, 输出题]
---

# React 的合成事件是什么？和原生事件有什么区别？

::: tip 一句话回答
React 不给每个元素单独绑定监听，而是用**事件委托**：在**根容器**上为大多数事件统一注册捕获和冒泡两个监听器（React 17 起从 `document` 改为根容器），事件冒泡到根容器时，React 根据 `event.target` 找到对应的 Fiber，沿组件树收集 `onClick`、`onClickCapture` 等处理函数，用包装后的**合成事件对象**依次调用。合成事件抹平了浏览器差异，接口和原生事件一致，`e.nativeEvent` 可以拿到原生事件。和原生事件混用时要注意顺序：直接绑定在元素上的原生监听器**先于** React 的冒泡处理函数执行，React 里调用 `e.stopPropagation()` 挡不住已经执行过的原生监听器。React 17 起移除了事件池，异步读取事件对象不再有问题。
:::

## 详细解析

### 事件委托到根容器

```text
document
  └─ #root（createRoot 的容器）  ← React 在这里为 click 注册捕获和冒泡监听
       └─ div (onClick)
            └─ button (onClick)   ← 实际点击的元素
```

点击 button 时，原生事件冒泡到 #root，React 的监听器被触发：

1. 根据 `nativeEvent.target` 找到 button 对应的 Fiber
2. 从这个 Fiber 沿 `return` 向上收集 `onClick`，得到 `[button.onClick, div.onClick]`
3. 创建合成事件对象，依次调用；某个处理函数调用了 `e.stopPropagation()` 就停止

捕获阶段同理，onClickCapture 在根容器的捕获监听器中按从外到内的顺序执行。事件委托本身的原理见 [事件委托](/basics/browser/04-event-delegation)。

React 17 把委托目标从 `document` 改为根容器，原因是页面上有多个 React 应用（或新旧版本共存、微前端）时，大家都挂在 document 上会互相干扰：一个应用调用 stopPropagation，另一个应用照样收到事件。

### 合成事件和原生事件的差异

| | 合成事件 | 原生事件 |
| --- | --- | --- |
| 绑定方式 | JSX 属性，如 `onClick`，驼峰命名 | `addEventListener('click', ...)` |
| 绑定位置 | 统一委托到根容器 | 绑定在元素本身 |
| 阻止默认行为 | 必须调用 `e.preventDefault()`，return false 无效 | 也可以在 `onclick` 这类事件处理属性（HTML 属性或 `el.onclick`）中 return false，addEventListener 中无效 |
| 传播路径 | 沿 React 组件树，Portal 中的事件会冒泡到 React 父组件 | 沿 DOM 树 |

一些具体差异：

- **onChange**：输入框的 onChange 在每次输入时触发，相当于原生的 `input` 事件，而不是失焦时才触发的原生 change
- **onFocus / onBlur**：React 17 起基于原生的 focusin / focusout，会冒泡
- **onScroll**：React 17 起不再冒泡，和浏览器一致
- **onMouseEnter / onMouseLeave**：没有冒泡，React 从离开的元素到进入的元素计算触发
- `e.currentTarget` 是当前处理函数所在的元素，和 `e.nativeEvent.currentTarget`（React 处理时一般是根容器）不一定相同

### 事件池的移除

React 16 及以前会复用合成事件对象（事件池），处理函数执行完后对象的属性会被清空，在 setTimeout、Promise 中读取 `e.target` 会得到 null，需要先调用 `e.persist()`。React 17 移除了事件池，异步读取没有问题，`e.persist()` 保留但不再有作用。

## 代码示例：混用时的执行顺序

```jsx
function Demo() {
  const buttonRef = useRef(null)

  useEffect(() => {
    const button = buttonRef.current
    const onNative = () => console.log('原生 button 冒泡')
    const onDoc = () => console.log('原生 document 冒泡')
    button.addEventListener('click', onNative)
    document.addEventListener('click', onDoc)
    return () => {
      button.removeEventListener('click', onNative)
      document.removeEventListener('click', onDoc)
    }
  }, [])

  return (
    <div onClick={() => console.log('React div onClick')} onClickCapture={() => console.log('React div onClickCapture')}>
      <button ref={buttonRef} onClick={() => console.log('React button onClick')}>
        点击
      </button>
    </div>
  )
}

// 点击按钮的输出：
// React div onClickCapture   ← 根容器的捕获监听器
// 原生 button 冒泡            ← 事件到达目标元素
// React button onClick       ← 冒泡到根容器，React 依次调用
// React div onClick
// 原生 document 冒泡          ← 继续冒泡到 document
```

- 在 React 的 button onClick 中调用 `e.stopPropagation()`：React div onClick 和 document 上的监听器都不再执行，但"原生 button 冒泡"已经执行过了
- 在原生 button 监听器中调用 `e.stopPropagation()`：事件到不了根容器，React 的所有冒泡处理函数（button 和 div 的 onClick）都不执行

## 面试官可能追问

::: details 点击弹窗外部关闭弹窗，在 document 上监听 click，为什么点击弹窗内部也会关闭？
React 17 之前事件委托在 document 上，弹窗内部 onClick 里调用 stopPropagation 只能阻止 React 内部的传播，document 上的原生监听器照样执行。React 17 起委托到根容器，React 处理函数里的 stopPropagation 会同时阻止原生事件继续冒泡到 document，这个问题基本消失。更稳妥的写法是在 document 的回调里判断 `modalRef.current.contains(e.target)`，不依赖阻止冒泡。
:::

::: details Portal 中的事件为什么会冒泡到 React 父组件？
合成事件沿 **React 组件树**传播，而不是 DOM 树。Portal 渲染的节点在 DOM 上挂在 body 下，但在 React 树中仍然是父组件的子节点，所以 Portal 里的点击会触发父组件的 onClick。不希望这样时，在 Portal 的根元素上调用 `e.stopPropagation()`。
:::

::: details 为什么要做合成事件，而不是直接用原生事件？
一是事件委托，只在根容器注册一次监听，减少了监听器数量，动态增删的元素也不用重新绑定；二是抹平浏览器差异，提供统一的事件对象；三是让 React 能控制事件处理的过程，比如按事件类型给其中的状态更新分配优先级（离散事件中的更新优先级更高），见 [Fiber 架构](/basics/react/02-fiber)。
:::

## 易错点

- 以为 React 事件绑定在元素本身上：实际委托在根容器，React 17 之前是 document
- 以为在 React 处理函数里 stopPropagation 能阻止元素自身的原生监听器，实际那些监听器已经执行过了
- 以为 React 的 onChange 等同于原生 change 事件
