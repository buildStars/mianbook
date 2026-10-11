---
difficulty: 2
tags: [高频, 原理]
---

# v-model 的原理是什么？组件上怎么实现？

::: tip 一句话回答
`v-model` 是**语法糖**，本质是"绑定一个值 + 监听一个事件"。用在原生表单元素上时，按元素类型绑定 `value` 或 `checked`，监听 `input` 或 `change` 事件；用在组件上时，Vue 3 默认展开为 `modelValue` 属性和 `update:modelValue` 事件。Vue 3.4 起推荐用 `defineModel()` 实现组件的 `v-model`，它返回一个 ref，修改时自动通知父组件。
:::

## 详细解析

### 原生表单元素

| 元素 | 绑定的属性 | 监听的事件 |
| --- | --- | --- |
| 文本类 `input`、`textarea` | `value` | `input` |
| `checkbox`、`radio` | `checked` | `change` |
| `select` | `value` | `change` |

编译后，原生元素上的 `v-model` 由 `vModelText`、`vModelCheckbox` 等运行时指令完成绑定，同时处理修饰符和输入法这些细节：

- **`.lazy`**：改为在 `change` 事件后同步（比如输入框失去焦点时），而不是每次输入都同步
- **`.number`**：用 `parseFloat` 把输入转成数字，转换失败时保留原字符串；`type="number"` 的输入框会自动这样处理
- **`.trim`**：自动去掉首尾空格
- **输入法**：用中文等输入法打字时，从 `compositionstart` 到 `compositionend` 之间（还在输入拼音、挑选候选词），`v-model` 不会更新数据，选定文字后才同步

### 组件上的 `v-model`

```vue-html
<SearchInput v-model="keyword" />
<!-- 相当于 -->
<SearchInput :modelValue="keyword" @update:modelValue="(v) => (keyword = v)" />
```

这个展开发生在父组件编译时，子组件要自己声明 `modelValue` 属性和 `update:modelValue` 事件。

| | Vue 2 | Vue 3 |
| --- | --- | --- |
| 默认展开为 | `value` 属性 + `input` 事件 | `modelValue` 属性 + `update:modelValue` 事件 |
| 绑定多个值 | 只能有一个 `v-model`，其他属性用 `.sync` 修饰符 | 可以写多个 `v-model:xxx`，`.sync` 被移除 |
| 自定义修饰符 | 不支持 | 子组件通过 `modelModifiers` 属性拿到 |

- **多个 `v-model`**：`v-model:title="title"` 展开为 `title` 属性和 `update:title` 事件
- **自定义修饰符**：父组件写 `v-model.uppercase="code"`，子组件会收到 `modelModifiers: { uppercase: true }`；带参数时属性名是"参数名 + Modifiers"，如 `titleModifiers`
- **`defineModel()`**：Vue 3.4 起推荐的写法。它返回一个 ref，读取时得到父组件传入的值，赋值时自动触发对应的 `update` 事件；编译时还会自动声明对应的属性和事件。`defineModel('title')` 对应 `v-model:title`

### 不违背单向数据流

子组件并没有直接修改父组件的数据，只是通过事件**请求**父组件修改。真正修改数据的是父组件中的监听函数，新值再通过 props 传回子组件，数据仍然是从父到子流动的，详见 [组件通信方式](/basics/vue/04-component-communication)。

## 代码示例

同一个输入框组件的两种写法，父组件都用 `<SearchInput v-model="keyword" />`：

```vue
<!-- 写法一：手写 props + emit -->
<script setup>
defineProps(['modelValue'])
const emit = defineEmits(['update:modelValue'])
</script>

<template>
  <input
    :value="modelValue"
    @input="emit('update:modelValue', $event.target.value)"
  />
</template>
```

```vue
<!-- 写法二：Vue 3.4+ 使用 defineModel -->
<script setup>
const model = defineModel()
</script>

<template>
  <input v-model="model" />
</template>
```

## 面试官可能追问

::: details `v-model` 和单向数据流矛盾吗？
不矛盾。`v-model` 只是把"传值"和"监听更新事件"合在一起写，子组件不能修改 props，只能发出事件，改不改、怎么改由父组件决定。`defineModel` 也一样：给它返回的 ref 赋值，实际是发出 `update:modelValue` 事件，等父组件更新数据后，新值再通过 props 传下来。
:::

::: details 父组件没有使用 `v-model` 时，`defineModel` 返回的 ref 会怎样？
它可以作为组件的本地状态使用：赋值时直接更新组件内部保存的值，界面照常响应（事件照样会发出，只是没人监听）。判断依据是父组件有没有同时传入对应的属性和更新事件的监听。这样同一个组件既可以由父组件控制，也可以单独使用。
:::

::: details 如何实现支持自定义修饰符的 `v-model`？
用 `defineModel` 时，从返回值中解构出第二项拿到修饰符，再在 `set` 选项中处理要发给父组件的值：

```js
// 父组件：<CodeInput v-model.uppercase="code" />
const [model, modifiers] = defineModel({
  set(value) {
    // set 的返回值才是真正发给父组件的值
    return modifiers.uppercase ? value.toUpperCase() : value
  },
})
```

不用 `defineModel` 时，声明一个 `modelModifiers` 属性（默认值为空对象），在 emit 之前根据它处理值即可。
:::

## 易错点

- 子组件不能直接修改 `modelValue` 这个 prop，要通过 emit 或 `defineModel` 返回的 ref 来更新
- 给 `defineModel` 设置了 `default`，而父组件没有传值时，子组件用的是默认值，父组件的变量仍是 `undefined`，两边会不同步
- 组合输入期间 `v-model` 的值不变是有意的设计；需要实时拿到输入内容（比如做联想提示）时，自己绑定 `:value` 和 `@input`
