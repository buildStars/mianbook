---
difficulty: 1
tags: [高频]
---

# Vue 自定义指令怎么写？有哪些钩子和使用场景？

::: tip 一句话回答
自定义指令是一个包含**生命周期钩子**的对象，用来复用**直接操作 DOM** 的逻辑。Vue 3 的钩子和组件生命周期对齐：`created`、`beforeMount`、`mounted`、`beforeUpdate`、`updated`、`beforeUnmount`、`unmounted`，每个钩子拿到 `el` 和 `binding`（`value`、`arg`、`modifiers` 等）。可以用 `app.directive` 全局注册，也可以在 `<script setup>` 里用 `v` 开头的变量局部注册。常见场景是自动聚焦、图片懒加载、一键复制、防重复点击。
:::

## 详细解析

### 什么时候用指令

能用组件或组合式函数解决的，优先用它们。指令适合"逻辑很薄、只针对某个元素做 DOM 操作"的场景，比如聚焦、监听元素可见、绑定原生事件。写成指令后，任何元素加个属性就能用。

### 钩子和 Vue 2 的对应

| Vue 3 | Vue 2 | 时机 |
| --- | --- | --- |
| `created` | 无 | 元素的属性和事件监听器应用之前 |
| `beforeMount` | `bind` | 指令第一次绑定到元素，元素还没插入 DOM |
| `mounted` | `inserted` | 元素插入父节点后，可以安全地读尺寸、调 `focus` |
| `beforeUpdate` | 无（Vue 2 的 `update` 已移除） | 所在组件更新前 |
| `updated` | `componentUpdated` | 所在组件及子组件更新后 |
| `beforeUnmount` | 无 | 元素卸载前 |
| `unmounted` | `unbind` | 元素卸载后，在这里清理监听器、定时器 |

Vue 3 改名是为了和组件生命周期统一，记一套就够了。

### binding 里有什么

以 `v-copy:title.once="text"` 为例：

- `value`：`text` 的值；`oldValue` 是上一次的值，只在 `beforeUpdate` 和 `updated` 里有
- `arg`：`'title'`，冒号后面的参数，也可以写成动态的 `v-copy:[name]`
- `modifiers`：`{ once: true }`
- `instance`：使用指令的组件实例

只关心 `mounted` 和 `updated` 并且逻辑一样时，可以直接传一个函数作为简写。

### 注册方式

- 全局：`app.directive('focus', { mounted: (el) => el.focus() })`
- `<script setup>` 局部：变量名以 `v` 开头的驼峰形式，如 `vFocus`，模板里直接写 `v-focus`
- Options API 局部：写在 `directives` 选项里

权限控制也常写成指令（没有权限就移除元素），和路由守卫配合的做法见 [导航守卫](/basics/vue/16-router-guards)。

## 代码示例

```ts
import type { Directive } from 'vue'

// 防重复点击：点击后一段时间内忽略后续点击
export const vThrottleClick: Directive<HTMLElement, () => void> = {
  mounted(el, binding) {
    const delay = Number(binding.arg) || 1000
    let locked = false
    const handler = () => {
      if (locked) return
      locked = true
      binding.value()
      setTimeout(() => (locked = false), delay)
    }
    ;(el as any)._throttleHandler = handler
    el.addEventListener('click', handler)
  },
  unmounted(el) {
    // 一定要清理，否则元素卸载后监听器还挂着
    el.removeEventListener('click', (el as any)._throttleHandler)
  },
}

// 图片懒加载：进入视口才设置 src
export const vLazy: Directive<HTMLImageElement, string> = {
  mounted(el, binding) {
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        el.src = binding.value
        io.disconnect()
      }
    })
    io.observe(el)
  },
}
```

```vue
<button v-throttle-click:2000="submit">提交</button>
<img v-lazy="item.cover" />
```

`vLazy` 只是演示，实际要在 `unmounted` 里也调用 `disconnect`，并在 `updated` 里处理地址变化。原生的 `loading="lazy"` 能满足时直接用原生的，见 [懒加载](/basics/browser/12-lazy-loading)。

## 面试官可能追问

::: details 指令用在组件上会怎样？
指令会作用在组件的根元素上。组件有多个根节点时，Vue 会给出警告，指令不会生效。所以指令最好只用在原生元素上，组件需要类似能力就通过 props 或暴露方法实现。
:::

::: details 钩子之间怎么共享数据？
钩子函数之间没有 `this`。常见做法是挂在 `el` 上（如上面的 `_throttleHandler`），或者用一个以 `el` 为键的 `WeakMap` 保存，元素被回收时数据也跟着回收。
:::

::: details 指令和组合式函数怎么选？
组合式函数复用的是有状态的逻辑，能返回响应式数据给组件用；指令只能拿到元素，适合纯 DOM 操作。比如"监听元素尺寸并返回宽高"适合写成组合式函数，"元素出现时自动聚焦"适合写成指令。
:::

## 易错点

- 在 `beforeMount` 里调用 `el.focus()` 没效果，元素还没插入文档，要放在 `mounted`
- 在 `mounted` 里绑定的事件、观察器、定时器，忘了在 `unmounted` 清理，造成内存泄漏
- 局部注册时变量没用 `v` 开头，模板里写 `v-xxx` 会找不到指令
