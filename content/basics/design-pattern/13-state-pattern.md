---
difficulty: 2
tags: [实践, 场景题]
---

# 状态模式和有限状态机是什么？怎么用来管理复杂的 UI 状态？

::: tip 一句话回答
有限状态机由**状态、事件、转移**组成：系统在任一时刻只处于一个确定的状态，收到事件后按转移表进入下一个状态，**不在表里的转移一律不发生**。状态模式是它的面向对象实现：把每个状态封装成对象，行为随当前状态对象而变，消除大量 `if (isLoading && !isError ...)`。在 UI 里，用一个状态字段替代多个布尔标志，可以从根上杜绝"既在加载又报错"这类不可能出现的组合。
:::

## 详细解析

### 布尔标志的问题

一个请求组件常见写法：

```js
const [isLoading, setLoading] = useState(false)
const [isError, setError] = useState(false)
const [data, setData] = useState(null)
```

3 个变量能组合出 8 种情况，但合法的只有"空闲、加载中、成功、失败"4 种。忘了在某处重置 `isError`，就会出现"加载中同时显示错误"的界面。标志越多，非法组合越多，`if` 越乱。

### 状态、事件、转移

用一个 `status` 字段表示当前状态，再写一张转移表：

```text
          FETCH            RESOLVE
 idle ──────────> loading ──────────> success
                    │  ▲                │
             REJECT │  │ RETRY          │ FETCH
                    ▼  │                ▼
                   error             loading
```

- **状态**：互斥的有限集合，任何时刻只有一个
- **事件**：外部发生的事，比如点击、请求返回
- **转移**：(当前状态, 事件) → 下一个状态，表里没有就忽略

好处是"在 loading 时再点一次 FETCH"这种情况，表里没写就自然被忽略，不需要额外加防重复的判断。

### 常见例子

- **请求状态**：idle、loading、success、error
- **播放器**：stopped、playing、paused、buffering，"暂停"按钮只在 playing 时有效
- **订单流程**：待支付、已支付、已发货、已完成、已取消，后端的完整设计见 [订单和支付](/basics/backend-design/08-order-payment)
- **多步表单、引导流程、拖拽交互**

### XState 这类库的思路

手写转移表能应付简单场景。状态复杂后，XState 这类库提供了更多能力：

- **层级状态**：`playing` 下面再分 `normal`、`fastForward`，共享父状态的转移
- **并行状态**：播放状态和音量状态互相独立，同时存在
- **守卫**：满足条件才允许转移，比如"余额足够才能支付"
- **上下文和动作**：状态之外的数据放在 context，转移时触发副作用
- **可视化**：状态机定义可以画成图，方便和产品对齐流程

核心思想不变：先把所有状态和合法转移列清楚，再写代码。

### 和策略模式的区别

结构上都是"一个上下文持有一个可替换的对象，把行为委托给它"。区别在于**谁来切换**：[策略模式](/basics/design-pattern/04-strategy) 由外部选好策略注入，策略之间互不知道；状态模式里的状态对象**知道下一个状态是谁**，会根据事件自己切换。策略是"选哪种算法"，状态是"现在走到哪一步"。

## 代码示例

```js
// 转移表：(状态, 事件) → 新状态
const machine = {
  idle: { FETCH: 'loading' },
  loading: { RESOLVE: 'success', REJECT: 'error' },
  success: { FETCH: 'loading' },
  error: { RETRY: 'loading' },
}

function transition(state, event) {
  return machine[state]?.[event] ?? state // 非法事件直接忽略
}

let s = 'idle'
for (const e of ['FETCH', 'FETCH', 'REJECT', 'RESOLVE', 'RETRY', 'RESOLVE']) {
  s = transition(s, e)
  console.log(e.padEnd(8), '→', s)
}
// FETCH    → loading
// FETCH    → loading（重复点击被忽略）
// REJECT   → error
// RESOLVE  → error（error 状态不接受 RESOLVE）
// RETRY    → loading
// RESOLVE  → success
```

在 React 里可以直接放进 `useReducer`：reducer 先用转移表算出新状态，非法事件返回原 state，组件根据 `status` 渲染对应界面。

## 面试官可能追问

::: details 状态机里的数据（比如请求结果、错误信息）放在哪？
有限状态只描述"处于哪一步"，具体数据放在旁边的上下文里，比如 `{ status: 'error', error, data }`。用 TypeScript 的可辨识联合类型可以让 `status: 'success'` 时必有 `data`，`status: 'error'` 时必有 `error`，编译期就能防住非法组合。
:::

::: details 什么时候值得引入状态机库？
状态在 3、4 个以内、转移简单时，一个 `status` 字段加 `useReducer` 就够。出现层级、并行状态、带守卫的转移、需要和产品对着流程图核对时，库的价值才明显。引入库也有学习成本，团队要能读懂状态机定义。
:::

::: details 状态模式的状态对象写法是什么样的？
每个状态是一个对象，实现同一组方法（如 `play`、`pause`）。上下文持有当前状态对象，调用方法时委托给它；状态对象在方法里决定做什么、要不要把上下文切换到另一个状态。加新状态时只加新类，不用改一堆 `switch`。
:::

## 易错点

- 只把 `isLoading` 改名成 `status`，却仍在各处随意赋值，没有统一的转移规则，等于没用状态机
- 把数据和状态混在一起，状态数量爆炸；有限状态要少而稳定，数据放在上下文
- 把状态模式和策略模式混淆：关键看状态切换是不是由状态自己驱动
