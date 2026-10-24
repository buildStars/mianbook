---
difficulty: 2
tags: [场景题, 实践]
---

# Vue 项目里的权限控制怎么做？路由、菜单和按钮权限分别怎么实现？

::: tip 一句话回答
前端权限控制只决定**用户能看到什么**，真正的校验必须在后端接口上做。前端分三层：**路由**用全局前置守卫拦截未登录用户，登录后拉取权限列表存进 Pinia，再用 `router.addRoute` 只添加有权限的路由；**菜单**由同一份过滤后的路由表生成；**按钮**用自定义指令 `v-permission`、权限组件或 `hasPermission` 函数控制显示。退出登录时要把动态路由移除，接口返回 403 时统一处理。
:::

## 详细解析

### 前端权限只是体验

用户可以改本地数据、直接调接口，前端隐藏一个按钮并不能阻止操作。前端做权限，是为了不让用户看到点了也没用的页面和按钮；每个接口仍然要在服务端校验身份和权限，查询类接口还要按用户过滤数据（数据权限）。

### 路由权限

1. 路由分两类：登录页、404 这类**静态路由**直接写在 `createRouter` 里；业务页面作为**动态路由**，在 `meta` 里标注需要的权限码
2. 全局前置守卫里检查登录状态，没登录就跳到登录页，守卫的写法见 [Vue Router 有哪些导航守卫？](/basics/vue/16-router-guards)
3. 已登录但权限还没加载：请求用户信息和权限列表，存进 Pinia，按权限过滤路由表，逐个 `router.addRoute`
4. 加完路由后**重新导航一次**：守卫里 `return to.fullPath`（旧写法是 `next({ ...to, replace: true })`）。因为本次导航开始时动态路由还不存在，首次直接打开 `/admin/users` 会匹配不到
5. 退出登录或切换账号时移除动态路由。`addRoute` 会返回一个移除函数，调用它就能删掉这条路由；也可以 `router.removeRoute(name)` 按名字删除

路由表可以前端写死、后端只返回权限码，也可以由后端直接返回菜单结构，前端把组件路径映射成懒加载的组件。前者简单，后者改菜单不用发版。

### 菜单

菜单和路由用**同一份过滤后的路由表**生成，`meta` 里放标题、图标、是否在菜单中隐藏。这样不会出现"菜单里有入口，点进去 404"或者"有页面没入口"的情况。

### 按钮权限

| 方式 | 写法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| 自定义指令 | `v-permission="'user:delete'"` | 写起来短 | 移除元素后，权限变化时无法恢复显示；用在组件上作用于根元素 |
| 权限组件 | `<Auth code="user:delete">` 包住内容 | 响应式，可以给无权限时的替代内容 | 多一层嵌套 |
| 函数 | `v-if="hasPermission('user:delete')"` | 响应式，也能用在 JS 逻辑里 | 每处都要写 `v-if` |

权限会在运行中变化（切换角色、后台改权限后刷新）时，优先用函数或组件。自定义指令的钩子和写法见 [Vue 自定义指令怎么写？](/basics/vue/23-custom-directive)。

### 接口 403 的统一处理

在请求库的响应拦截器里统一处理：401 清空登录状态、跳转登录页并带上原地址；403 提示"没有权限"，或者跳到无权限页面，并可以重新拉取一次权限，同步后台的修改。

## 代码示例

```js
// router/permission.js
import { router } from './index'
import { asyncRoutes } from './async-routes' // 业务路由，meta.perm 是需要的权限码
import { useUserStore } from '@/stores/user'

let removers = []

function filterRoutes(routes, perms) {
  return routes
    .filter((r) => !r.meta?.perm || perms.includes(r.meta.perm))
    .map((r) => (r.children ? { ...r, children: filterRoutes(r.children, perms) } : r))
}

router.beforeEach(async (to) => {
  const user = useUserStore()
  if (!user.token) {
    return to.meta.public ? true : { path: '/login', query: { redirect: to.fullPath } }
  }
  if (user.routesReady) return true

  try {
    await user.fetchProfile() // 拿到 user.perms，例如 ['user:view', 'user:delete']
  } catch {
    user.logout()
    return '/login'
  }
  const allowed = filterRoutes(asyncRoutes, user.perms)
  removers = allowed.map((r) => router.addRoute(r))
  user.menus = allowed
  user.routesReady = true
  return to.fullPath // 动态路由加完后重新匹配一次
})

export function resetRoutes() {
  removers.forEach((remove) => remove())
  removers = []
}
```

```js
// directives/permission.js
import { useUserStore } from '@/stores/user'

export const vPermission = {
  mounted(el, binding) {
    const codes = [].concat(binding.value)
    const { perms } = useUserStore()
    if (!codes.some((c) => perms.includes(c))) el.remove() // 移除后不会自动恢复
  },
}
// main.js：app.directive('permission', vPermission)
```

退出登录时调用 `resetRoutes()`，再把 store 里的 `routesReady`、`perms`、`menus` 清空，下一个账号登录后会重新走一遍加载流程。

## 面试官可能追问

::: details 为什么加完路由要重新导航，不能直接 return true？
导航开始时，`to` 已经按当时的路由表解析过了。首次直接打开一个动态路由的地址，那时它还没加进去，`to` 匹配到的是 404 或空。加完之后返回 `to.fullPath` 触发一次新导航，才能匹配到新路由。也要注意别在每次导航都重新加，用 `routesReady` 这类标记避免死循环。
:::

::: details 404 的通配路由应该放在哪？
Vue Router 4 按路径的匹配优先级排序，而不是按添加顺序，所以 `/:pathMatch(.*)*` 可以作为静态路由一开始就注册，后加的具体路由仍然优先匹配。Vue Router 3 按顺序匹配，通配路由必须最后添加。
:::

::: details 和 React 的权限控制有什么不同？
思路一样，都是路由、菜单、按钮三层加后端兜底。差别在实现方式：Vue Router 有全局守卫和 `addRoute`，React Router 一般用包装组件或 loader 拦截，再根据权限生成路由配置，见 [React 项目里怎么做路由鉴权和权限控制？](/basics/react/26-route-auth)。
:::

## 易错点

- 只在前端隐藏按钮、不在接口上校验，等于没有权限控制
- 退出登录不移除动态路由，下一个账号还能访问上一个账号的页面
- 权限没加载完就 `return true`，首次刷新动态路由页面会落到 404
- 用指令移除元素后，权限变了也不会恢复显示，需要响应式时改用 `v-if` 或权限组件
