---
difficulty: 3
tags: [原理]
---

# Fiber 架构是什么？为什么需要可中断渲染？

::: tip 一句话回答
React 16 之前的**栈调和**用递归遍历组件树，一旦开始就必须一次处理完，组件树很大时会长时间占用主线程，用户输入和动画都会卡顿。Fiber 把每个组件对应的工作拆成一个个**工作单元**（Fiber 节点），用 `child`、`sibling`、`return` 指针连成链表，改用循环遍历，于是可以处理一部分就把主线程让出来，之后再接着做。渲染分两个阶段：**render 阶段**计算变化，可以中断、恢复甚至丢弃；**commit 阶段**把变化应用到 DOM，同步执行、不可中断。调度器按**优先级**（Lane）决定先做什么，内存里用 current 和 workInProgress 两棵树做**双缓存**。
:::

## 详细解析

### 为什么要改

React 15 及以前，更新时从触发更新的组件开始，递归比较它的整棵子树。递归依赖调用栈，中途没法暂停：一次更新如果要处理几千个组件，耗时可能远超一帧（60Hz 屏幕约 16.7ms），这期间浏览器无法响应点击和输入，动画也会掉帧。

Fiber 要解决的就是：把渲染工作拆成小单元，可以暂停和恢复；给更新分配优先级，用户输入比后台数据刷新更急；做了一半的低优先级工作，可以丢弃后重新开始。

### Fiber 节点和链表结构

每个组件、每个 DOM 元素都对应一个 Fiber 节点，它是一个普通对象（下面是简化后的主要字段）：

```js
const fiber = {
  type: App, // 组件函数，或 'div' 这样的标签名
  key: null,
  stateNode: null, // 对应的真实 DOM 节点
  child: null, // 第一个子节点
  sibling: null, // 下一个兄弟节点
  return: null, // 父节点
  pendingProps: {}, // 这次渲染的 props
  memoizedProps: {}, // 上一次渲染用的 props
  memoizedState: null, // 函数组件的 Hooks 链表
  flags: 0, // 副作用标记：插入、更新、删除等
  lanes: 0, // 待处理更新的优先级
  alternate: null, // 另一棵树上对应的节点
}
```

```text
        App
         │ child
         ▼
       Header ──sibling──► List
         │ child             │ child
         ▼                   ▼
         h1                 Item ──sibling──► Item

（每个节点的 return 都指向父节点）
```

遍历是深度优先的：有 child 就往下走；没有 child 就完成当前节点，转到 sibling；没有 sibling 就沿着 return 回到父节点。每一步只需要知道"当前节点"，所以可以在任意节点停下，下次从这里接着做：

```js
let workInProgress = null // 下一个要处理的 Fiber

function workLoopConcurrent() {
  // 还有工作，并且这一个时间片没用完，就继续
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress)
  }
}

function performUnitOfWork(fiber) {
  // 调用组件函数、对比子节点，返回第一个子 Fiber
  const next = beginWork(fiber)
  if (next !== null) {
    workInProgress = next
    return
  }
  // 没有子节点：完成当前节点，再转向兄弟节点或回到父节点
  let node = fiber
  while (node !== null) {
    completeWork(node) // 创建 DOM 节点、收集副作用
    if (node.sibling !== null) {
      workInProgress = node.sibling
      return
    }
    node = node.return
  }
  workInProgress = null // 回到了根节点，整棵树处理完
}
```

### 两个阶段

| | render 阶段 | commit 阶段 |
| --- | --- | --- |
| 做什么 | 调用组件函数，对比出变化，给 Fiber 打上副作用标记 | 执行 DOM 操作，绑定 ref，执行 useLayoutEffect，安排 useEffect |
| 能否中断 | 可以中断、恢复，也可能被丢弃后重来 | 不能，同步一次执行完 |
| 用户能否看到 | 看不到，只在内存中进行 | 执行完界面就变了 |

