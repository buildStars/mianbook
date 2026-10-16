---
difficulty: 2
tags: [高频]
---

# React Router 是怎么实现前端路由的？声明式路由和数据路由有什么区别？

::: tip 一句话回答
React Router 底层监听 URL 变化：`BrowserRouter` 用 **History API**（`pushState` 加 `popstate` 事件），`HashRouter` 用 **hash 和 `hashchange`**。Router 把当前 location 放进 **Context**，`Routes` 读取它、按路由配置匹配出要渲染的组件。新版本相比早期版本的主要变化是：`Switch` 换成 `Routes` 并按"最佳匹配"排序、**嵌套路由配合 `Outlet`**、`useHistory` 换成 **`useNavigate`**，以及支持 **`loader` / `action` 的数据路由**。
:::

## 详细解析

### 整体原理

hash 和 history 两种模式本身的区别，见 [前端路由](/basics/browser/18-frontend-routing)。这里看 React Router 在它们之上做了什么：

```text
URL 变化（点击 Link / 前进后退）
  → history 对象通知订阅者
  → Router 更新 state 里的 location
  → 通过 Context 下发 location 和 navigator
  → Routes 拿路由表和 location 做匹配
  → 按匹配结果从外到内渲染组件，子路由渲染到 Outlet
```

- `Link` 渲染成 `<a>`，但拦截点击，调用 `history.push` 改 URL，不刷新页面
- 前进后退触发 `popstate`，Router 收到通知后 setState，触发重新渲染
- `useLocation`、`useParams`、`useNavigate` 都是从 Context 里取值

### 新版本的主要变化

| 方面 | 早期版本 | 新版本 |
| --- | --- | --- |
| 路由容器 | `Switch`，按书写顺序取第一个匹配 | `Routes`，按路径的具体程度选最佳匹配 |
| 渲染组件 | `component` / `render` | 统一用 `element={<User />}` |
| 精确匹配 | 需要写 `exact` | 默认精确匹配，用 `/*` 表示匹配后续路径 |
| 嵌套路由 | 子组件里再写一套 Route | 父路由里嵌套 Route，子路由渲染到 `Outlet` |
| 编程式导航 | `useHistory().push` | `useNavigate()(path)` |
| 重定向 | `Redirect` | `Navigate` 组件，或 loader 里返回 `redirect` |

嵌套路由的写法：

```jsx
<Routes>
  <Route path="/" element={<Layout />}>
    <Route index element={<Home />} />
    <Route path="users/:id" element={<User />} />
  </Route>
</Routes>

function Layout() {
  return (
    <>
      <Nav />
      <Outlet /> {/* 子路由渲染在这里 */}
    </>
  )
}
```

### 数据路由

用 `createBrowserRouter` 创建路由，再交给 `RouterProvider`。路由上可以声明 `loader` 和 `action`：

- `loader`：进入路由前先取数据，组件里用 `useLoaderData` 读取，避免"先渲染再请求"的瀑布
- `action`：处理表单提交，提交后自动重新调用相关 loader 刷新数据
- `errorElement`：loader 或渲染出错时显示的兜底组件

```jsx
const router = createBrowserRouter([
  {
    path: '/users/:id',
    element: <User />,
    loader: ({ params }) =>
      fetch(`/api/users/${params.id}`).then((r) => r.json()),
  },
])
```

## 面试官可能追问

::: details history 模式刷新 404 是怎么回事？
`pushState` 只改地址栏，不发请求。刷新时浏览器真的去请求 `/users/1`，服务器上没有这个文件就返回 404。要在服务器（如 Nginx 的 `try_files`）把未匹配的路径都回退到 `index.html`，交给前端路由处理。
:::

::: details useNavigate 和 Link 怎么选？
用户能点的导航用 `Link`，它是真正的 `<a>`，支持右键新标签打开，对可访问性和 SEO 更友好。提交表单成功后跳转、登录后跳回原页面这类逻辑里的跳转，才用 `useNavigate`。
:::

::: details 路由组件怎么做懒加载？
用 `React.lazy` 配合 `Suspense` 包裹 element，按路由拆包；数据路由还可以在路由上写 `lazy` 字段异步加载组件和 loader。详见 [Suspense](/basics/react/16-suspense)。
:::

## 易错点

- 新写法里 `Routes` 不看书写顺序，不要再靠调整顺序来控制匹配
- 嵌套路由的子路径是相对父路径的，`path="users/:id"` 前面不要加 `/`
- 父组件里忘了写 `Outlet`，子路由匹配成功但页面什么都不显示
- `useNavigate` 返回的函数不要在渲染过程中直接调用，要放在事件或 effect 里；渲染时跳转用 `Navigate` 组件
