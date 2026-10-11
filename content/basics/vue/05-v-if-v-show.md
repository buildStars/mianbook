---
difficulty: 1
tags: [高频]
---

# v-if 和 v-show 有什么区别？能和 v-for 一起用吗？

::: tip 一句话回答
`v-if` 是真正的条件渲染：条件为假时元素和组件根本不会渲染，切换时会销毁和重建；`v-show` 不管条件如何都会渲染，只是切换 CSS 的 `display`。所以**频繁切换用 `v-show`**，**条件很少改变或初始多为假时用 `v-if`**。不建议把 `v-if` 和 `v-for` 写在同一个元素上：Vue 3 中 `v-if` 的优先级更高，条件里访问不到循环变量。
:::

## 详细解析

### 区别

| | `v-if` | `v-show` |
| --- | --- | --- |
| 原理 | 条件为假时不渲染，DOM 中不存在 | 总会渲染，切换 `display: none` |
| 切换时 | 销毁和重建，触发组件的挂载、卸载钩子，内部状态丢失 | 只改样式，组件一直保持挂载，状态保留 |
| 初始条件为假 | 惰性，什么都不做 | 照样渲染，只是隐藏 |
| 切换开销 | 高 | 低 |
| 初始渲染开销 | 条件为假时没有开销 | 总要渲染，开销更高 |
| 用在 `<template>` 上 | 可以 | 不可以 |
| 配合 `v-else` | 可以 | 不可以 |
| 适用场景 | 条件很少改变，或者初始多为假 | 需要频繁切换 |

从编译结果看，`v-if` 会变成三元表达式，条件为假时只渲染一个注释节点占位；`v-show` 会变成 `vShow` 指令，在运行时修改元素的 `style.display`。

### 基本用法

```vue
<template>
  <!-- v-else-if、v-else 必须紧跟在 v-if 或 v-else-if 元素的后面 -->
  <p v-if="score >= 90">优秀</p>
  <p v-else-if="score >= 60">及格</p>
  <p v-else>不及格</p>

  <!-- v-if 可以用在 template 标签上，一次控制多个元素，template 本身不会渲染 -->
  <template v-if="isLoggedIn">
    <UserAvatar />
    <UserMenu />
  </template>

  <!-- 频繁切换的面板用 v-show -->
  <div v-show="panelOpen" class="panel">筛选条件</div>
</template>
```

### 能和 v-for 一起用吗

Vue 3 中，同一个元素上 `v-if` 的优先级高于 `v-for`。`v-if` 先求值，这时循环变量还不存在：

```vue
<template>
  <!-- ❌ v-if 先执行，此时还没有 user，访问 user.active 会报错 -->
  <li v-for="user in users" v-if="user.active" :key="user.id">
    {{ user.name }}
  </li>
</template>
```

Vue 2 正好相反，`v-for` 的优先级更高。那样写虽然能访问循环变量，但每次重新渲染都要遍历整个列表再逐个判断。所以无论哪个版本，官方都不推荐把两者写在同一个元素上，按需求改写：

```vue
<script setup>
import { ref, computed } from 'vue'

const users = ref([
  { id: 1, name: '张三', active: true },
  { id: 2, name: '李四', active: false },
])
const showList = ref(true)

// 需要过滤列表：用计算属性，结果会被缓存
const activeUsers = computed(() => users.value.filter((u) => u.active))
</script>

<template>
  <ul>
    <li v-for="user in activeUsers" :key="user.id">{{ user.name }}</li>
  </ul>

  <!-- 需要整体控制列表是否显示：在外层套一个带 v-if 的 template -->
  <ul>
    <template v-if="showList">
      <li v-for="user in users" :key="user.id">{{ user.name }}</li>
    </template>
  </ul>
</template>
```

## 面试官可能追问

::: details 频繁打开关闭的弹窗用哪个？
看弹窗的轻重和是否要保留状态。组件比较重、又希望保留里面的状态（比如表单里已经填写的内容）时，用 `v-show`，或者用 `v-if` 配合 `<KeepAlive>` 缓存组件实例。弹窗很简单、每次打开都希望是初始状态时，用 `v-if` 更合适，关闭后组件被销毁，不占内存。如果弹窗很少被打开，用 `v-if` 还能省掉首次渲染的开销。
:::

::: details v-if 切换会让组件状态丢失吗？
会。条件变为假时组件被卸载，内部的响应式状态、输入框里的内容都会被丢弃；条件再变为真时组件重新创建，`setup` 和挂载钩子重新执行，一切从初始状态开始。需要保留状态时，用 `v-show` 或 `<KeepAlive>`。反过来，也可以利用这一点来重置组件。
:::

::: details v-show 初始为 false 时，组件会被创建吗？
会。`v-show` 只控制 `display`，组件在初次渲染时就被创建和挂载，`setup`、`onMounted` 照常执行，里面的请求也会发出；之后切换显示和隐藏都不会再触发挂载、卸载钩子。要在"显示时"做事，就 watch 控制显示的变量。图表这类依赖尺寸的组件要特别注意：在隐藏状态下初始化，拿到的宽高是 0，显示后要手动调用 resize；初始隐藏又很重的组件，可以改用 `v-if`，推迟到第一次显示时再创建。
:::


## 易错点

- `v-show` 不能用在 `<template>` 上，也不能配合 `v-else`
- `v-else`、`v-else-if` 必须紧跟在 `v-if` 或 `v-else-if` 元素后面，中间不能隔着其他元素
- Vue 2 和 Vue 3 中 `v-if` 与 `v-for` 的优先级正好相反
