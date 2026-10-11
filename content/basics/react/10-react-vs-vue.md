---
difficulty: 2
tags: [高频, 对比]
---

# React 和 Vue 有什么区别？

::: tip 一句话回答
最核心的区别是**怎么知道状态变了、该更新什么**：Vue 用响应式系统**自动追踪依赖**，数据可以直接修改，只有用到这个数据的组件会更新；React 用**不可变数据 + 重新渲染**，调用 setState 后组件函数整个重新执行，默认连同子组件一起渲染，再靠 diff 找出变化。由此带来一系列差异：Vue 以模板为主，编译器能做静态分析优化；React 用 JSX，表达能力就是完整的 JS，优化靠 memo 等记忆化手段或 React Compiler。Composition API 和 Hooks 都用函数组织逻辑，但 Vue 的 `setup` 只执行一次，React 组件每次渲染都重新执行，所以有依赖数组和闭包的问题。两者没有绝对的优劣，选型看团队、项目和生态。
:::

## 详细解析

### 对比一览

| | Vue | React |
| --- | --- | --- |
| 状态变化的检测 | 响应式：拦截读写（Proxy、ref 的 getter/setter），自动收集依赖 | 显式调用 setState，状态当作不可变数据 |
| 更新范围 | 只更新依赖了这个数据的组件 | 组件和它的子组件默认全部重新渲染 |
| 视图写法 | 模板为主，也支持 JSX | JSX |
| 性能优化 | 编译器标记动态内容，更新时跳过静态部分 | memo、useMemo、useCallback，或 React Compiler |
| 逻辑复用 | 组合式函数 | 自定义 Hook |
| 表单双向绑定 | `v-model` 语法糖 | 受控组件：value 加 onChange |
| 官方生态 | 路由、状态管理（Pinia）等由官方维护 | 核心库较精简，路由、状态管理多由社区提供 |

### 响应式和不可变数据

```vue
<script setup>
import { ref, computed } from 'vue'

const todos = ref([])
const doneCount = computed(() => todos.value.filter((t) => t.done).length)

function add(text) {
  todos.value.push({ id: Date.now(), text, done: false }) // 直接修改，Vue 能追踪到
}
</script>
```

```jsx
function TodoApp() {
  const [todos, setTodos] = useState([])
  const doneCount = todos.filter((t) => t.done).length // 每次渲染重新计算，开销大时再用 useMemo

  function add(text) {
    setTodos([...todos, { id: Date.now(), text, done: false }]) // 必须创建新数组
  }
  // ...
}
```

Vue 在读取数据时记录"谁用到了它"，修改时精确通知这些地方，原理见 [Vue 3 的响应式原理](/basics/vue/01-reactivity)。React 不追踪数据被谁读取，只知道"这个组件的状态变了"，于是重新执行组件函数，生成新的虚拟 DOM 再对比，见 [虚拟 DOM 和 diff 算法](/basics/react/01-virtual-dom-diff)。

### 模板、JSX 和优化方式

- Vue 的模板语法受限，编译器能分析出哪些节点是静态的、哪些属性是动态的，更新时跳过静态内容，见 [Vue 3 的编译优化](/basics/vue/08-compiler-optimization)。开发者一般不需要手动优化
- JSX 就是 JavaScript，可以随意使用条件、循环和函数，灵活，配合 TypeScript 也很自然，但很难做同等程度的静态分析。React 的优化主要是避免不必要的重新渲染，见 [useMemo、useCallback 和 React.memo](/basics/react/06-memo)

### Hooks 和 Composition API

两者都按功能组织逻辑、通过函数复用，写法相似，执行模型却不同：

| | Vue Composition API | React Hooks |
| --- | --- | --- |
| 执行次数 | `setup` 每个组件实例只执行一次 | 组件每次渲染都重新执行 |
| 读取最新值 | ref 是同一个对象，`.value` 总是最新的 | 变量是每次渲染的快照，回调可能读到旧值 |
| 依赖 | 响应式系统自动收集 | 手写依赖数组 |
| 调用位置 | 在 `setup` 中同步调用，不依赖顺序，可以写在条件里 | 必须在顶层按固定顺序调用 |
| 缓存 | computed 自带缓存 | 需要时手写 useMemo、useCallback |

React 的这些规则都源于"每次渲染重新执行"，见 [Hooks 的原理](/basics/react/03-hooks-rules) 和 [闭包陷阱](/basics/react/07-stale-closure)；Vue 一侧见 [Composition API](/basics/vue/11-composition-api)。反过来，React 的模型也有好处：每次渲染都是普通的函数调用，数据都是普通的值，没有"解构丢失响应性""要写 .value"这类问题。

### 选型考虑

- **团队经验**：团队熟悉哪个就用哪个，这往往比框架本身的差异更重要
- **上手和开发效率**：Vue 的模板和官方配套对新手友好；React 更接近"纯 JS"，灵活度高，但很多方案要自己组合
- **生态和跨端**：需要用同一套技术开发原生移动应用时，React Native 是成熟的选择；两者都有对应的全栈框架，如 Nuxt、Next.js
- **已有项目**：已有代码、组件库和团队招聘情况，通常是决定性因素

## 面试官可能追问

::: details 为什么 React 需要 useMemo、useCallback，而 Vue 基本不需要？
React 组件每次渲染都会重新执行，里面创建的对象和函数都是新的引用，子组件又默认跟着父组件渲染，所以需要手动记忆化来跳过不必要的渲染。Vue 的 `setup` 只执行一次，函数和对象只创建一次；组件是否更新由响应式依赖决定，子组件的 props 没变就不会渲染；computed 自带缓存。所以 Vue 很少需要这类手动优化。
:::

::: details Vue 的响应式有什么代价？
要为数据创建 Proxy、维护依赖关系，数据量很大时有额外的内存和 CPU 开销，可以用 `shallowRef`、`markRaw` 规避；使用上也有一些限制，比如解构 reactive 对象会丢失响应性、脚本中访问 ref 要写 `.value`、代理对象和原始对象不是同一个引用。React 的数据是普通的 JS 值，没有这些问题，代价是要自己保证不可变更新和依赖数组正确。
:::

::: details 两个框架的发展方向有什么共同点？
都在把更多工作交给编译器。React Compiler 在编译时自动加上记忆化，减少手写 useMemo、useCallback；Vue 的 Vapor Mode 把模板直接编译成操作 DOM 的代码，不再创建虚拟 DOM。目标都是减少开发者手动优化的负担，同时尽量不改变原有的写法。
:::

## 易错点

- 不要说"Vue 是双向数据流"：Vue 的 props 同样是单向的，`v-model` 只是 prop 加事件的语法糖
- 不要笼统地说哪个框架性能更好，性能更多取决于具体的写法和场景
- Vue 也支持 JSX，React 也能借助编译器优化，模板和 JSX 并不是区分两者的根本原因
