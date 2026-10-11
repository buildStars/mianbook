---
difficulty: 2
tags: [高频, 原理]
---

# React 的虚拟 DOM 和 diff 算法是怎样的？

::: tip 一句话回答
虚拟 DOM 是用 JS 对象描述的界面结构，在 React 中就是 JSX 编译出来的 **React 元素**。状态变化时组件重新渲染，生成新的元素树，React 把它和上一次的结果对比（协调，reconciliation），算出需要的修改再应用到真实 DOM。为了把复杂度降到 O(n)，diff 基于三个前提：**只比较同一层级**；**类型不同就替换整棵子树**；同一层的子元素用 **key** 识别。列表 diff 先按顺序逐个比较，遇到 key 不同时，把剩下的旧节点放进以 key 为键的 Map，再为每个新节点查找可以复用的旧节点。
:::

## 详细解析

### 虚拟 DOM 是什么

```jsx
const element = (
  <div className="card">
    <h2>Hello</h2>
  </div>
)
```

JSX 会被编译成 `jsx()` 函数调用（旧的编译方式是 `React.createElement()`），返回一个普通对象，也就是 React 元素：

```js
// 简化后的结构
const element = {
  type: 'div', // 原生标签是字符串，组件是组件函数本身
  key: null,
  props: {
    className: 'card',
    children: { type: 'h2', key: null, props: { children: 'Hello' } },
  },
}
```

元素是不可变的，每次渲染都会创建新的元素。React 内部还有一棵 Fiber 树，保存组件的状态和对应的真实 DOM，diff 实际上是拿新的元素和上一次的 Fiber 节点比较，详见 [Fiber 架构](/basics/react/02-fiber)。

### diff 的三个前提

求两棵树之间最少修改步骤的通用算法，复杂度在 O(n³) 量级，React 用三条启发式规则把它降到 O(n)：

1. **只比较同一层级**：不跨层级寻找可复用的节点，节点跨层级移动会被当作在旧位置删除、在新位置新建
2. **类型不同，整棵子树替换**：`div` 变成 `section`，或者 `<Counter>` 变成 `<Timer>`，直接卸载旧子树（组件的 state 全部丢失，effect 被清理），再创建新的，不再比较它们的子节点
3. **用 key 识别列表元素**：同一层的子元素通过 key 判断是不是同一个，key 和类型都相同才复用

类型相同时，DOM 元素保留原来的 DOM 节点，只更新变化的属性，再继续比较子节点；组件保留 state，用新的 props 重新渲染。

```jsx
// isEditing 切换时，外层从 div 变成 form，里面的 Counter 也会被卸载重建，计数归零
function Panel({ isEditing }) {
  return isEditing ? (
    <form>
      <Counter />
    </form>
  ) : (
    <div>
      <Counter />
    </div>
  )
}
```

### 列表 diff 的过程

新的子节点是数组时，React 分三步处理（源码中的 `reconcileChildrenArray`）：

1. **按顺序比较**：从头开始比较同一位置的新旧节点，key 相同就继续（类型也相同时复用，否则新建），遇到 key 不同就停下
2. **一边遍历完了**：新节点遍历完，剩下的旧节点全部删除；旧节点遍历完，剩下的新节点全部插入
3. **处理剩余部分**：把剩余的旧节点放进以 key 为键的 Map，遍历剩余的新节点，按 key 查找能复用的旧节点。用 `lastPlacedIndex` 记录"已经确定不用移动的节点中，最大的旧索引"：复用节点的旧索引比它小，就标记为需要移动；否则原地不动，并更新 `lastPlacedIndex`。最后删除 Map 中没被复用的旧节点

```text
旧：a b c d    新：d a b c（把 d 移到最前面）

1. 第一个位置 a 和 d 的 key 不同，直接进入第 3 步，a b c d 放进 Map
2. d：旧索引 3 ≥ lastPlacedIndex 0，不动，lastPlacedIndex 更新为 3
3. a：旧索引 0 < 3，标记移动
4. b、c：旧索引 1、2 都小于 3，标记移动

结果：a、b、c 三个节点被移动，而直觉上只需要移动 d
```

这种算法只会把节点往后挪，把最后一项移到最前面是最差的情况。Vue 3 对乱序部分求最长递增子序列，这个例子只需要移动 d，见 [Vue 的 diff 算法](/basics/vue/07-vdom-diff)。

### key 和 index 作 key 的问题

key 让 React 在列表顺序变化时认出"同一个元素"。用数组下标作 key，在头部插入、删除或排序后，同一个下标对应的数据变了，React 会复用错误的组件：组件内部的 state、输入框里的内容会错位，原理和 Vue 中相同，见 [key 的作用](/basics/vue/06-key)。数据有稳定的 id 就用 id。

key 还能用来重置组件：`<Profile key={userId} />` 在 userId 变化时 key 也变了，React 会卸载旧组件、创建新组件，state 全部重置。

### 虚拟 DOM 不等于更快

虚拟 DOM 多了创建元素和对比的开销，不一定比针对场景手写的 DOM 操作快，它的价值是声明式的开发方式和跨平台渲染（如 React Native），原因见 [虚拟 DOM 一定比直接操作 DOM 快吗](/basics/vue/07-vdom-diff)。Svelte、Solid 等框架则不使用虚拟 DOM，而是在编译时或通过细粒度的响应式直接更新 DOM。

## 面试官可能追问

::: details 为什么 React 不像 Vue 3 那样求最长递增子序列？
React 的列表 diff 是一次从左到右的遍历加一个 Map，实现简单，常见的追加、删除、局部插入只需要很少的操作；代价是"末尾元素移到最前面"这类情况会产生多余的移动。源码注释提到，Fiber 的兄弟节点之间是单向链表，没有指向前一个节点的指针，所以没有做双端比较。
:::

::: details 为什么不能在组件内部定义组件？
```jsx
function Parent() {
  // 每次 Parent 渲染，都会创建一个新的 Child 函数
  function Child() {
    const [text, setText] = useState('')
    return <input value={text} onChange={(e) => setText(e.target.value)} />
  }
  return <Child />
}
```

元素的 type 就是组件函数本身。Parent 每次渲染，Child 都是一个新函数，type 和上次不同，React 会卸载旧的 Child 再创建新的，输入框的内容和焦点每次都会丢失。组件要定义在模块顶层。
:::

::: details 条件渲染两个同类型的组件，state 会保留吗？
`{isA ? <Counter person="A" /> : <Counter person="B" />}` 中，两个分支渲染在同一个位置、类型都是 Counter，React 认为是同一个组件，只更新 props，计数会保留。希望它们相互独立，可以给它们不同的 key，或者渲染在不同的位置。state 是和组件在树中的**位置**绑定的，不是和 JSX 写在哪一行绑定的。
:::

## 易错点

- diff 只做同层比较，节点跨层级移动等于删除后重建，组件状态会丢失
- key 只需要在兄弟节点之间唯一；key 不会作为 props 传给组件，组件内部读不到它
- 虚拟 DOM 的主要价值是声明式的开发方式和跨平台，不是"一定比直接操作 DOM 快"
