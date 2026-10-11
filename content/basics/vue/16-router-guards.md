---
difficulty: 2
tags: [高频]
---

# Vue Router 有哪些导航守卫？导航流程是怎样的？

::: tip 一句话回答
导航守卫分三类：**全局守卫**（`beforeEach`、`beforeResolve`、`afterEach`）、**路由独享守卫**（路由配置中的 `beforeEnter`）和**组件内守卫**（`onBeforeRouteLeave`、`onBeforeRouteUpdate`，选项式 API 中还有 `beforeRouteEnter`）。一次导航的顺序是：`beforeRouteLeave` → `beforeEach` → `beforeRouteUpdate` → `beforeEnter` → 解析异步路由组件 → `beforeRouteEnter` → `beforeResolve` → 确认导航 → `afterEach`。最常用的是在 `beforeEach` 中做登录鉴权。
:::

## 详细解析

### 守卫分类

| 类型 | 守卫 | 调用时机和用途 |
| --- | --- | --- |
| 全局 | `router.beforeEach` | 每次导航都会调用，最常用：登录鉴权、权限控制（配合 `router.addRoute` 动态添加路由）、开启进度条 |
| 全局 | `router.beforeResolve` | 所有组件内守卫和异步路由组件都解析完之后调用，适合导航确认前的最后检查 |
| 全局 | `router.afterEach` | 导航确认后调用，不能再影响导航，适合修改页面标题、关闭进度条、埋点 |
| 路由独享 | `beforeEnter` | 写在路由配置中，只在进入这个路由时调用 |
| 组件内 | `onBeforeRouteLeave` | 离开当前路由前调用，比如表单未保存时提示 |
| 组件内 | `onBeforeRouteUpdate` | 路由变化但组件被复用时调用，比如从 `/user/1` 到 `/user/2` |
| 组件内 | `beforeRouteEnter` | 没有组合式 API 版本。调用时组件实例还没创建，不能访问 `this`，可以给 `next` 传回调来拿到实例 |

### 用返回值控制导航

Vue Router 4 中，守卫可以通过返回值控制导航，`next` 参数变成了可选的：

- 返回 `false`：取消导航
- 返回一个路由地址（字符串或对象）：重定向到这个地址
- 不返回（`undefined`）或返回 `true`：继续导航
- 守卫可以是 async 函数，Vue Router 会等它完成；守卫中抛出错误也会取消导航

如果仍然使用 `next`，要保证每条执行路径上都恰好调用一次。

### 完整的导航解析流程

1. 导航被触发
2. 在失活的组件中调用 `beforeRouteLeave`
3. 调用全局的 `beforeEach`
4. 在被复用的组件中调用 `beforeRouteUpdate`
5. 调用路由配置中的 `beforeEnter`
6. 解析异步路由组件
7. 在被激活的组件中调用 `beforeRouteEnter`
8. 调用全局的 `beforeResolve`
9. 导航被确认
10. 调用全局的 `afterEach`
11. 触发 DOM 更新
12. 调用 `beforeRouteEnter` 中传给 `next` 的回调，参数是创建好的组件实例

组合式 API 中的 `onBeforeRouteLeave`、`onBeforeRouteUpdate` 分别在第 2、4 步执行。

### 路由懒加载

路由组件一般使用懒加载，例如 `component: () => import('./views/UserDetail.vue')`，第一次访问这个路由时才加载对应的代码，也就是上面第 6 步解析的异步路由组件。hash 模式和 history 模式的原理详见 [前端路由](/basics/browser/18-frontend-routing)，页面缓存详见 [keep-alive 的作用和原理](/basics/vue/14-keep-alive)。

## 代码示例

用 `beforeEach` 实现登录拦截：

```js
import { createRouter, createWebHistory } from 'vue-router'
import { useUserStore } from '@/stores/user'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'Login', component: () => import('@/views/Login.vue') },
    {
      path: '/',
      name: 'Home',
      component: () => import('@/views/Home.vue'),
      // 用 meta 标记需要登录的页面
      meta: { requiresAuth: true, title: '首页' },
    },
  ],
})

router.beforeEach((to) => {
  // 在守卫内部获取 store，此时 pinia 已经安装
  const userStore = useUserStore()

  // 只拦截需要登录的页面。登录页没有 requiresAuth，不会被反复重定向
  if (to.meta.requiresAuth && !userStore.token) {
    // 带上原本要去的地址，登录成功后跳回去
    return { name: 'Login', query: { redirect: to.fullPath } }
  }
  // 不返回任何值，表示放行
})

router.afterEach((to) => {
  document.title = to.meta.title || '管理后台'
})

export default router
```

## 面试官可能追问

::: details 权限路由怎么实现？
- 登录页、404 等公共路由在创建 router 时注册；需要权限的路由在登录后根据后端返回的权限（角色或菜单）筛选或生成，再用 `router.addRoute` 动态添加
- 在 `beforeEach` 中添加路由时，添加完要 `return to.fullPath` 重新导航一次，因为当前这次导航在添加路由之前就已经完成了匹配；退出登录时用 `router.removeRoute` 删除这些路由
- 按钮级权限可以封装成自定义指令（如 `v-permission`），也可以用 `v-if` 配合权限判断函数
- 前端控制只是为了体验，接口必须在后端再校验权限
:::

::: details `beforeEach` 中的重定向死循环怎么避免？
重定向本身也是一次新的导航，同样要经过 `beforeEach`。如果"未登录就跳转到登录页"这个条件对登录页本身也成立，就会不停地重定向。解决方法是只拦截需要登录的路由（如用 `meta.requiresAuth` 标记），或者维护一个白名单，目标已经是登录页时直接放行。使用 `next` 的写法还要注意每个分支都调用、且只调用一次 `next`。
:::

::: details 路由参数变化时，组件为什么不会重新创建？
从 `/user/1` 跳到 `/user/2` 匹配的是同一条路由、同一个组件，Vue Router 会复用这个组件实例，只更新路由参数，所以 `setup` 和 `onMounted` 都不会再执行。需要根据新参数重新加载数据时，可以：

- 在 `onBeforeRouteUpdate` 中处理
- 用 `watch(() => route.params.id, ...)` 监听参数变化
- 给 `<router-view>` 加上 `:key="$route.fullPath"` 强制重新创建组件，代价是每次都要完整地重新渲染
:::

## 易错点

- `beforeEnter` 只在从其他路由进入时调用，同一个路由内只改变 params、query 或 hash 时不会调用
- 在路由守卫中使用 Pinia，要在守卫函数内部调用 `useXxxStore()`，在模块顶层调用时 pinia 可能还没有安装，详见 [Pinia 和 Vuex 的区别](/basics/vue/17-pinia)
- 路由懒加载直接写 `() => import(...)`，不要用 `defineAsyncComponent` 包裹
