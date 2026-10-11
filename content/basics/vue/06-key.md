---
difficulty: 2
tags: [高频]
---

# key 有什么作用？为什么不建议用 index 作为 key？

::: tip 一句话回答
`key` 是虚拟节点的唯一标识。diff 时 Vue 根据"**类型相同且 key 相同**"判断新旧节点是不是同一个，从而决定复用、移动还是重新创建。用 index 作 key 时，在列表头部或中间增删、或者重新排序后，同一个 index 对应的数据变了，元素会被错误复用：子组件的状态、输入框里的内容会错位，还会多出不必要的 DOM 更新。应该用数据中**稳定且唯一的 id** 作 key。
:::

## 详细解析

### key 的作用

Vue 判断新旧两个虚拟节点是否"相同"，条件是类型和 key 都相同（源码中的 `isSameVNodeType`）。相同就复用对应的真实 DOM，只更新有变化的部分；不同就卸载旧的、创建新的。详见 [虚拟 DOM 和 diff 算法](/basics/vue/07-vdom-diff)。

- **有 key**：Vue 能认出"这是同一个元素，只是换了位置"，于是移动 DOM，而不是重新创建
- **没有 key**：Vue 采用"就地更新"策略，按位置一一比较，复用同一位置上的元素，只更新其中的内容

### 用 index 作 key 的问题

下面每个列表项都有一个没有绑定数据的输入框：

```vue
<script setup>
import { ref } from 'vue'

let nextId = 3
const list = ref([
  { id: 1, name: '张三' },
  { id: 2, name: '李四' },
])

function addFirst() {
  list.value.unshift({ id: nextId++, name: '王五' })
}
</script>

<template>
  <button @click="addFirst">在头部插入</button>
  <ul>
    <!-- ❌ 用 index 作 key -->
    <li v-for="(item, index) in list" :key="index">
      {{ item.name }}：<input />
    </li>
  </ul>
</template>
```

在张三、李四的输入框里分别输入 a、b，再点击按钮：

- 新列表是王五、张三、李四，key 依次是 0、1、2。Vue 认为 key 为 0、1 的元素还是原来那两个，直接复用，只把文字从"张三、李四"改成"王五、张三"；key 为 2 的元素被当作新元素创建
- 输入框里已经输入的内容、复选框的勾选状态都是 DOM 自身的状态，跟着元素走，结果变成"王五：a、张三：b、李四：空"，内容错位了。带有内部状态的子组件也会出现同样的问题
- 改成 `:key="item.id"` 后，Vue 能认出张三、李四只是位置后移，只需在头部插入一个新元素，结果是"王五：空、张三：a、李四：b"。用 index 时两个已有元素的文字都被更新了一遍，DOM 操作也更多

### 正确的做法

- 用数据中稳定且唯一的 id，比如数据库主键
- 数据确实没有 id 时，在拿到数据时生成一次并存进数据里，不要在渲染时生成
- 不要用 `Math.random()` 这类每次都变的值，否则每次渲染都会重新创建所有元素

### key 的其他用法

**强制重新创建组件**：key 变化时，Vue 会卸载旧组件、创建新组件，可以用来重置组件状态：

```vue
<template>
  <!-- 切换用户时，表单组件整体重建，之前填写的内容被清空 -->
  <UserForm :key="userId" :user-id="userId" />
</template>
```

**`<template v-for>` 的 key**：Vue 3 中写在 `<template>` 标签上，而不是里面的子元素上：

```vue
<template>
  <dl>
    <template v-for="item in list" :key="item.id">
      <dt>{{ item.term }}</dt>
      <dd>{{ item.desc }}</dd>
    </template>
  </dl>
</template>
```

## 面试官可能追问

::: details 只用来展示、不会增删和排序的静态列表可以用 index 吗？
可以。列表顺序不变时，index 和数据始终一一对应，不会出现错误复用。问题只出在增删、排序这类会改变顺序的操作上。
:::

::: details 为什么不能用随机数作 key？
每次重新渲染，key 都会变成新的随机数，新旧节点的 key 永远对不上，Vue 只能卸载所有旧元素、再全部重新创建。这样性能很差，输入框内容、组件状态和焦点也都会丢失。key 必须在多次渲染之间保持稳定。
:::

::: details 同级元素的 key 重复会怎样？
开发环境下，Vue 在 diff 时发现重复的 key 会给出警告；渲染结果也可能出错，比如元素被错误复用、更新错位。key 只要求在同一个父元素的子节点之间唯一，不同列表之间可以重复。
:::

## 易错点

- key 只需要在**同级**节点之间唯一，不需要全局唯一
- 用 index 作 key 的问题只出现在顺序会变化的列表上，不是所有场景都不能用
- Vue 3 中 `<template v-for>` 的 key 要写在 `<template>` 上
