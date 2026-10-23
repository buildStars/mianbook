---
difficulty: 2
tags: [原理, 高频]
---

# Nuxt 里怎么共享状态？useState 和 Pinia 怎么选？为什么不能在模块顶层定义 ref？

::: tip 一句话回答
Nuxt 内置 **`useState(key, init)`**：同一个 key 在所有组件里拿到同一个 ref，服务端写入的值会**序列化进 payload**，客户端水合时恢复，所以值必须可序列化。**不能在模块顶层写 `const user = ref()`**：服务端的模块只加载一次、被所有请求共享，会串号和内存泄漏，要包成 `const useUser = () => useState('user')`。简单的全局状态用 useState 足够；业务逻辑多、需要 action 和调试工具时用 **Pinia**（通过 `@pinia/nuxt` 接入），初始化数据用 **`callOnce`** 调 action。
:::

## 详细解析

### 为什么模块顶层的 ref 会出事

浏览器里每个用户有自己的页面，模块顶层的变量天然是"每人一份"。服务端不同：Node 进程启动后模块只执行一次，后面所有请求共用同一个模块作用域。

```ts
// app/composables/user.ts
// ❌ 服务端所有请求共享这一个 ref，A 用户登录后 B 用户可能看到 A 的名字
export const currentUser = ref<User | null>(null)

// ✅ 每个请求有自己的 Nuxt 应用实例，useState 的值挂在这个实例上
export const useCurrentUser = () => useState<User | null>('current-user', () => null)
```

除了串号，顶层变量随请求不断写入还不会释放，就是内存泄漏。原理和排查方法见 [跨请求状态污染](/basics/ssr/12-cross-request-state)。

### useState 的规则

- **key**：同 key 共享同一份状态。可以省略，Nuxt 会按文件和行号自动生成，但跨文件共享时一定要写
- **init**：只在这个 key 还没有值时执行。服务端执行过、值进了 payload，客户端水合时直接用 payload 里的值，不会再执行 init
- **可序列化**：值要经过 payload 传给客户端，不能放函数、类实例、Symbol，否则报 `Cannot stringify arbitrary non-POJOs`
- **大对象**：`useState('list', () => shallowRef([]))` 取消深层响应式，减少开销
- **清理**：`clearNuxtState('key')` 删除状态，退出登录时常用；传 `{ reset: true }` 时恢复成 init 的初始值
- `useState` 是被编译器特殊处理的名字，不要自己定义同名函数

### callOnce：只做一次的初始化

```vue
<script setup lang="ts">
const config = useState('site-config')
// SSR 时执行一次，水合时不再执行；客户端导航回来也不会重复
await callOnce('site-config', async () => {
  config.value = await $fetch('/api/site-config')
})
</script>
```

`mode` 默认是 `'render'`，只在初始渲染执行一次；设成 `'navigation'` 时，之后每次客户端导航还会再执行一次。`callOnce` 不返回数据，页面自己要展示的数据还是用 `useFetch`、`useAsyncData`。

### useState 和 Pinia 怎么选

| | useState | Pinia |
| --- | --- | --- |
| 接入 | 内置 | `npx nuxt module add pinia` |
| 组织方式 | 一个 key 一个 ref，逻辑写在 composable 里 | store 里集中放 state、getters、actions |
| 调试 | 在 DevTools 的 payload 里看 | 有专门的 Pinia 面板，能看 action 和时间线 |
| 适合 | 当前用户、主题、少量配置 | 购物车、复杂表单、多人维护的业务模块 |

Pinia 的 store 在 Nuxt 里同样按请求隔离、同样走 payload，所以 state 也要可序列化。Nuxt 不再内置 Vuex，老项目要么迁到 Pinia，要么自己在插件里装 Vuex 4。Pinia 本身的用法见 [Pinia 和 Vuex](/basics/vue/17-pinia)。

## 代码示例

```ts
// app/stores/cart.ts
export const useCartStore = defineStore('cart', {
  state: () => ({ items: [] as CartItem[] }),
  getters: {
    total: (s) => s.items.reduce((sum, i) => sum + i.price * i.qty, 0),
  },
  actions: {
    async load() {
      this.items = await $fetch('/api/cart')
    },
  },
})
```

```vue
<script setup lang="ts">
const cart = useCartStore()
// 服务端加载一次，结果随 payload 带到客户端
await callOnce('cart', () => cart.load())
</script>
```

## 面试官可能追问

::: details useState 和 Vue 的 provide/inject 有什么区别？
provide/inject 只能在组件树里由上往下传，而且不处理 SSR 传值。useState 在任何组件、插件、中间件里都能按 key 取到，服务端的值还会自动带到客户端。
:::

::: details 状态里非要放 Date 或类实例怎么办？
payload 用 devalue 序列化，Date、Map、Set 这类常见类型本身支持。自定义类实例可以用 `definePayloadPlugin` 注册 reducer 和 reviver，告诉 Nuxt 怎么拆成普通数据、怎么还原。更简单的做法是状态里只存普通对象，需要时再构造实例。
:::

::: details 为什么 Pinia 的 action 不放在 useAsyncData 里调用？
useAsyncData 的 handler 应该只负责返回数据，不做副作用；而 action 是在修改 store。放进去后，key 相同的调用、refresh 都可能重复触发修改。只想初始化一次就用 callOnce。
:::

## 易错点

- 在 `composables/` 里 `export const state = ref()`，开发环境看不出问题，上线后用户互相看到对方数据
- 往 useState 里放函数或类实例，服务端渲染时报序列化错误
- 以为 init 每次都会执行，在里面写"每次进入页面都要刷新"的逻辑。init 只在状态为空时执行
- 不写 key，在两个文件里各调一次 `useState()`，以为拿到的是同一份状态
