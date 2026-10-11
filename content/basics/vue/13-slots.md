---
difficulty: 1
tags: [高频]
---

# Vue 的插槽有哪些？作用域插槽怎么用？

::: tip 一句话回答
插槽让父组件向子组件传入一段**模板内容**，由子组件决定渲染在哪里。常用的有**默认插槽**、**具名插槽**和**作用域插槽**。插槽内容在父组件中编译，只能访问父组件的数据；需要用到子组件的数据时，子组件在 `<slot>` 上绑定属性把数据传出来，父组件用 `v-slot` 接收，这就是作用域插槽，常用于列表、表格这类让使用者自定义渲染的通用组件。
:::

## 详细解析

### 插槽的种类

| 类型 | 子组件中 | 父组件中 |
| --- | --- | --- |
| 默认插槽 | `<slot></slot>` | 直接写在组件标签之间 |
| 具名插槽 | `<slot name="header"></slot>` | `<template v-slot:header>`，缩写为 `<template #header>` |
| 作用域插槽 | `<slot :item="item"></slot>` | `v-slot="slotProps"`，或者解构 `#default="{ item }"` |

- **后备内容**：写在 `<slot>` 标签之间的内容，父组件没有提供插槽内容时显示
- **动态插槽名**：`<template #[slotName]>`，插槽名取自一个变量
- **判断插槽是否传入**：模板中用 `$slots.footer`，`<script setup>` 中用 `useSlots()` 获取插槽对象；传入的插槽是一个函数，没有传入就是 `undefined`

### 渲染作用域

插槽内容写在父组件的模板里，也在父组件中编译，所以它**只能访问父组件的数据**，访问不到子组件内部的变量。要用到子组件的数据（比如列表中的每一项），就要由子组件通过作用域插槽把数据传出来。

可以把作用域插槽看成父组件传给子组件的一个**函数**：子组件调用它时把数据作为参数传入，函数返回要渲染的内容。Vue 3 中所有插槽在内部都统一成了函数，`this.$slots.header()` 返回 VNode 数组；Vue 2 把作用域插槽单独放在 `$scopedSlots` 中，Vue 3 移除了 `$scopedSlots`。

### 典型应用

- **通用列表、表格**：组件负责数据加载、分页、排序等逻辑，使用者通过作用域插槽决定每一行、每一列怎么显示。Element Plus 表格列的自定义内容就是这样实现的
- **无渲染组件**：组件自身不渲染任何 UI，只提供逻辑和数据，通过作用域插槽交给使用者渲染。现在很多场景可以用组合式函数代替

## 代码示例

子组件 TodoList.vue：

```vue
<script setup>
defineProps({
  todos: { type: Array, required: true },
})
</script>

<template>
  <ul v-if="todos.length">
    <li v-for="(todo, index) in todos" :key="todo.id">
      <!-- 把当前项和下标作为插槽 props 传给父组件 -->
      <slot :todo="todo" :index="index">
        <!-- 后备内容 -->
        {{ todo.text }}
      </slot>
    </li>
  </ul>
  <div v-else class="empty">
    <slot name="empty">暂无数据</slot>
  </div>
</template>
```

父组件：

```vue
<script setup>
import { ref } from 'vue'
import TodoList from './TodoList.vue'

const todos = ref([
  { id: 1, text: '复习插槽', done: true },
  { id: 2, text: '封装表格组件', done: false },
])
</script>

<template>
  <TodoList :todos="todos">
    <!-- 解构子组件传出来的 todo 和 index -->
    <template #default="{ todo, index }">
      <span :class="{ done: todo.done }">{{ index + 1 }}. {{ todo.text }}</span>
    </template>
    <template #empty>今天没有待办</template>
  </TodoList>
</template>
```

## 面试官可能追问

::: details 插槽内容能直接访问子组件的数据吗？
不能。插槽内容定义在父组件的模板里，编译后属于父组件的渲染作用域，只能访问父组件的数据。子组件的数据要通过作用域插槽显式传出来，父组件再用 `v-slot` 接收。
:::

::: details 如何判断某个插槽有没有被传入？
模板中用 `$slots` 判断，例如 `<footer v-if="$slots.footer">`，父组件没有传入时连外层的包裹元素也不渲染，避免出现一个空的 footer；`<script setup>` 中用 `useSlots()`。插槽函数存在不代表一定能渲染出内容，比如插槽里的元素全被 `v-if` 隐藏时，`$slots.footer` 依然存在。
:::

::: details 作用域插槽和组合式函数怎么选？
只需要复用逻辑（如请求状态、鼠标位置）时，优先用组合式函数：更灵活，也不会多出一层组件实例。需要把逻辑和一部分 UI 结构一起复用，同时让使用者定制局部渲染时，用组件加作用域插槽，比如表格组件负责表头和分页，单元格怎么显示由使用者决定。组合式函数详见 [Composition API 和 Options API 的区别](/basics/vue/11-composition-api)。
:::

## 易错点

- 同时用到默认作用域插槽和具名插槽时，默认插槽也要写成 `<template #default="...">`，不能把 `v-slot` 直接写在组件标签上，否则会编译报错
- `v-slot` 只能用在 `<template>` 上；只有默认插槽时，才可以直接写在组件标签上
- `<slot>` 上的 `name` 属性是保留的，不会出现在插槽 props 中
