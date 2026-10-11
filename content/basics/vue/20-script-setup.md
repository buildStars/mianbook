---
difficulty: 1
tags: [高频, 新特性]
---

# `<script setup>` 有什么特点？编译宏怎么用？

::: tip 一句话回答
`<script setup>` 是在单文件组件中使用组合式 API 的**编译时语法糖**。顶层声明的变量、函数和导入的组件都可以直接在模板中使用，不用写 `setup()` 和 `return`，代码更简洁；模板会被编译成和这些变量处于同一作用域的渲染函数，运行时性能更好；对 TypeScript 的支持也更好。`defineProps`、`defineEmits`、`defineExpose` 等是**编译宏**，不需要导入，编译后会被替换掉。
:::

## 详细解析

### 特点

- **更简洁**：顶层的变量、函数，以及 `import` 进来的组件和工具函数，都能直接在模板中使用；导入的组件不需要注册
- **性能更好**：生产构建时，模板被编译成内联在 `setup` 作用域中的渲染函数，直接访问变量，不需要经过组件实例的代理
- **更好的 TypeScript 支持**：props 和 emits 可以直接用类型声明，类型推导更准确
- **每个实例执行一次**：其中的代码会被编译成组件 `setup()` 函数的内容，每创建一个组件实例就执行一次；而普通 `<script>` 中的代码只在模块第一次被导入时执行一次

### 编译宏

| 宏 | 作用 |
| --- | --- |
| `defineProps` | 声明 props，可以传运行时的选项对象，也可以用 TS 类型声明 |
| `withDefaults` | 配合类型声明的 `defineProps` 设置默认值 |
| `defineEmits` | 声明事件，返回 `emit` 函数，同样支持类型声明 |
| `defineModel` | Vue 3.4 起，声明一个双向绑定的 prop，详见 [`v-model` 的原理](/basics/vue/12-v-model) |
| `defineExpose` | 显式暴露属性和方法，供父组件通过模板 ref 访问 |
| `defineOptions` | Vue 3.3 起，声明 `name`、`inheritAttrs` 等组件选项 |
| `defineSlots` | Vue 3.3 起，为插槽的名字和插槽 props 提供类型，用于 TS |

在 TS 中声明 props 和 emits：

```ts
// 写法一：类型声明 + withDefaults 设置默认值
const props = withDefaults(defineProps<{ size?: string; disabled?: boolean }>(), {
  size: 'small',
  disabled: false,
})

// 写法二（Vue 3.5 起）：响应式解构，默认值直接写在解构中。一个组件只能调用一次 defineProps，二选一
const { size = 'small', disabled = false } = defineProps<{ size?: string; disabled?: boolean }>()

// 用类型声明事件（具名元组的写法需要 Vue 3.3+）
const emit = defineEmits<{ change: [value: string]; close: [] }>()
```

### 其他要点

- **`useSlots()` / `useAttrs()`**：在 `<script setup>` 中获取插槽和透传属性；模板中可以直接用 `$slots`、`$attrs`
- **和普通 `<script>` 一起使用**：普通 `<script>` 用来放只需执行一次的模块级代码、具名导出，或者在 Vue 3.3 之前声明 `inheritAttrs` 等选项。两个块的 `lang` 要保持一致
- **顶层 `await`**：可以直接在顶层使用 `await`，这时 `setup` 会变成 async 函数，组件需要配合 `<Suspense>` 使用

## 代码示例

子组件 Counter.vue：

```vue
<script setup>
import { ref } from 'vue'

const props = defineProps({ step: { type: Number, default: 1 } })
const emit = defineEmits(['change'])

const count = ref(0)

function increase() {
  count.value += props.step
  emit('change', count.value)
}

function reset() {
  count.value = 0
}

// 只暴露 reset，父组件访问不到 count 和 increase
defineExpose({ reset })
</script>

<template>
  <button @click="increase">count: {{ count }}</button>
</template>
```

父组件：

```vue
<script setup>
import { ref } from 'vue'
import Counter from './Counter.vue'

// 变量名和模板中的 ref="counterRef" 一致，挂载后就能拿到子组件暴露的内容（Vue 3.5 起也可以用 useTemplateRef）
const counterRef = ref(null)

function onChange(value) {
  console.log('当前计数：', value)
}

function resetCounter() {
  counterRef.value?.reset()
}
</script>

<template>
  <Counter ref="counterRef" :step="2" @change="onChange" />
  <button @click="resetCounter">重置</button>
</template>
```

## 面试官可能追问

::: details 为什么父组件通过 ref 拿不到子组件的方法？
使用 `<script setup>` 的组件默认是"关闭"的：通过模板 ref 或 `$parent` 拿到的组件实例上，访问不到 `<script setup>` 中声明的任何变量和方法。这样做是为了封装，避免父组件依赖子组件的内部实现。需要给父组件调用的方法，要用 `defineExpose` 显式暴露；暴露出去的 ref 在父组件中访问时会自动解包。另外，模板 ref 要等子组件挂载后才有值，在 `setup` 中直接访问是 `null`。
:::

::: details 为什么编译宏不需要 import？
它们不是运行时函数，而是由编译器在编译阶段识别和处理的：`defineProps`、`defineEmits` 会变成组件的 `props`、`emits` 选项，`defineExpose` 会变成对 `setup` 上下文中 `expose()` 的调用，编译后的代码里不再有这些宏。所以它们只能在 `<script setup>` 中使用。也正因为参数会被提升到 `setup()` 外面，传给 `defineProps` 等宏的参数一般不能引用 `<script setup>` 中声明的局部变量，引用导入的变量是可以的。
:::

::: details Vue 3.5 的 props 解构有什么要注意的？
解构出来的变量看起来是普通变量，实际上编译器会把对它的访问改写成 `props.xxx`，所以在模板和 `computed` 中都能保持响应性。但直接把它传给 `watch`，相当于传入了一个普通值，无法监听，要包成 getter：`watch(() => count, ...)`，直接传入时编译器会报错。传给组合式函数时也一样，要传 getter，组合式函数内部用 `toValue()` 读取。
:::

## 易错点

- 编译宏只能在 `<script setup>` 的顶层调用，写在函数里不会被编译器处理；它们也不需要导入
- 父组件想调用子组件的方法，子组件必须用 `defineExpose` 暴露，而且要在子组件挂载之后才能调用
- 使用了顶层 `await` 的组件必须放在 `<Suspense>` 下面，否则不会被渲染
