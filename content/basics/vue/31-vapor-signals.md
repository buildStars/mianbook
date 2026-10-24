---
difficulty: 3
tags: [新技术, 原理]
---

# Vue 的 Vapor Mode 是什么？它和"信号（Signals）"有什么关系？

::: tip 一句话回答
Vapor Mode 是 Vue 单文件组件的一种**新编译模式**：编译器把模板直接编译成创建和更新真实 DOM 的代码，响应式数据变化时只执行绑定到它的那一小段更新，**不再生成和比对虚拟 DOM**，运行时更小、更快。它依赖的正是**细粒度响应式**，也就是现在常说的"信号"：Vue 的 `ref`、`computed`、`watchEffect` 本质上就是信号这一类原语。Vapor Mode 目前还处于预发布阶段，正式发布前写法可能调整。
:::

## 详细解析

### 虚拟 DOM 的成本

组件状态变化时，虚拟 DOM 模式要重新执行渲染函数，生成新的 VNode 树，再和旧树比对，找出要改的 DOM。Vue 3 在编译期做了很多优化，比如补丁标记、Block Tree、静态提升，让比对只看动态节点，见 [Vue 3 在编译阶段做了哪些优化？](/basics/vue/08-compiler-optimization)。但"创建 VNode、比对"这一步仍然存在，组件越大，每次更新的固定开销越多。diff 算法本身见 [什么是虚拟 DOM？](/basics/vue/07-vdom-diff)。

### Vapor Mode 怎么做

模板在编译期就知道哪里是静态结构、哪里绑定了哪个数据。Vapor 编译器直接生成两部分代码：

1. **创建**：直接创建出 DOM 结构，并保存需要更新的节点引用
2. **更新**：为每个动态绑定建立一个响应式副作用，比如"`count` 变了就改这个文本节点"

```text
虚拟 DOM：count 变化 → 组件重新渲染 → 新 VNode 树 → diff → 改一个文本节点
Vapor：  count 变化 → 触发绑定它的那个副作用 → 改一个文本节点
```

更新粒度从"组件"变成了"绑定"，不需要 VNode，也不需要 diff，内存占用和运行时体积都更小。Vue 团队在发布说明里称，第三方基准测试中它的性能和 Solid、Svelte 5 在同一水平。

### 怎么用、有哪些限制

按目前 GitHub 发布说明里的写法，在单文件组件上加 `vapor` 标记开启：

```vue
<script setup vapor>
import { ref } from 'vue'
const count = ref(0)
</script>

<template>
  <button @click="count++">{{ count }}</button>
</template>
```

- 只支持 `<script setup>` 和只有模板的组件，**不支持 Options API**
- 可以和虚拟 DOM 组件混用：普通应用里安装互操作插件 `vaporInteropPlugin` 就能使用 Vapor 组件；整个应用都用 Vapor 时用 `createVaporApp` 创建，不打包虚拟 DOM 运行时，体积优势最大
- 依赖 VNode 或组件实例代理的功能不可用，例如 `getCurrentInstance()` 返回 `null`、`app.config.globalProperties`、`v-memo`；自定义指令的接口也不同
- 官方建议按区域划分：一块区域只用一种模式，适合先在性能敏感的页面局部采用

官方网站目前还没有 Vapor 的使用文档，信息来自 GitHub 的发布说明，正式发布前写法和限制都可能调整。

### 信号是什么

信号（Signals）是细粒度响应式原语的通用叫法，通常包含三样东西：

| 概念 | Vue | 其他实现中概念上类似的 |
| --- | --- | --- |
| 可读写的值，读取时追踪依赖 | `ref()` / `shallowRef()` | Solid 的 `createSignal`、Angular 和 Preact 的 `signal` |
| 由其他信号派生、带缓存的值 | `computed()` | Solid 的 `createMemo`、Angular 和 Preact 的 `computed` |
| 自动追踪依赖、变化时重新执行的副作用 | `watchEffect()` | Solid 的 `createEffect`、Angular 和 Preact 的 `effect` |

Vue 官方文档也明确说过，信号和 Vue 的 `ref` 是同一类原语，这种范式并不新，早年的 Knockout 就是这样。各家的差别主要在 API 风格：Vue 和 Preact 用 `.value` 读写，Solid 和 Angular 用函数调用读取。

TC39 也有一个 Signals 标准化提案，目前处于 **Stage 1**，草案里有 `Signal.State`、`Signal.Computed` 和面向框架作者的底层 API，离进入语言还很远。

### 两者的关系

Vapor Mode 能成立，前提是响应式系统本身是细粒度的：一个 `ref` 变化，能精确找到依赖它的那几个副作用。Vue 一直有这套能力，只是过去把副作用的粒度放在"组件渲染函数"上，再用虚拟 DOM 找出具体改动；Vapor 把粒度缩小到每个 DOM 绑定。

同一时期 Vue 的响应式核心也在重构：下一个小版本的预发布版移植了 alien-signals 的推拉结合算法，目标是提升性能、降低内存，对外 API 不变。对开发者来说，`ref`、`computed`、`watch` 的写法基本不变，主要变化是组件可以选择用哪种模式编译。响应式本身的原理见 [Vue 3 的响应式原理是什么？](/basics/vue/01-reactivity)。

## 面试官可能追问

::: details 有了 Vapor Mode，虚拟 DOM 会被淘汰吗？
不会马上淘汰。渲染函数和 JSX 写的组件始终是虚拟 DOM 组件，大量组件库也依赖 VNode。Vapor 是需要主动开启的另一种编译模式，两者可以在同一个应用里共存，官方的建议也是局部采用。
:::

::: details 既然 ref 就是信号，Vue 以前为什么还需要虚拟 DOM？
响应式系统只告诉你"哪个组件要更新"，组件内部改哪个 DOM 由虚拟 DOM 比对得出。这样渲染函数可以写任意 JavaScript，灵活性高。Vapor 只能处理模板，因为模板结构在编译期可分析，才能直接生成细粒度的更新代码。
:::

::: details Vapor 组件里为什么不能用 getCurrentInstance 和 v-memo？
`v-memo` 的作用是跳过 VNode 子树的比对，没有 VNode 也就没有意义。Vapor 组件没有传统的组件实例代理，`getCurrentInstance()` 返回 `null`，依赖实例上 `$el`、`$attrs` 这类属性的写法也不能用。
:::

::: details TC39 Signals 提案通过后，Vue 会改用原生信号吗？
目前没有官方说法。提案还在 Stage 1，API 还可能变化。它的定位是给框架提供共享的底层原语，即使进入标准，开发者大概率还是通过框架的 `ref` 这类 API 使用。
:::

## 易错点

- 把 Vapor Mode 说成已经正式发布、可以全面替换，实际还处于预发布阶段
- 以为开启 Vapor 后 Options API 也能用，它只支持 `<script setup>` 和纯模板组件
- 把"信号"当成一种新的响应式原理，其实它和 Vue 的 `ref` 是同一类东西，新的是不经过虚拟 DOM 的渲染方式
