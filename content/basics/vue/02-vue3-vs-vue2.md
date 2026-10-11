---
difficulty: 1
tags: [高频, 综合]
---

# Vue 3 相比 Vue 2 有哪些变化？

::: tip 一句话回答
核心变化有四点：响应式改用 **Proxy**；新增 **Composition API**，逻辑复用从 mixins 变成组合式函数；**编译优化**和更好的 **tree-shaking** 让运行更快、打包更小；源码用 **TypeScript** 重写，类型支持更好。另外新增了 Fragment、Teleport、Suspense 等特性，也有 `createApp`、移除 `$on` 和过滤器、`v-if` 优先级高于 `v-for` 等破坏性变化。
:::

## 详细解析

### 主要变化一览

| 方面 | Vue 2 | Vue 3 |
| --- | --- | --- |
| 响应式 | `Object.defineProperty`，检测不到属性的新增、删除和通过下标修改数组 | `Proxy`，都能检测 |
| 代码组织 | Options API | 新增 Composition API，Options API 仍可使用 |
| 逻辑复用 | mixins | 组合式函数（composable） |
| 全局 API | 挂在 `Vue` 上，无法 tree-shaking | 改为按需导入，没用到的不会被打包 |
| TypeScript | 支持较弱 | 源码用 TS 重写，类型推导完善 |
| 创建应用 | `new Vue()`，全局配置直接修改 `Vue` | `createApp()` 创建独立的应用实例 |
| 根节点 | 组件只能有一个根节点 | 可以有多个根节点（Fragment） |
| 组件上的 `v-model` | `value` + `input` 事件，其他属性用 `.sync` | `modelValue` + `update:modelValue`，可以绑定多个 |
| `v-if` 和 `v-for` 写在同一元素上 | `v-for` 优先级更高 | `v-if` 优先级更高 |
| 卸载阶段的钩子 | `beforeDestroy` / `destroyed` | `beforeUnmount` / `unmounted` |
| `$listeners` | 单独存在 | 合并进 `$attrs` |
| `$on` / `$off` / `$once` | 支持 | 移除，需要事件总线时用 mitt 等库 |
| 过滤器（filters） | 支持 | 移除，用方法或计算属性代替 |

`v-if` 与 `v-for` 的优先级见 [v-if 和 v-show 有什么区别](/basics/vue/05-v-if-v-show)，生命周期的变化见 [Vue 的生命周期](/basics/vue/03-lifecycle)。

### 为什么更快、更小

- **响应式**：`Proxy` 代理整个对象，嵌套对象在被访问时才转换，初始化时不用递归遍历所有属性，详见 [Vue 3 的响应式原理](/basics/vue/01-reactivity)
- **编译优化**：编译器给动态节点打上标记并把它们收集起来，更新时跳过静态内容，详见 [Vue 3 在编译阶段做了哪些优化](/basics/vue/08-compiler-optimization)
- **diff 算法**：Vue 2 对子节点列表做双端比较，Vue 3 对乱序部分求最长递增子序列，移动 DOM 的次数更少，详见 [虚拟 DOM 和 diff 算法](/basics/vue/07-vdom-diff)
- **tree-shaking**：Vue 2 的 `Vue.nextTick` 这类 API 都挂在 `Vue` 对象上，打包工具无法判断有没有用到，只能全部打包。Vue 3 改成 `import { nextTick } from 'vue'` 这样的具名导出，`Transition`、`KeepAlive` 等内置组件也是按需引入，没用到的功能不会进入最终产物

### 开发方式

- **Composition API**：按逻辑关注点组织代码，用组合式函数代替 mixins 复用逻辑，数据来源清晰、没有命名冲突，详见 [Composition API 和 Options API 的区别](/basics/vue/11-composition-api)
- **TypeScript**：Composition API 基本是普通的变量和函数，类型可以自然推导，不再依赖 `this` 上复杂的类型声明

### 新增的特性

- **Fragment**：组件可以有多个根节点。这时 `$attrs` 不会自动绑定到根元素上，需要手动写 `v-bind="$attrs"`
- **Teleport**：把一部分模板渲染到组件外的 DOM 节点上，比如 `<Teleport to="body">`。常用于弹窗，避免受父元素的 `transform`、层叠上下文等样式影响
- **Suspense**：在异步组件或异步 `setup` 完成之前显示后备内容，**目前仍是实验性功能**
- **多个 `v-model`**：例如 `v-model:title="title"`，取代了 `.sync` 修饰符，详见 [v-model 的原理](/basics/vue/12-v-model)
- **`emits` 选项**：声明组件会触发哪些事件。没有声明的事件监听器会被当作透传属性，绑定到根元素上
- **`<script setup>`**：Composition API 的编译时语法糖，写法更简洁，详见 [`<script setup>` 有什么特点](/basics/vue/20-script-setup)

### 用 createApp 创建应用

Vue 2 的全局 API 直接修改 `Vue` 构造函数，注册的组件、插件会影响所有实例，同一页面上的多个应用之间、测试用例之间都会互相污染。Vue 3 把这些配置挂在应用实例上：

```js
// Vue 2
import Vue from 'vue'
import App from './App.vue'
import BaseButton from './components/BaseButton.vue'

Vue.component('BaseButton', BaseButton) // 影响所有实例
new Vue({ render: (h) => h(App) }).$mount('#app')
```

```js
// Vue 3
import { createApp } from 'vue'
import App from './App.vue'
import BaseButton from './components/BaseButton.vue'

const app = createApp(App)
app.component('BaseButton', BaseButton) // 只对这个应用生效
app.mount('#app')
```

### 维护状态

Vue 2 已于 2023 年 12 月 31 日停止维护，官方不再发布更新和安全修复。新项目应该直接使用 Vue 3。

## 面试官可能追问

::: details Vue 2 项目迁移到 Vue 3 要注意什么？
- 先确认依赖是否支持 Vue 3：Vue Router 要升级到 4，Vuex 升级到 4 或换成 Pinia，UI 组件库也要换成对应的 Vue 3 版本
- 对照官方迁移指南，逐项处理上面表格里的破坏性变化
- 可以借助 `@vue/compat`（迁移构建）逐步迁移：它在 Vue 3 上模拟大部分 Vue 2 的行为，并对用到的废弃特性给出警告，可以边运行边逐个修复，全部修完后再移除
- Vue 3 不支持 IE11，必须兼容 IE 的项目没法升级
:::

::: details 为什么移除事件总线？
Vue 3 的组件实例不再实现 `$on`、`$off`、`$once` 这套事件接口，`$emit` 只用来通知父组件。事件总线让任意组件之间都能隐式通信，项目变大后很难追踪事件是谁触发的、被谁监听；忘记取消监听还会造成内存泄漏。官方推荐用 props / emit、provide / inject 或 Pinia 代替，确实需要时可以用 mitt 这类小型库，见 [组件通信方式](/basics/vue/04-component-communication)。
:::

::: details Vue 2.7 有什么特别之处？
Vue 2.7 是 Vue 2 的最后一个次版本，它把 Composition API 和 `<script setup>` 向后移植到了 Vue 2。老项目可以先在 Vue 2 中用上新写法，降低以后迁移到 Vue 3 的成本。它的响应式仍然基于 `Object.defineProperty`，Vue 2 原有的限制依然存在。
:::

## 易错点

- Options API 没有被废弃，Vue 3 中仍然可以使用，也可以和 Composition API 混用
- `v-if` 和 `v-for` 的优先级在两个版本中正好相反
- Suspense 目前仍是实验性功能，不要说成稳定特性
