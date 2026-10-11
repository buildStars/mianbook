---
difficulty: 2
tags: [高频, 性能优化]
---

# useMemo、useCallback 和 React.memo 什么时候该用？

::: tip 一句话回答
默认情况下，父组件重新渲染时，所有子组件都会跟着重新渲染，不管 props 有没有变。`React.memo` 包裹的组件会**浅比较** props，没变就跳过渲染；但对象、数组、函数类型的 props 每次渲染都是新的引用，所以要配合 `useCallback`（缓存函数）和 `useMemo`（缓存计算结果）保持引用稳定，memo 才能生效。`useMemo` 的另一个用途是缓存开销大的计算。它们都有比较依赖和占用内存的成本，应该在确认有性能问题时再用。React Compiler 能在编译时自动完成这类记忆化。
:::

## 详细解析

### 子组件为什么会"多余"地渲染

组件渲染时，它返回的 JSX 中的子组件也会全部重新渲染。大多数时候这没有问题：渲染组件只是调用函数，真实 DOM 只在有差异时才更新。只有子组件渲染开销大（比如长列表、复杂图表），或者渲染非常频繁时，才值得优化。

### React.memo：props 没变就跳过

```jsx
const ProductList = memo(function ProductList({ items, onSelect }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id} onClick={() => onSelect(item.id)}>
          {item.name}
        </li>
      ))}
    </ul>
  )
})
```

memo 对新旧 props 的每个属性逐个用 `Object.is` 比较（浅比较），全部相同就复用上次的渲染结果。memo 只管 props：组件自己的 state 变化、或者它使用的 Context 变化时，仍然会重新渲染。

### 引用类型的 props 每次都是新的

```jsx
function Shop({ products }) {
  const [theme, setTheme] = useState('light')
  // 每次渲染都会创建新的数组和新的函数，memo 的浅比较永远不相等
  const visible = products.filter((p) => p.inStock)
  const handleSelect = (id) => console.log('选中', id)
  // ...
}
```

切换主题时 `Shop` 重新渲染，`visible` 和 `handleSelect` 都是新的引用，`ProductList` 的 memo 形同虚设。用 useMemo 和 useCallback 改写：

```jsx
function Shop({ products }) {
  const [theme, setTheme] = useState('light')

  // products 不变时，返回上一次的数组，也省去了重新过滤的计算
  const visible = useMemo(() => products.filter((p) => p.inStock), [products])
  // 没有依赖，函数引用始终不变
  const handleSelect = useCallback((id) => console.log('选中', id), [])

  return (
    <div className={theme}>
      <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>切换主题</button>
      <ProductList items={visible} onSelect={handleSelect} />
    </div>
  )
}
```

现在切换主题时，传给 `ProductList` 的两个 props 引用都没变，它会跳过渲染。

- `useMemo(fn, deps)`：依赖不变时，返回上次 fn 的**计算结果**
- `useCallback(fn, deps)`：依赖不变时，返回上次的**函数本身**，等价于 `useMemo(() => fn, deps)`

useMemo 的另一个用途是缓存昂贵的计算，比如对几万条数据排序、过滤，即使没有 memo 子组件也有意义。是否"昂贵"要靠测量：用 React DevTools 的 Profiler，或者用 `console.time` 看实际耗时。

### 过度使用的成本

- 每次渲染都要比较依赖数组，缓存的值也一直占着内存
- 代码更难读；依赖数组写漏了会拿到旧的值，产生隐蔽的 bug
- 很容易白费：只要有一个 prop 每次都变（比如直接写在 JSX 里的 `children`），memo 就失效，前面所有的 useMemo、useCallback 都没有意义

动手优化之前，先考虑调整结构：把频繁变化的 state 下移到真正用它的组件里；或者把不依赖这个 state 的部分作为 `children` 传入，外层组件的 state 变化时，`children` 是同一个元素对象，不会重新渲染。

### React Compiler

React Compiler 是一个构建时工具（例如以 Babel 插件的形式接入）。它分析组件代码，自动为计算结果、函数和 JSX 加上记忆化，相当于在合适的地方替你写好了 useMemo、useCallback 和 memo，而且粒度更细。前提是代码遵守 React 的规则：渲染过程是纯的，不直接修改 props 和 state。使用它的项目中，手写记忆化的必要性会大大降低。

## 面试官可能追问

::: details useMemo 能保证一定使用缓存吗？
不能。官方把它定位为性能优化手段，React 在某些情况下可能丢弃缓存，比如开发时修改了组件文件。代码的正确性不能依赖它，比如不能指望用它保证"某个对象只创建一次"；需要在组件生命周期内保持不变的值，用 useRef 或 useState 保存。
:::

::: details memo 的第二个参数怎么用？有什么风险？
`memo(Component, arePropsEqual)` 可以自定义比较逻辑，返回 true 表示 props 相同、跳过渲染。风险是：比较时忽略了某个函数类型的 prop，组件会一直调用旧的函数，里面闭包捕获的也是旧的 state；在比较函数里做深比较，开销可能比重新渲染还大。
:::

::: details 什么时候不需要用这些？
props 经常变化或者组件渲染很轻的，不用加 memo；子组件没有被 memo 包裹时，给它传的函数用 useCallback 包起来也没有意义；只是拼接字符串、做简单计算的，不需要 useMemo。先写出正确的代码，用 Profiler 找到真正慢的组件再优化。
:::

## 易错点

- memo 只比较 props，组件自身的 state 或使用的 Context 变化时照样渲染
- useCallback 不会让函数执行得更快，它只是保持函数引用不变，引用稳定有意义时才需要
- 依赖数组写漏会拿到旧值，写入每次都变的值又会让缓存失效
