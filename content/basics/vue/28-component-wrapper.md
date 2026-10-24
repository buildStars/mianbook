---
difficulty: 2
tags: [实践, 高频]
---

# 怎么二次封装一个组件库的组件？属性、事件、插槽和实例方法怎么透传？

::: tip 一句话回答
封装的目标是**加业务默认值，同时不丢原组件的能力**。属性和事件用 `inheritAttrs: false` 加 `v-bind="$attrs"` 绑到内部组件上（Vue 3 里事件监听器也在 `$attrs` 里）；插槽遍历 `$slots`，用动态插槽名逐个转发，作用域插槽的参数原样传下去；`v-model` 用 `defineModel` 转发；实例方法用 `defineExpose` 暴露内部组件的方法。只声明自己真正要改的 props，其余全部透传。
:::

## 详细解析

### 典型场景

业务里常给组件库的表格、表单、弹窗包一层：表格统一加边框、分页和加载状态，弹窗统一按钮文字和关闭逻辑。难点在于使用方仍然希望用原组件的全部属性、事件、插槽和方法，封装层不能变成"只开放了一半功能"的瓶颈。

### 属性和事件：$attrs

- 父组件传进来、没有被声明为 props 或 emits 的东西都在 `$attrs` 里，包括 `class`、`style` 和 `onXxx` 形式的事件监听器。Vue 2 里需要单独的 `$listeners`，Vue 3 已经合并
- 封装组件的根节点往往是一个外层 `div`，默认透传会落到这个 `div` 上。所以要 `defineOptions({ inheritAttrs: false })` 关掉自动继承，再把 `v-bind="$attrs"` 绑到内部组件上
- 多根节点的组件没有自动透传，不显式绑定 `$attrs` 会有警告
- 封装层自己声明了的 props 和 emits 会被"消费"掉，不再往下传。想既拦截又转发，就要自己手动传下去

`$attrs` 的概念在 [组件通信](/basics/vue/04-component-communication) 里讲过，这里只讲封装时怎么用。

### 插槽：遍历 $slots 转发

组件库组件的插槽往往很多，逐个写 `<template #xxx>` 既啰嗦又会漏。常见做法是遍历 `$slots`，用动态插槽名转发，作用域插槽的参数用 `v-bind` 原样传下去。官方文档没有专门讲这种写法，它是社区惯用法，由动态插槽名和作用域插槽组合而成。只转发使用方真正传了的插槽，没传的插槽内部组件会照常显示自己的默认内容。

### v-model 和实例方法

- `v-model`：内部组件也是 `v-model` 时，用 `defineModel()` 拿到一个 ref，直接 `v-model="model"` 绑下去；或者声明 `modelValue` prop 再手动 emit `update:modelValue`
- 实例方法：`<script setup>` 组件默认对外是关闭的，父组件拿不到内部表格的 `clearSelection` 这类方法。用模板 ref 拿到内部组件，再 `defineExpose` 暴露出去。方法多时，可以暴露一个 Proxy，把访问统一转发给内部实例
- 类型：从原组件提取 props 类型复用，比如 `InstanceType<typeof ElTable>['$props']`，封装组件的 props 用它做交叉，使用方也能拿到完整提示

## 代码示例

封装一个带默认边框和加载状态的表格（以 Element Plus 的 `ElTable` 为例，写法对其他组件库一样）：

```vue
<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { ElTable } from 'element-plus'

defineOptions({ inheritAttrs: false })
defineProps<{ loading?: boolean }>()

const tableRef = useTemplateRef<InstanceType<typeof ElTable>>('table')

// 只挑常用的方法暴露；要全部转发可以改成 Proxy
defineExpose({
  clearSelection: () => tableRef.value?.clearSelection(),
  getTable: () => tableRef.value,
})
</script>

<template>
  <div v-loading="loading" class="biz-table">
    <!-- 业务默认值写在前面，使用方传的同名属性会覆盖它 -->
    <ElTable ref="table" border stripe v-bind="$attrs">
      <template v-for="(_, name) in $slots" #[name]="slotProps">
        <slot :name="name" v-bind="slotProps || {}" />
      </template>
    </ElTable>
  </div>
</template>
```

用一个简化版的"内部表格"在 Node.js 里做服务端渲染验证过：使用方传的 `id`、`class` 落到了内部表格上而不是外层 `div`，`@row-click` 监听器也传到了内部组件，`#header="{ title }"` 和 `#default="{ row }"` 这类作用域插槽拿到了内部组件给的参数。

## 面试官可能追问

::: details 为什么 slotProps 要写成 slotProps || {}？
默认插槽之外的普通插槽，内部组件调用时可能不传参数，`slotProps` 是 `undefined`。`v-bind` 一个 `undefined` 虽然多数情况下没问题，写成 `|| {}` 更稳妥，也让意图更清楚。
:::

::: details 封装层想改一个属性的默认值，又想让使用方能覆盖，怎么写？
在内部组件上先写默认值，再写 `v-bind="$attrs"`，后面的会覆盖前面的。也可以把这个属性声明成封装层的 prop 并给默认值，再显式传下去，这样还能在封装层拿来做逻辑判断。
:::

::: details 为什么不把原组件的所有 props 都重新声明一遍？
维护成本高：组件库升级加了新属性，封装层不跟着改就用不了。重新声明还会让这些属性被"消费"，不再走 `$attrs`，漏传一个就是 bug。封装层只声明自己要用来做逻辑的属性，其余交给透传。
:::

::: details 用 Proxy 转发实例方法有什么要注意的？
Proxy 的 get 里去读内部组件实例的同名属性，要处理组件还没挂载、实例是 `null` 的情况。方法要绑定 `this` 到内部实例，否则组件库内部用到 `this` 的方法会出错。它也会让类型变得不精确，需要自己补类型声明。
:::

## 易错点

- 只写了 `v-bind="$attrs"` 却没关 `inheritAttrs`，属性在外层 `div` 和内部组件上各出现一次
- 封装层声明了 `emits: ['change']`，却忘了手动 emit，使用方的 `@change` 就再也收不到
- 转发插槽时漏写 `v-bind="slotProps"`，使用方的作用域插槽拿不到 `row` 之类的参数
- 用 `defineExpose` 暴露 `tableRef.value` 本身，挂载前它是 `null`，父组件立刻调用会报错
