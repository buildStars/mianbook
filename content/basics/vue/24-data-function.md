---
difficulty: 1
tags: [高频]
---

# Vue 组件的 data 为什么必须是函数？

::: tip 一句话回答
因为组件是**模板**，会被创建很多个实例。`data` 写成对象，所有实例拿到的是**同一个对象的引用**，改一个，其他的跟着变。写成函数，每创建一个实例就调用一次，**返回一个新对象**，数据互相隔离。Vue 2 的根实例只创建一次，所以允许写对象；Vue 3 统一要求写函数。组合式 API 里 `setup` 本来就是每个实例调用一次，天然不存在这个问题。
:::

## 详细解析

### 问题出在引用共享

组件的选项对象（包括 `data`）只定义一次，但组件可以在页面上用很多次。如果 `data` 是对象，每个实例初始化时都指向它：

```js
const options = { data: { count: 0 } }

// 模拟创建两个实例
const a = { $data: options.data }
const b = { $data: options.data }

a.$data.count++
console.log(b.$data.count) // 1，b 也被改了
```

写成函数后，每个实例调用一次，拿到各自的对象：

```js
const options = { data: () => ({ count: 0 }) }

const a = { $data: options.data() }
const b = { $data: options.data() }

a.$data.count++
console.log(b.$data.count) // 0，互不影响
```

这和 JS 里"对象是引用类型"是同一个道理，Vue 只是用工厂函数解决了它。

### 为什么根实例可以是对象

Vue 2 里 `new Vue({ data: {...} })` 的根实例整个应用只创建一次，不存在共享的问题，所以允许写对象。组件里写对象，Vue 2 会在开发环境报警告，并且不会使用它。

Vue 3 去掉了这个特例：无论是 `createApp` 的根组件还是普通组件，Options API 的 `data` 都只接受函数。规则更统一，不用再记哪里可以写对象。

### 组合式 API 为什么没这个问题

```vue
<script setup>
import { ref } from 'vue'

// 这段代码每个组件实例都会执行一次，count 天然是各自的
const count = ref(0)
</script>
```

`setup` 本身就是一个函数，每个实例执行一次，里面声明的变量都是这次调用独有的，作用和 `data` 函数一样。

反过来，**写在模块顶层**（`setup` 外面，或者普通 `<script>` 里）的状态，是所有实例共享的，因为模块只执行一次。有时候会故意这样做，实现简单的全局状态；不想共享时就要小心。

## 面试官可能追问

::: details data 函数里能访问 props 吗？
可以。Vue 初始化时先处理 props，再调用 `data`，所以 `data` 里能用 `this.xxx` 读 props 作为初始值。Vue 3 还会把实例代理作为第一个参数传进来，箭头函数里没有 `this` 时可以用它。只是初始值，props 后续变化不会同步过来。
:::

::: details Pinia 的 state 为什么也要写成函数？
道理一样。SSR 时每个请求都要有一份独立的 store 状态，写成函数才能为每次请求创建新对象，避免用户之间的数据串掉。见 [Pinia](/basics/vue/17-pinia)。
:::

::: details data 返回的对象之后新增属性会是响应式的吗？
Vue 3 里会，因为整个对象被 Proxy 代理，新增属性也能被拦截。Vue 2 里不会，需要 `$set`，原因见 [Vue 2 的 $set](/basics/vue/26-vue2-set)。不过最好还是在 `data` 里把字段都声明出来，代码更好读。
:::

## 易错点

- 写成 `data() { return obj }`，返回的是外部定义的同一个对象，依然共享，函数形式只是表面上满足了要求
- 以为根实例在 Vue 3 也能写对象；Vue 3 里 `data` 一律要求函数
- 把 `<script setup>` 外的模块级变量当成每个实例独有的，结果多个实例共享了状态
