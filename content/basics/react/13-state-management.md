---
difficulty: 2
tags: [高频, 对比, 实践]
---

# React 状态管理怎么选？Redux、Zustand、Jotai 有什么区别？

::: tip 一句话回答
先分清状态的类型，再选工具：组件自己的 **UI 状态**用 useState / useReducer；来自接口的 **服务端状态**交给 TanStack Query、SWR 这类请求库，它们负责缓存、去重和刷新；筛选条件、页码这类需要分享和刷新保留的放进 **URL**；剩下真正跨组件共享的 **客户端全局状态**才需要状态库。**Redux Toolkit** 是集中式 store + action，规范统一、调试工具完善，适合大型团队；**Zustand** 也是单一 store，但 API 极简，用选择器按需订阅；**Jotai** 是原子化的，状态拆成一个个 atom，组件只订阅自己用到的 atom。三者都没有 Context 那种"value 一变所有消费者都渲染"的问题。
:::

## 详细解析

### 先给状态分类

| 类型 | 例子 | 推荐方案 |
| --- | --- | --- |
| 本地 UI 状态 | 弹窗开关、输入框内容 | useState、useReducer，必要时状态提升 |
| 服务端状态 | 用户信息、列表数据 | TanStack Query、SWR，或框架的数据加载 |
| URL 状态 | 搜索词、筛选条件、页码 | 路由的查询参数 |
| 客户端全局状态 | 登录态、购物车、主题、多步骤表单 | Context、Zustand、Jotai、Redux Toolkit |

很多项目里"全局状态很乱"，其实是把接口数据手动塞进了全局 store，自己处理 loading、缓存和过期。把服务端状态交给请求库之后，剩下的全局状态通常很少：

```jsx
import { useQuery } from '@tanstack/react-query'

function UserCard({ userId }) {
  const { data, isPending, error } = useQuery({
    queryKey: ['user', userId], // 缓存键：userId 变了自动请求新数据
    queryFn: () => fetchUser(userId),
    staleTime: 60_000, // 1 分钟内认为数据是新的，不重复请求
  })
  if (isPending) return <p>加载中</p>
  if (error) return <p>出错了</p>
  return <p>{data.name}</p>
}
```

### Context 为什么不够

Context 只是传递数据的机制，value 变化时所有读取它的组件都会重新渲染，不能只订阅其中一个字段，见 [Context 的性能问题](/basics/react/08-context-communication)。它适合主题、语言这类变化少的数据，频繁变化的共享状态更适合下面这些库。它们把状态放在 React 外部的 store 里，通过 `useSyncExternalStore` 订阅，组件只在自己选中的数据变化时渲染。

### Redux Toolkit

Redux 的核心是单一 store、纯函数 reducer、通过 dispatch action 修改状态，每次变化都可追踪、可回放。Redux Toolkit（RTK）是官方推荐的写法，`createSlice` 一次生成 reducer 和 action，内置 Immer 可以用"直接修改"的写法产生不可变更新，还自带 RTK Query 处理服务端状态。代价是概念和样板代码比另外两个多：

```jsx
const counterSlice = createSlice({
  name: 'counter',
  initialState: { value: 0 },
  reducers: {
    incremented: (state) => {
      state.value += 1 // Immer 会生成新对象
    },
  },
})
const store = configureStore({ reducer: { counter: counterSlice.reducer } })
// 组件中：useSelector((state) => state.counter.value)，dispatch(counterSlice.actions.incremented())
```

### Zustand 和 Jotai

- **Zustand**：`create` 直接返回一个 Hook，状态和修改方法写在一起，不需要 Provider，组件外（如请求拦截器中）也能通过 `useCartStore.getState()` 读写。Vue 生态的对应方案见 [Pinia](/basics/vue/17-pinia)
- **Jotai**：自底向上，每个 atom 是一小块状态，派生 atom 由其他 atom 计算得到，依赖变化时自动更新，思路接近 Vue 的 ref 和 computed

```jsx
import { atom, useAtomValue, useSetAtom } from 'jotai'

const priceAtom = atom(100)
const qtyAtom = atom(2)
const totalAtom = atom((get) => get(priceAtom) * get(qtyAtom)) // 派生 atom

function Total() {
  return <b>{useAtomValue(totalAtom)}</b> // 只有 total 变化时渲染
}
function AddButton() {
  const setQty = useSetAtom(qtyAtom) // 只写不读，qty 变化时这个组件不渲染
  return <button onClick={() => setQty((q) => q + 1)}>+1</button>
}
```

### 对比

| | Redux Toolkit | Zustand | Jotai |
| --- | --- | --- | --- |
| 模型 | 单一 store，action + reducer | 单一 store，直接调用方法修改 | 分散的 atom |
| 订阅粒度 | useSelector 选择器 | 选择器 | 按 atom |
| 需要 Provider | 需要 | 不需要 | 可选 |
| 样板代码 | 较多 | 很少 | 很少 |
| 适合 | 大型应用、多人协作、复杂流程 | 中小型项目、大多数业务场景 | 状态之间派生关系多、细粒度更新 |

## 代码示例：Zustand 购物车

```jsx
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'

const useCartStore = create((set) => ({
  items: [],
  coupon: null,
  addItem: (item) => set((state) => ({ items: [...state.items, item] })),
  applyCoupon: (code) => set({ coupon: code }), // set 会浅合并到原状态
}))

function CartTotal() {
  // 选择器返回派生出的原始值，总价不变就不渲染
  const total = useCartStore((state) => state.items.reduce((sum, i) => sum + i.price, 0))
  return <b>{total}</b>
}

function CouponPanel() {
  // 选择器返回新对象时，用 useShallow 做浅比较，否则每次都被认为变了
  const { coupon, applyCoupon } = useCartStore(
    useShallow((state) => ({ coupon: state.coupon, applyCoupon: state.applyCoupon })),
  )
  return <button onClick={() => applyCoupon('VIP')}>{coupon ?? '使用优惠券'}</button>
}
```

## 面试官可能追问

::: details 为什么说服务端数据不要放进 Redux？
服务端数据是远端数据的一份缓存，要处理加载状态、过期、重新请求、多个组件重复请求时去重、窗口聚焦时刷新、修改后让缓存失效。手动放进 Redux 等于自己实现一遍这些逻辑。TanStack Query、SWR 专门解决这些问题，全局 store 只留真正的客户端状态。
:::

::: details Zustand 的选择器返回对象为什么会导致无限渲染或多余渲染？
Zustand 默认用 `Object.is` 比较选择器的返回值，`(s) => ({ a: s.a, b: s.b })` 每次都返回新对象，永远不相等。v4 中表现为 store 任何变化都会让组件渲染；v5 改为直接使用 React 的 `useSyncExternalStore`，每次读取快照都不相等，开发环境先警告 getSnapshot 的结果应该缓存，接着报 "Maximum update depth exceeded"。解决方法是分别选取每个字段，或者用 `useShallow` 包裹选择器做浅比较。
:::

::: details 状态库在 SSR 下要注意什么？
模块级的 store 在服务端是所有请求共享的，A 用户的数据可能被渲染给 B 用户。服务端渲染时要为每个请求创建独立的 store，通常是在组件里创建、通过 Context 提供给子组件；Jotai 的 Provider、Redux 的 Provider 都是这个思路。
:::

## 易错点

- 一上来就引入全局状态库，结果大部分状态其实是服务端数据或只属于某个组件
- Zustand 选择器返回新对象、新数组，没有配合 `useShallow`，按需订阅就失效了
- 在 Redux 的 reducer 外直接修改 state 对象，或者在没有 Immer 的地方"直接修改"，界面不会更新