commit 不能中断，否则用户会看到改了一半的界面。render 阶段可能被打断、重新执行，所以组件函数必须是纯的。

### 调度器和时间切片

React 自带一个调度器（scheduler 包）。工作循环每处理完一个 Fiber 就检查 `shouldYield()`，当前时间片（调度器源码中默认约 5ms，属于实现细节）用完就让出主线程，浏览器得以处理输入和绘制；之后通过 `MessageChannel` 安排一个新的宏任务接着做。没有用 setTimeout，是因为嵌套调用时有最小延迟；没有用 requestIdleCallback，是因为它的触发时机不稳定，部分浏览器也长期不支持。

### 优先级：Lane

React 用二进制位表示更新的优先级，叫作 Lane（车道），一个 31 位的整数就能同时记录多个待处理的优先级，合并、比较都是位运算。大致从高到低：同步（点击、按键等离散事件中的更新）、连续事件（滚动、鼠标移动）、默认（如 setTimeout、请求回调中的更新）、过渡（`startTransition` 标记的更新）、空闲。

正在渲染低优先级更新时来了高优先级更新，React 会放下手里的工作，先处理高优先级的，之后再重新渲染低优先级的。

要注意，Fiber 让渲染**可以**中断，但不是所有渲染都会切片：点击、输入这类紧急更新，以及 setTimeout、请求回调里的普通更新，渲染一旦开始都会一口气做完，中途不让出主线程；只有过渡更新这类低优先级的渲染才会分片执行、可能被打断，见 [React 的并发特性](/basics/react/09-concurrent)。

### 双缓存

内存中同时存在两棵 Fiber 树：**current 树**对应屏幕上正在显示的内容；**workInProgress 树**是正在构建的新树，节点尽量复用 current 树中的对应节点，两者通过 `alternate` 互相指向。

render 阶段只修改 workInProgress 树，被打断或丢弃都不影响屏幕上的内容；commit 阶段改完 DOM 后，根节点的 current 指针改为指向 workInProgress 树，它就成了新的 current 树。这和图形学中"先在后台缓冲区画好，再一次性切换显示"的双缓冲是同一个思路。

## 面试官可能追问

::: details 为什么 render 阶段可以中断，commit 阶段不行？
render 阶段只在内存中计算，没有改动任何用户能看到的东西，中断或丢弃都没有影响。commit 阶段在修改真实 DOM，中途停下，屏幕上就是一半新一半旧的界面；ref、useLayoutEffect 也依赖 DOM 处于一致的状态。所以 commit 必须同步完成，耗时的计算都应该发生在 render 阶段。
:::

::: details 渲染可能被打断重来，对写代码有什么影响？
组件函数可能被调用多次，结果却只提交一次，所以渲染过程必须是纯的：不修改外部变量、不发请求、不直接操作 DOM，副作用放到 effect 或事件处理函数里。开发环境的 StrictMode 会故意把组件函数调用两次，就是为了暴露不纯的渲染逻辑。类组件的 `componentWillMount` 等生命周期被加上 `UNSAFE_` 前缀，也是因为它们在 render 阶段执行，可能被调用多次。
:::

::: details Fiber 和虚拟 DOM 是什么关系？
React 元素（虚拟 DOM）是每次渲染都重新创建的不可变对象，只描述"界面应该长什么样"。Fiber 节点是长期存在、会被修改的工作单元，保存着组件的 state、Hooks、对应的 DOM 节点和副作用标记。协调时，React 拿新的元素和旧的 Fiber 比较，生成新的 Fiber 树，见 [虚拟 DOM 和 diff 算法](/basics/react/01-virtual-dom-diff)。
:::

## 易错点

- Fiber 只是让渲染"可以中断"，没有标记为过渡的更新（包括点击、输入引起的紧急更新）仍然一次渲染完，不会切片
- 时间切片不会减少总的计算量，它改善的是响应速度，避免主线程被长时间占用
- commit 阶段是同步的，在 useLayoutEffect 里做耗时操作同样会卡住页面
