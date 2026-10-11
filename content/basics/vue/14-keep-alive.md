---
difficulty: 2
tags: [高频, 原理]
---

# keep-alive 的作用和原理是什么？

::: tip 一句话回答
`<KeepAlive>` 是 Vue 的内置组件，组件被切换掉时**缓存它的实例**而不是销毁，切回来时直接复用，从而保留表单输入、已加载的数据等状态，也省去了重新创建和渲染的开销。原理是用 `Map` 缓存组件的 VNode、用 `Set` 记录访问顺序实现 **LRU** 淘汰；组件失活时把它的 DOM 移到一个隐藏的容器中，激活时再移回来，分别触发 `onDeactivated` 和 `onActivated`。
:::

## 详细解析

### 属性

| 属性 | 作用 |
| --- | --- |
| `include` | 只缓存名字匹配的组件 |
| `exclude` | 名字匹配的组件不缓存 |
| `max` | 最多缓存多少个实例，超出时淘汰最久没有被访问的那个（LRU） |

- `include` 和 `exclude` 按组件的 `name` 匹配，值可以是逗号分隔的字符串、正则表达式或数组
- 使用 `<script setup>` 的单文件组件不用手动声明 `name`，会根据文件名自动推断，例如 `UserList.vue` 的 name 是 `UserList`
- `<KeepAlive>` 的默认插槽中只能有一个子组件

### 生命周期

被缓存的组件切走时不会卸载，而是触发 `onDeactivated`；切回来时不会重新挂载，而是触发 `onActivated`。`onActivated` 在组件首次挂载时也会调用。这两个钩子对被缓存组件内部的子孙组件同样有效，详见 [Vue 的生命周期](/basics/vue/03-lifecycle)。

### 原理

1. **缓存结构**：内部用一个 `Map` 保存"key → 组件的 VNode"，VNode 上挂着组件实例和真实 DOM；再用一个 `Set` 记录 key 的访问顺序。key 默认是组件本身，子组件设置了 `key` 时就用这个 `key`
2. **命中缓存**：渲染时如果缓存中已有，就直接复用其中的组件实例和 DOM，并把这个 key 从 `Set` 中删除再重新加入，移到"最近访问"的一端
3. **淘汰**：新组件加入缓存后，如果数量超过 `max`，就取出 `Set` 中的第一个 key，也就是最久没被访问的，卸载对应的组件实例并删除缓存
4. **失活**：组件被切走时不执行卸载，而是把它的 DOM 移到一个不在页面上的 `div` 容器中，然后调用 `onDeactivated`
5. **激活**：切回来时把 DOM 移回页面，用最新的 props 更新一次，然后调用 `onActivated`

另外，`include` / `exclude` 变化时，不再匹配的组件会被移出缓存。

### 配合路由缓存页面

Vue Router 4 不再支持把 `<router-view>` 直接放进 `<keep-alive>`，要通过 `<router-view>` 的插槽拿到当前的路由组件，再用 `<keep-alive>` 包裹，写法见下面的代码。路由跳转的流程详见 [Vue Router 的导航守卫](/basics/vue/16-router-guards)。

常见问题：

- **被缓存的页面数据不刷新**：组件没有重新创建，`onMounted` 不会再执行，需要刷新的数据放到 `onActivated` 中获取
- **`include` 不生效**：通常是组件的 `name` 和 `include` 中写的不一致
- **缓存太多占用内存**：设置 `max` 限制缓存的数量
- **滚动位置丢失**：失活时 DOM 被移出文档，组件内滚动容器的滚动位置不会保留，需要在 `onDeactivated` 中记下 `scrollTop`，在 `onActivated` 中恢复

## 代码示例

```vue
<!-- App.vue -->
<script setup>
import { ref } from 'vue'

// 需要缓存的页面组件名，也可以放到 Pinia 中统一管理
const cachedViews = ref(['UserList', 'OrderList'])
</script>

<template>
  <router-view v-slot="{ Component }">
    <keep-alive :include="cachedViews" :max="10">
      <component :is="Component" />
    </keep-alive>
  </router-view>
</template>
```

```vue
<!-- views/UserList.vue，name 自动推断为 UserList -->
<script setup>
import { ref, onActivated } from 'vue'
import { fetchUsers } from '@/api/user'

// 搜索条件：切到别的页面再回来时还在
const keyword = ref('')
const users = ref([])

// 首次进入和每次切回来都会执行，用来刷新列表
onActivated(async () => {
  users.value = await fetchUsers(keyword.value)
})
</script>
```

## 面试官可能追问

::: details `max` 满了以后怎么淘汰？
按 LRU（最近最少使用）策略淘汰。`Set` 按插入顺序遍历，每次命中缓存都把这个 key 删除后重新加入，移到末尾，所以 `Set` 中的第一个 key 就是最久没被访问的。新组件加入缓存后数量超过 `max` 时，就卸载第一个 key 对应的组件实例，并把它从 `Map` 和 `Set` 中删除。
:::

::: details 为什么 `include` 不生效？
常见原因：

- `include` 匹配的是组件的 `name`，不是路由的 `name` 或路径
- `<script setup>` 组件默认用文件名作为 name，文件名是 `index.vue` 时 name 就是 `index`。这时可以用 `defineOptions({ name: 'UserList' })` 显式声明（Vue 3.3 起）
- 只对 `<keep-alive>` 直接包裹的组件生效，也就是路由页面组件本身，不包括页面里的子组件
- 逗号分隔的字符串不会去掉空格，`"a, b"` 匹配不到 `b`
:::

::: details 如何手动清除某个页面的缓存？
`<KeepAlive>` 没有提供删除单个缓存的公开 API。常用做法是把 `include` 绑定成一个响应式数组（通常放在 Pinia 中），需要清除时把组件名从数组中移除，`include` 变化后，不再匹配的缓存实例就会被销毁。比如关闭多标签页中的某个标签、退出登录时清空缓存。下次需要缓存时再把名字加回去。
:::

## 易错点

- `onActivated` 在首次挂载时也会执行，如果 `onMounted` 和 `onActivated` 中都请求数据，第一次进入会请求两次
- 被缓存的组件切走时不会触发 `onUnmounted`，轮询、动画、全局事件监听等要在 `onDeactivated` 中暂停，在 `onActivated` 中恢复
- 同一个组件对应不同的路由参数时（如 `/user/1` 和 `/user/2`），默认共用一个缓存实例；需要分别缓存时，从插槽中解构出 `route`，给组件加上 `:key="route.fullPath"`
