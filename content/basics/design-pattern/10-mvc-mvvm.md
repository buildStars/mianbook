---
difficulty: 2
tags: [高频, 对比]
---

# MVC、MVP、MVVM 有什么区别？

::: tip 一句话回答
三者都把应用分成**数据（Model）**、**界面（View）**和**中间的协调者**，区别在于协调者怎么连接 View 和 Model。**MVC** 中 Controller 处理用户输入、更新 Model，View 根据 Model 渲染，经典形式里 View 会观察 Model 的变化；**MVP** 中 View 和 Model 完全隔离，Presenter 处理逻辑，并通过 View 提供的接口**手动**更新界面；**MVVM** 中 ViewModel 暴露界面需要的状态和操作，通过**数据绑定**和 View 自动同步，开发者不再手动操作 DOM，Vue 是典型代表。React 本身只负责视图层，强调**单向数据流**：状态变化后重新渲染界面。
:::

## 详细解析

### 数据流向

```text
MVC（经典形式）
  用户操作 ──> Controller ──更新──> Model
                                      │ 数据变化时通知 View（观察者模式）
  View <────── 读取数据，重新渲染 ──────┘

MVP
  用户操作 ──> View ──转发事件──> Presenter ──读写──> Model
                ▲                    │
                └── 调用 View 的接口更新界面，如 view.renderList(data)

MVVM
  View <══ 数据绑定，自动同步 ══> ViewModel ──读写──> Model
  用户输入自动写回 ViewModel 的状态，状态变化自动反映到 View
```

| | MVC | MVP | MVVM |
| --- | --- | --- | --- |
| 中间层 | Controller | Presenter | ViewModel |
| View 和 Model | 经典形式中 View 直接读取 Model | 完全隔离 | 隔离，View 只和 ViewModel 绑定 |
| 怎么更新界面 | View 收到 Model 的变化通知后自己刷新 | Presenter 调用 View 的接口手动更新 | 数据绑定自动更新 |
| View 的角色 | 包含一部分展示逻辑 | 被动视图，只实现 Presenter 需要的接口 | 声明式模板，声明和状态的绑定关系 |
| 例子 | 后端 Web 框架、早期的 Backbone | 早期 Android 开发中常见的写法 | Vue、Knockout，以及 MVVM 的发源地 WPF |

MVC 的变体很多，各个框架里的 Controller 含义也不完全一样，面试时讲清职责划分和数据流向即可。经典 MVC 中 View 观察 Model 用的是[观察者模式](/basics/design-pattern/02-observer-pubsub)。

### 同一个功能：MVP 和 MVVM 的写法对比

一个城市搜索框，输入关键字后过滤列表。MVP 风格要手动在 View 和数据之间同步：

```js
// Model：数据和业务逻辑
const model = {
  cities: ['北京', '上海', '广州', '深圳'],
  filter: (keyword) => model.cities.filter((city) => city.includes(keyword)),
}

// View：只负责 DOM，对外提供接口
const view = {
  input: document.querySelector('#keyword'),
  list: document.querySelector('#list'),
  onInput(handler) {
    view.input.addEventListener('input', (e) => handler(e.target.value))
  },
  renderList(items) {
    view.list.replaceChildren(...items.map((text) => Object.assign(document.createElement('li'), { textContent: text })))
  },
}

// Presenter：监听 View 的事件，读取 Model，再手动更新 View
view.onInput((keyword) => view.renderList(model.filter(keyword)))
view.renderList(model.cities)
```

MVVM 风格（Vue）只需要声明状态和绑定关系，同步交给框架：

```vue
<script setup>
import { ref, computed } from 'vue'

const cities = ['北京', '上海', '广州', '深圳'] // Model
const keyword = ref('')                         // ViewModel 的状态
const filtered = computed(() => cities.filter((city) => city.includes(keyword.value)))
</script>

<template>
  <!-- View：声明绑定关系，不需要手动操作 DOM -->
  <input v-model="keyword" placeholder="搜索城市">
  <ul>
    <li v-for="city in filtered" :key="city">{{ city }}</li>
  </ul>
</template>
```

Vue 的组件实例扮演了 ViewModel：插值和 `v-bind` 把状态同步到视图，`v-model` 和事件把用户输入写回状态，背后靠的是[响应式系统](/basics/vue/01-reactivity)。Vue 2 的文档提到它的设计部分受到 MVVM 的启发，所以习惯用 `vm` 指代组件实例。

### React：单向数据流

React 的定位是构建界面的库，不规定 MVC、MVVM 这类整体架构。它的核心是 `UI = f(state)`：状态通过 props 从上往下传，用户操作通过回调修改状态，再触发重新渲染。React 没有内置双向绑定，受控组件要自己写 `value` 和 `onChange`。Redux 这类状态管理库把单向数据流扩展到整个应用：派发 action，由 reducer 计算出新状态，视图根据新状态渲染。和 Vue 的对比见 [React 和 Vue 的区别](/basics/react/10-react-vs-vue)。

### 后端 MVC 和前端 MVVM

| | 后端 MVC（如 Express 路由 + 模板引擎） | 前端 MVVM（如 Vue） |
| --- | --- | --- |
| 运行在哪里 | 服务端 | 浏览器 |
| 生命周期 | 一次请求：路由交给 Controller，查询 Model，渲染模板，返回 HTML，结束 | 长期运行，状态常驻内存，持续响应用户操作 |
| View | 模板引擎渲染出的 HTML 字符串 | 响应式模板，按需更新局部 DOM |
| 数据变化后 | 要发新的请求，重新渲染整个页面 | 状态变化自动更新对应的界面 |

```js
// Express 中的 MVC：Controller 处理请求，调用 Model，选择 View 渲染
app.get('/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id) // Model：查询数据
  res.render('user', { user })                    // View：模板引擎渲染出 HTML
})
```

前后端分离之后，后端的 Controller 通常直接返回 JSON，View 交给了前端；Nuxt、Next.js 这类服务端渲染框架又让两者在同一个项目里协作。

## 面试官可能追问

::: details Vue 是严格意义上的 MVVM 吗？
不是严格的。MVVM 要求 ViewModel 不知道 View 的存在，而 Vue 允许通过模板 ref 直接操作 DOM；单文件组件也把 View（模板）和 ViewModel（脚本）写在了一起。Vue 的文档也只说设计上受到 MVVM 的启发。可以说 Vue 在组件层面借鉴了 MVVM 的数据绑定思想。
:::

::: details 双向绑定和单向数据流矛盾吗？
不矛盾，说的是两个层面。双向绑定发生在一个组件内部，是状态和表单元素之间的同步；组件之间的数据流仍然是单向的：父组件通过 props 传给子组件，子组件通过事件通知父组件修改。组件上的 `v-model` 也只是 prop 加事件的语法糖，见 [v-model 的原理](/basics/vue/12-v-model)。
:::

::: details 为什么 MVP 和 MVVM 比 MVC 更容易测试？
测试的难点在 DOM。MVP 的 Presenter 只通过接口操作 View，测试时传入一个假的 View 对象，断言它被如何调用即可；MVVM 的 ViewModel 只管理状态，测试时直接修改状态、检查计算结果，不需要渲染界面。Vue 中的组合式函数、Pinia 的 store 都可以脱离组件单独测试。
:::

## 易错点

- MVVM 的双向绑定指 View 和 ViewModel 之间，不是组件和组件之间
- React 不是 MVVM 框架，它只负责视图层，靠单向数据流和重新渲染更新界面
- 后端 MVC 的 View 是模板渲染出的 HTML，和前端组件的概念不同，不要混为一谈
