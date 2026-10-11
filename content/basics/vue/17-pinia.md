---
difficulty: 1
tags: [高频]
---

# Pinia 和 Vuex 有什么区别？

::: tip 一句话回答
Pinia 是 Vue 官方推荐的状态管理库，Vuex 已进入维护模式。相比 Vuex，Pinia **去掉了 mutations**，在 actions 中直接修改状态，同步、异步都可以；**没有嵌套的 modules**，每个 store 都是独立的，按需引入；有**完整的 TypeScript 类型推导**，还支持组合式 API 风格的 setup store。整体 API 更简洁，体积也更小。
:::

## 详细解析

### 对比

| | Vuex | Pinia |
| --- | --- | --- |
| 修改状态 | 必须提交 mutation（只能同步），异步逻辑写在 action 中，再由它提交 mutation | 没有 mutation，可以直接修改 state，也可以在 action 中修改，同步、异步都可以 |
| 模块化 | 一个全局 store，通过嵌套的 modules 拆分，经常要处理命名空间 | 多个扁平、独立的 store，用到哪个引入哪个，天然支持代码分割 |
| TypeScript | 类型推导较弱，需要不少手动声明 | 完整的类型推导，基本不用手写类型 |
| 定义 store 的写法 | 选项式 | 选项式（option store）和组合式（setup store） |
| 在组件中使用 | `this.$store` 或 `useStore()`，配合 `mapState` 等辅助函数 | 直接调用 `useXxxStore()` |
| DevTools | 支持 | 支持 |
| 现状 | 维护模式，不再增加新功能 | 官方推荐 |

Vuex 规定只能通过同步的 mutation 修改状态，主要是为了让 DevTools 能记录每一次状态变化。Pinia 不需要 mutation 也能被 DevTools 追踪，所以去掉了这一层。

### 定义 store

- **option store**：`defineStore('cart', { state, getters, actions })`，写法和 Vuex、选项式 API 类似
- **setup store**：`defineStore('cart', () => { ... })`，其中 `ref` 就是 state，`computed` 就是 getters，普通函数就是 actions，最后把它们 return 出去

### 常用 API

- `storeToRefs(store)`：解构 state 和 getters 时保持响应性；actions 可以直接从 store 中解构
- `store.$patch()`：批量修改状态，可以传一个对象，也可以传一个函数（适合往数组中添加元素这类操作）
- `store.$reset()`：把 state 重置为初始值。option store 自带，setup store 需要自己实现
- `store.$subscribe()`：订阅 state 的变化，比如把状态同步到 localStorage
- **插件**：通过 `pinia.use()` 给所有 store 扩展功能，比如持久化插件 pinia-plugin-persistedstate

### 注意事项

- 在组件外（如路由守卫、请求拦截器）使用 store 时，要确保 `app.use(pinia)` 已经执行。所以要在函数内部调用 `useXxxStore()`，不要在模块顶层调用
- SSR 中每个请求都要创建新的 pinia 实例，避免多个请求共享同一份状态，详见 [Vue 的 SSR 和水合](/basics/vue/18-ssr-hydration)

## 代码示例

```js
// stores/cart.js：setup store
import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { submitOrder } from '@/api/order'

export const useCartStore = defineStore('cart', () => {
  const items = ref([]) // state

  // getters
  const totalPrice = computed(() => {
    return items.value.reduce((sum, item) => sum + item.price * item.count, 0)
  })

  // actions：直接修改状态，同步、异步都可以
  function addItem(product) {
    const item = items.value.find((i) => i.id === product.id)
    if (item) item.count++
    else items.value.push({ ...product, count: 1 })
  }

  async function checkout() {
    await submitOrder(items.value)
    items.value = []
  }

  // setup store 没有内置的 $reset，需要时自己实现
  function $reset() {
    items.value = []
  }

  // 所有 state 都要 return，否则 DevTools、SSR 和插件都无法正常工作
  return { items, totalPrice, addItem, checkout, $reset }
})
```

```vue
<script setup>
import { storeToRefs } from 'pinia'
import { useCartStore } from '@/stores/cart'

const cart = useCartStore()

// ❌ const { totalPrice } = cart  拿到的只是一个普通数字，之后不会再更新
// ✅ state 和 getters 用 storeToRefs 解构，得到的是 ref
const { items, totalPrice } = storeToRefs(cart)
// actions 可以直接解构
const { addItem } = cart
</script>

<template>
  <p>共 {{ items.length }} 种商品，合计 {{ totalPrice }} 元</p>
  <button @click="addItem({ id: 1, name: '键盘', price: 199 })">加入购物车</button>
</template>
```

## 面试官可能追问

::: details 为什么直接解构 store 会丢失响应性？
store 本身是一个 reactive 对象，state 和 getters 是它的属性（其中的 ref 会被自动解包）。解构就是把属性当前的值读出来赋给普通变量，之后访问这个变量不再经过 Proxy，和解构 reactive 对象是同一个问题，详见 [Vue 3 的响应式原理](/basics/vue/01-reactivity)。`storeToRefs` 只为 state 和 getters 创建 ref，会跳过 actions；actions 是绑定在 store 上的函数，直接解构也能正常调用。
:::

::: details 什么时候需要全局状态管理？
多个没有直接父子关系的组件需要共享、修改同一份数据时，比如当前登录的用户、购物车、全局配置。只是父子组件之间传数据，用 props 和 emit 就够了；跨几层组件传递，可以用 provide / inject，详见 [组件通信方式](/basics/vue/04-component-communication)。只有一个页面用到的状态，也不必放进全局 store。
:::

::: details 如何持久化 store？
- 手动实现：创建 store 时从 localStorage 读取初始值，再用 `$subscribe` 在状态变化时写回
- 使用插件：安装 pinia-plugin-persistedstate 后，在 store 的选项中加上 `persist: true`（setup store 写在 `defineStore` 的第三个参数中），还可以配置存储位置和需要持久化的字段
- token 这类敏感数据放在 localStorage 中，有被 XSS 攻击读取的风险，详见 [XSS 和 CSRF](/basics/browser/06-xss-csrf)
:::

## 易错点

- 直接解构 store 会丢失响应性，state 和 getters 要用 `storeToRefs` 解构
- setup store 必须 return 所有 state，不能有"私有"的 state，否则 SSR、DevTools 和插件都会出问题
- setup store 没有内置的 `$reset()`，要用的话需要自己实现
