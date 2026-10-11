---
difficulty: 2
tags: [高频]
---

# Composition API 和 Options API 有什么区别？

::: tip 一句话回答
核心区别在**代码组织**和**逻辑复用**。Options API 按 `data`、`methods`、`computed` 等选项组织代码，同一个功能的代码分散在多处，复用靠 mixins；Composition API 按逻辑关注点组织，相关代码放在一起，并通过**组合式函数**复用逻辑，来源清晰、没有命名冲突。此外它的类型推导更好，对代码压缩也更友好。Options API 并没有被废弃，两者可以共存。
:::

## 详细解析

### 对比

| | Options API | Composition API |
| --- | --- | --- |
| 代码组织 | 按选项组织，一个功能的代码分散在 `data`、`methods`、`computed`、`watch` 等多处 | 按逻辑关注点组织，相关代码放在一起 |
| 逻辑复用 | mixins | 组合式函数（composable） |
| 访问状态 | 通过 `this` | 直接使用变量和函数 |
| 类型推导 | 依赖 `this`，推导比较复杂 | 都是普通变量和函数，几乎不需要额外的类型标注 |
| 代码压缩 | `this.xxx` 这样的属性名不能被压缩 | `<script setup>` 中的变量名可以被压缩 |
| 适合 | 小型项目、简单组件 | 逻辑复杂、需要复用逻辑的组件 |

### mixins 的问题

- **来源不清晰**：模板里用到的属性可能来自任何一个 mixin，只能逐个翻找
- **命名冲突**：多个 mixin 或 mixin 和组件定义了同名的属性、方法时，会按合并规则互相覆盖，很难发现
- **隐式依赖**：mixin 可能依赖组件或其他 mixin 里的某个属性，这种依赖只能靠约定维持，修改时容易出错

### 组合式函数

同样是"跟踪鼠标位置"的逻辑，用 mixin 写，代码被拆到了四个选项里：

```js
// mixins/mouse.js
export default {
  data() {
    return { x: 0, y: 0 }
  },
  mounted() {
    window.addEventListener('mousemove', this.update)
  },
  unmounted() {
    window.removeEventListener('mousemove', this.update)
  },
  methods: {
    update(e) {
      this.x = e.clientX
      this.y = e.clientY
    },
  },
}
```

用组合式函数写，相关代码都在一个函数里：

```js
// composables/useMouse.js
import { ref, onMounted, onUnmounted } from 'vue'

export function useMouse() {
  const x = ref(0)
  const y = ref(0)

  const update = (e) => {
    x.value = e.clientX
    y.value = e.clientY
  }

  // 副作用在函数内部管理：挂载时监听，卸载时移除
  onMounted(() => window.addEventListener('mousemove', update))
  onUnmounted(() => window.removeEventListener('mousemove', update))

  // 返回由 ref 组成的普通对象，调用方解构后仍然是响应式的
  return { x, y }
}
```

```vue
<script setup>
import { useMouse } from './composables/useMouse'

// x、y 从哪里来一目了然，重名时也可以改名
const { x, y } = useMouse()
</script>

<template>
  <p>鼠标位置：{{ x }}, {{ y }}</p>
</template>
```

编写组合式函数的约定：

- 以 `use` 开头命名
- 返回由 ref 组成的普通对象，而不是 reactive 对象，这样解构后仍然保持响应性
- 在 `<script setup>` 或 `setup()` 中同步调用，内部的生命周期钩子、`watch` 才能关联到当前组件
- 有副作用（事件监听、定时器）时，在内部用 `onUnmounted` 等钩子清理
- 它就是普通函数，可以接收参数；参数可能是 ref 或 getter 时，内部用 `toValue()` 统一取值（Vue 3.3 起）

## 面试官可能追问

::: details 组合式函数和 mixin 的本质区别是什么？
mixin 是在组件选项层面做合并：它的 `data`、`methods` 被混入组件，大家共享同一个 `this`，彼此之间只能靠属性名隐式关联。组合式函数是普通的函数调用：输入是参数，输出是返回值，组件显式地拿到返回的状态，可以重命名，也可以把一个组合式函数的返回值传给另一个。前者靠隐式合并，后者靠显式的调用和返回值。
:::

::: details 组合式函数和 React Hooks 有什么不同？
最大的区别是执行次数。React 函数组件每次渲染都会重新执行，Hooks 也跟着重新调用；Vue 的 `setup` 只执行一次，之后靠响应式系统驱动更新。因此：

- 不存在"过期闭包"的问题，见 [闭包](/basics/javascript/02-closure)
- 依赖由响应式系统自动收集，不需要手写依赖数组
- 不需要 `useMemo`、`useCallback` 这类手动优化
- 不受调用顺序限制，可以写在条件语句里
:::

::: details VueUse 是什么？
一个基于 Composition API 的工具函数库，提供了大量现成的组合式函数，比如 `useMouse`、`useStorage`、`useEventListener`、`useDebounceFn`、`useIntersectionObserver`，覆盖浏览器 API、传感器、状态管理、动画等场景，可以按需引入。它的源码也是学习怎么写组合式函数的好参考。
:::

## 易错点

- Options API 没有被废弃，小型项目、简单组件用它完全可以；两者还能在同一个组件中共存，比如在选项式组件里通过 `setup()` 选项使用 Composition API
- `<script setup>` 只是 Composition API 的编译时语法糖，不等于 Composition API 本身，见 [`<script setup>` 有什么特点](/basics/vue/20-script-setup)
- 组合式函数如果返回 reactive 对象，调用方一解构就会丢失响应性
