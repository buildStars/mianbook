---
difficulty: 3
tags: [高频, 性能优化, 场景题]
---

# React 应用的性能怎么优化？怎么定位渲染问题？

::: tip 一句话回答
**先测量再优化**：用 React DevTools 的 Profiler 录制一次操作，看哪些组件渲染了、为什么渲染、各花了多少时间；用浏览器 Performance 面板看长任务和主线程占用。React 中最常见的问题是**不必要的重新渲染**：父组件渲染带动整个子树、Context 的 value 变化、每次都传入新的对象或函数。优化手段按优先级：调整结构（**状态下放**、把不变的部分作为 **children** 传入）→ `memo` 配合 `useMemo` / `useCallback`（或交给 React Compiler）→ 长列表**虚拟化** → **代码分割**减少首屏 JS → 用 **transition** 让耗时渲染不阻塞输入。
:::

## 详细解析

### 先定位

1. **React DevTools Profiler**：录制一次卡顿的操作，火焰图里能看到每次提交中渲染了哪些组件、各自耗时。在设置里打开"Record why each component rendered"，可以看到渲染原因：props 变了、state 变了、Hook 变了，还是父组件渲染了
2. **高亮更新**：DevTools 设置中勾选"Highlight updates when components render"，操作时闪烁的区域就是重新渲染的组件，一眼能看出影响范围是否过大
3. **Performance 面板**：看有没有超过 50ms 的长任务、时间花在脚本执行还是样式布局上。较新的 React 版本还会在这里显示 React 自己的轨道（Performance Tracks），能看到各优先级的调度和组件渲染
4. **`<Profiler>` 组件**：`onRender` 回调拿到每次提交的耗时，可以在代码里统计。它在默认的生产构建中不生效，线上采集需要专门开启 profiling 构建

性能问题要在生产构建下验证，开发构建有大量额外检查，会慢很多。

### 为什么会多余地渲染

- **父组件渲染，子组件默认全部跟着渲染**，不管 props 有没有变
- **Context 的 value 变化**：所有读取它的组件都会渲染，memo 也挡不住，见 [Context 的性能问题](/basics/react/08-context-communication)
- **每次渲染创建新的对象、数组、函数**作为 props，memo 的浅比较永远不相等
- **状态放得太高**：一个输入框的 state 放在页面根组件，每输入一个字符整页都渲染

### 优化手段

| 问题 | 手段 |
| --- | --- |
| 状态放得太高 | 状态下放到真正使用它的组件 |
| 外层有 state，内层很重但不依赖它 | 把内层作为 children 传入 |
| 子组件很重，props 大部分时候不变 | memo + useMemo / useCallback，见 [memo 的用法](/basics/react/06-memo) |
| Context 引起大面积渲染 | 拆分 Context、稳定 value，或改用支持选择器的状态库 |
| 几千条数据的列表 | 虚拟列表，只渲染可见区域，见 [长列表优化](/basics/browser/13-long-list) |
| 首屏 JS 太大 | lazy + Suspense 按路由和功能拆分，见 [Suspense](/basics/react/16-suspense) |
| 输入时渲染很重的结果 | useTransition、useDeferredValue，见 [并发特性](/basics/react/09-concurrent) |
| 计算本身很慢 | useMemo 缓存，或者移到 Web Worker |

### React Compiler

React Compiler 在构建时自动插入记忆化，原理见 [memo 的用法](/basics/react/06-memo)。接入时要知道三点：编译器发现可能违反 React 规则的代码会跳过优化，但不能保证发现所有违规，配合它的 ESLint 规则检查更稳妥；已有项目建议逐步开启并充分测试，原有的手写记忆化先保留，删掉可能改变编译结果；它只能减少"新引用导致的多余渲染"，解决不了状态放错位置、列表太长、包太大这类问题。

## 代码示例：状态下放和 children

```jsx
// 优化前：每次输入，ExpensiveTree 都会重新渲染
function Page() {
  const [color, setColor] = useState('red')
  return (
    <div style={{ color }}>
      <input value={color} onChange={(e) => setColor(e.target.value)} />
      <ExpensiveTree />
    </div>
  )
}

// 优化后：color 只影响 ColorPicker，ExpensiveTree 作为 children 传入
function ColorPicker({ children }) {
  const [color, setColor] = useState('red')
  return (
    <div style={{ color }}>
      <input value={color} onChange={(e) => setColor(e.target.value)} />
      {children}
    </div>
  )
}

function Page() {
  return (
    <ColorPicker>
      <ExpensiveTree />
    </ColorPicker>
  )
}
```

ColorPicker 的 state 变化时，`children` 是 Page 上次渲染时创建的同一个元素对象，React 发现它没变，就跳过 ExpensiveTree，不需要任何 memo。

## 面试官可能追问

::: details 列表页滚动卡顿，你会怎么排查？
先用 Performance 面板录制滚动，看是脚本执行还是布局绘制耗时：如果是脚本，用 Profiler 看滚动时是否有组件在渲染（比如滚动位置存在了高层 state 里）；如果是 DOM 节点太多导致布局慢，就做虚拟列表；如果是图片解码、阴影等绘制开销，从 CSS 和图片上优化。还要检查列表项的 key 是否稳定，用 index 作 key 在插入时会导致大量节点更新。
:::

::: details 渲染次数多一定是问题吗？
不一定。React 渲染只是调用组件函数和对比，DOM 只在有差异时更新，轻量组件多渲染几次几乎没有成本。只有渲染耗时明显（Profiler 中单次提交接近或超过一帧的时间）或者影响到交互时才值得优化。为了减少渲染次数到处加 memo，反而增加了比较开销和代码复杂度。
:::

::: details 首屏加载慢应该从哪些方面优化？
React 层面：按路由懒加载、减少首屏渲染的组件、用服务端渲染或 Server Components 减少客户端 JS、用流式 SSR 让首屏先出来。构建层面：分析包体积，去掉重复和过大的依赖，开启压缩和 Tree Shaking。网络层面：CDN、缓存、资源预加载。指标上关注 LCP、INP 等，见 [Web Vitals](/basics/browser/09-web-vitals)。
:::

## 易错点

- 不测量就到处加 memo、useMemo，优化了不慢的地方，真正慢的地方没动
- 在开发构建下测性能，开发模式的额外检查和 StrictMode 的双重渲染会让数据失真
- 以为用了 React Compiler 就不会有性能问题，结构性的问题仍然要自己解决
