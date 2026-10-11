---
difficulty: 1
tags: [高频]
---

# Vue 组件之间有哪些通信方式？

::: tip 一句话回答
按组件关系来选：**父子**之间用 props 向下传数据、`emit` 向上发事件，需要双向绑定时用 `v-model`；**跨层级**用 provide / inject；**全局共享**的状态用 Pinia。另外还有模板 ref、`$attrs` 透传、作用域插槽等方式。Vue 3 移除了 `$on`，事件总线可以用 mitt 实现，但数据流向难以追踪，不推荐大量使用。
:::

## 详细解析

### 父子组件

- **props（父 → 子）**：单向数据流。父组件的数据更新后会流向子组件，子组件不能直接修改 props，否则开发环境会警告。对象类型的 props，修改它内部的属性不会报警告，但同样应该避免
- **emit（子 → 父）**：子组件用 `defineEmits` 声明事件，通过 `emit('change', value)` 触发，父组件用 `@change` 监听
- **v-model（双向绑定）**：本质是一个 prop 加一个 `update:xxx` 事件，详见 [v-model 的原理](/basics/vue/12-v-model)
- **模板 ref（父调用子）**：父组件通过 `ref` 拿到子组件实例，调用它的方法。使用 `<script setup>` 的组件默认不对外暴露任何东西，需要用 `defineExpose` 指定，详见 [`<script setup>` 有什么特点](/basics/vue/20-script-setup)
- **作用域插槽**：子组件把数据传给父组件提供的插槽内容，由父组件决定怎么渲染，详见 [Vue 的插槽](/basics/vue/13-slots)

### 透传属性：$attrs

父组件传入、但子组件没有声明为 props 或 emits 的属性和事件监听器（包括 `class` 和 `style`）会放进 `$attrs`，默认自动绑定到子组件的根元素上。组合式 API 中用 `useAttrs()` 获取。封装组件时，可以设置 `inheritAttrs: false`，再用 `v-bind="$attrs"` 把它们绑定到指定的内部元素上。

### 跨层级：provide / inject

祖先组件用 `provide` 提供数据，任意层级的后代组件用 `inject` 注入，中间的组件不用逐层传 props。

- 提供 ref 或 reactive 对象，注入方拿到的才是响应式的
- 把修改数据的方法一起提供出去，后代组件调用方法修改，而不是直接改数据；可以用 `readonly` 包装数据来保证这一点
- 大型项目建议用 `Symbol` 作为 key，避免重名

```vue
<!-- 祖先组件 -->
<script setup>
import { ref, provide, readonly } from 'vue'

const theme = ref('light')

function toggleTheme() {
  theme.value = theme.value === 'light' ? 'dark' : 'light'
}

// 数据用 readonly 包装，后代组件只能通过 toggleTheme 修改
provide('theme', {
  theme: readonly(theme),
  toggleTheme,
})
</script>
```

```vue
<!-- 任意层级的后代组件 -->
<script setup>
import { inject } from 'vue'

const { theme, toggleTheme } = inject('theme')
</script>

<template>
  <button @click="toggleTheme">当前主题：{{ theme }}</button>
</template>
```

### 全局状态及其他方式

- **Pinia**：任意组件都能读写同一个 store，状态变化可以在 Vue DevTools 中追踪。适合用户信息、购物车这类多处共享的数据，详见 [Pinia 和 Vuex 的区别](/basics/vue/17-pinia)
- **事件总线**：Vue 3 移除了 `$on` / `$off`，不能再拿一个 Vue 实例当事件中心，可以用 mitt 这类库，通过 `on` 订阅、`emit` 触发、`off` 取消。它让任意组件之间都能通信，但事件从哪里发出、被谁监听很难追踪，还要记得在组件卸载时取消订阅，只适合少量简单的场景
- **路由参数、浏览器存储**：路由的 query、params 适合在页面之间传少量数据；localStorage 等适合需要持久化的数据
- **`$parent` / `$root`**：能直接访问父组件或根组件的实例，但组件之间耦合严重，不推荐。Vue 3 移除了 `$children`，访问子组件要用模板 ref

### 怎么选

| 组件关系 | 推荐方式 |
| --- | --- |
| 父 → 子 | props |
| 子 → 父 | `emit` 事件 |
| 父子双向绑定 | `v-model` |
| 父组件调用子组件的方法 | 模板 ref + `defineExpose` |
| 封装组件时透传属性和事件 | `$attrs` / `useAttrs()` |
| 子组件提供数据、父组件决定怎么渲染 | 作用域插槽 |
| 兄弟组件 | 通过共同的父组件中转，或者用 Pinia |
| 祖先 → 后代（跨多层） | provide / inject |
| 任意组件之间、全局共享状态 | Pinia |
| 页面之间 | 路由参数、浏览器存储 |

## 面试官可能追问

::: details 为什么 props 是单向数据流？
为了让数据的流向可以预测：数据只由拥有它的组件修改，出了问题只要看这个组件。如果子组件能随意改 props，多个子组件共享同一份数据时，很难追踪是谁改的。子组件想修改时，用 `emit` 通知父组件去改；只是想用 props 当初始值，就复制到自己的 ref 里；需要转换格式，就用 computed 派生。
:::

::: details provide / inject 怎样保持响应式？
`provide` 的如果是普通值（比如 `count.value`），注入方拿到的只是那一刻的值，之后不会更新。要保持响应式，就提供 ref 或 reactive 对象本身。同时建议把修改数据的方法一起提供出去，并用 `readonly` 包装数据，保证所有修改都发生在提供方，数据流向才清晰。
:::

::: details 兄弟组件之间怎么通信？
最常用的是通过共同的父组件中转：A 用 `emit` 通知父组件，父组件修改状态，再通过 props 传给 B，也就是把状态提升到父组件。层级较深或多处都要用时，改用 Pinia。事件总线也能做到，但数据流向难以追踪，不推荐。
:::

## 易错点

- 子组件不能直接修改 props；对象类型的 props 改内部属性虽然不报警告，也不应该这么做
- `provide` 一个 `.value` 或解构出来的普通值，会丢失响应性
- 使用 `<script setup>` 的子组件，父组件通过 ref 拿不到它的方法，除非用 `defineExpose` 暴露
