---
difficulty: 2
tags: [场景题]
---

# React 项目里怎么做路由鉴权和权限控制？

::: tip 一句话回答
React Router **没有 Vue Router 那样的全局 `beforeEach` 守卫**，通常用**包装组件**（如 `RequireAuth`）判断登录态，未登录时用 `Navigate` 重定向到登录页并记下来源；用数据路由时也可以在 **loader 里判断后 `redirect`**（新版本还提供了路由 `middleware`）。角色权限一般是**根据后端返回的权限过滤路由表**，再配合**按钮级的权限组件或 Hook**。要强调前端鉴权只是体验优化，**真正的权限校验必须在后端做**。
:::

## 详细解析

### 登录鉴权：包装组件

```jsx
function RequireAuth({ children }) {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) {
    // replace 避免登录页进入历史记录；state 记下来源，登录后跳回
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return children
}

<Route path="/admin" element={<RequireAuth><AdminLayout /></RequireAuth>}>
  <Route path="users" element={<Users />} />
</Route>
```

包在父路由上，所有子路由一起受保护。登录成功后：

```jsx
const from = location.state?.from?.pathname || '/'
navigate(from, { replace: true })
```

刷新页面时用户信息还没拿到，要先显示加载态，等确认登录状态后再决定跳不跳，否则会误跳到登录页。

### 登录鉴权：loader

用数据路由时，可以在 loader 里判断。它在组件渲染前执行，没有"先渲染再跳走"的闪烁：

```jsx
async function protectedLoader({ request }) {
  const user = await getCurrentUser()
  if (!user) {
    const from = new URL(request.url).pathname
    throw redirect(`/login?from=${encodeURIComponent(from)}`)
  }
  return user
}
```

### 角色权限：动态路由表

1. 前端维护完整路由配置，每项标注需要的权限，如 `meta: { perm: 'user:view' }`
2. 登录后从后端拿到当前用户的权限列表
3. 递归过滤路由表，只保留有权限的路由，再用 `useRoutes` 或 `createBrowserRouter` 生成路由；菜单也从同一份过滤结果渲染
4. 兜底配置 `path="*"` 显示 404 或 403 页

这样没有权限的页面根本没有注册，手动输入 URL 也进不去。

### 按钮级权限

```jsx
function usePermission(perm) {
  const { perms } = useAuth()
  return perms.includes(perm)
}

function Auth({ perm, children, fallback = null }) {
  return usePermission(perm) ? children : fallback
}

<Auth perm="user:delete"><button>删除</button></Auth>
```

### 前端鉴权只是体验

前端代码和接口都在用户手里，隐藏路由和按钮只能防误操作，挡不住直接调接口。每个接口都要在服务端校验身份和权限。前端还要统一处理接口返回的 401（跳登录）和 403（提示无权限）。

## 面试官可能追问

::: details 和 Vue Router 的导航守卫比，有什么区别？
Vue Router 有全局 `beforeEach`，在跳转前统一拦截，见 [Vue 导航守卫](/basics/vue/16-router-guards)。React Router 是组件化思路，鉴权逻辑放在包装组件或 loader 里，按路由分层组合。想要"全局守卫"的效果，就把包装组件放在根布局路由上。
:::

::: details token 应该存在哪里？
放 localStorage 方便，但有 XSS 时会被读走；放 httpOnly Cookie 脚本读不到，但要配合 SameSite 和 CSRF 防护。很多项目用短期 access token 加 httpOnly 的 refresh token。前端能否读到登录态，取决于这个选择。
:::

::: details 权限变更后怎么让前端及时生效？
接口返回 403 时刷新权限并重新生成路由；或者在切换页面、窗口重新获得焦点时重新拉取权限。关键操作仍以后端为准，前端短暂不一致问题不大。
:::

## 易错点

- 在 effect 里判断未登录再 `navigate`，会先渲染一下受保护页面再跳走，应在渲染时返回 `Navigate` 或用 loader
- 登录态还在加载时就判断，刷新页面会被误踢到登录页
- 把前端隐藏按钮当成安全措施，后端接口没有校验
