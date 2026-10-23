---
difficulty: 1
tags: [高频, 实践]
---

# Nuxt 的文件路由怎么写？动态路由、嵌套路由和布局怎么配置？

::: tip 一句话回答
`app/pages` 下**每个文件生成一条路由**，`index.vue` 对应 `/`。方括号表示参数：`[id]` 是动态参数，`[[slug]]` 是可选参数，`[...slug]` 捕获剩余所有路径；括号目录 `(group)` 只用来分组，不进 URL。**嵌套路由**是父页面加同名目录，父页面里放 `<NuxtPage />`。**布局**放在 `app/layouts`，`app.vue` 用 `<NuxtLayout>` 包住 `<NuxtPage>` 后生效，`default.vue` 是默认布局，页面用 `definePageMeta({ layout })` 切换。
:::

## 详细解析

### 文件和路由的对应关系

```text
app/pages/
├─ index.vue                → /
├─ about.vue                → /about
├─ users/
│  ├─ index.vue             → /users
│  └─ [id].vue              → /users/:id
├─ docs/[[lang]].vue        → /docs 和 /docs/en 都匹配
├─ [...slug].vue            → 其他所有路径，如 404 页
└─ (marketing)/pricing.vue  → /pricing，(marketing) 不进 URL
```

- 参数用 `useRoute().params` 读取。访问 `/a/b` 时 `[...slug]` 拿到的是数组 `['a', 'b']`
- 参数可以和文字混用，如 `users-[group]/[id].vue`
- 路由组用来按业务整理文件，组名可以通过 `route.meta.groups` 读取

### 嵌套路由

父页面和同名目录同时存在，就形成嵌套。父页面里的 `<NuxtPage />` 是子页面的出口：

```text
app/pages/
├─ settings.vue          → 父页面，放侧边栏和 <NuxtPage />
└─ settings/
   ├─ profile.vue        → /settings/profile
   └─ security.vue       → /settings/security
```

```vue
<!-- app/pages/settings.vue -->
<template>
  <div class="settings">
    <aside>
      <NuxtLink to="/settings/profile">资料</NuxtLink>
      <NuxtLink to="/settings/security">安全</NuxtLink>
    </aside>
    <NuxtPage />
  </div>
</template>
```

### definePageMeta

页面级配置都写在 `definePageMeta` 里，常用字段：

- `layout`：用哪个布局，`false` 表示不用布局
- `middleware`：路由中间件，可以是名称、函数或数组
- `name`、`path`、`alias`：路由名、自定义路径、别名
- `keepalive`、`key`：页面缓存，以及什么情况下重新创建页面组件
- `validate`：校验参数，返回 `false` 时显示 404

```vue
<script setup lang="ts">
definePageMeta({
  layout: 'admin',
  middleware: ['auth'],
  // 只接受数字 id
  validate: (route) => /^\d+$/.test(String(route.params.id)),
})
</script>
```

`definePageMeta` 是**编译宏**，会在构建时被提取出组件，所以不能引用组件里的变量或响应式数据，只能写字面量或 import 进来的东西。

### 布局

```vue
<!-- app/app.vue -->
<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
```

```vue
<!-- app/layouts/default.vue：没指定 layout 的页面都用它 -->
<template>
  <div>
    <AppHeader />
    <slot />
  </div>
</template>
```

切换布局有几种方式：

1. 页面里 `definePageMeta({ layout: 'admin' })`，对应 `app/layouts/admin.vue`
2. `layout: false` 关闭布局，比如登录页
3. 运行时用 `setPageLayout('admin')` 动态切换，比如根据登录状态换布局
4. 在 `nuxt.config` 的 `routeRules` 里按路径指定，比如 `'/admin/**': { appLayout: 'admin' }`，不用每个页面都写

布局文件名用 kebab-case 引用，`layouts/desktop/default.vue` 的名称是 `desktop-default`。整个项目只有一个布局时，直接写在 `app.vue` 里更简单。

### 两个限制

- **单根元素**：页面和布局都要求只有一个根元素（HTML 注释也算节点），否则路由过渡不生效；布局的根元素也不能是 `<slot />`
- **pages 可选**：没有 `pages/` 目录时，Nuxt 不会打包 vue-router，适合单页面的落地页

Nuxt 的路由底层是 Vue Router，导航流程和守卫原理见 [Vue Router 的导航守卫](/basics/vue/16-router-guards)；Nuxt 里的守卫写成路由中间件，见 [路由中间件和服务端中间件的区别](/basics/nuxt/09-middleware)。

## 面试官可能追问

::: details 同时有 foo.vue 和 foo/[slug].vue，访问 /foo/bar 会怎样？
`foo.vue` 会成为父路由，`foo/[slug].vue` 是它的子路由。访问 `/foo/bar` 时渲染 `foo.vue`，子页面出现在它的 `<NuxtPage />` 位置；如果 `foo.vue` 里没放 `<NuxtPage />`，子页面就显示不出来。不想嵌套时，把 `foo.vue` 改成 `foo/index.vue`。
:::

::: details 从 /users/1 跳到 /users/2，页面组件会重新创建吗？
默认会复用同一个组件实例，只是参数变了，所以 setup 不会重新执行。用 `useFetch` 时 URL 写成依赖参数的响应式形式会自动重新请求；如果确实想重建组件，可以在 `definePageMeta` 里设置 `key: route => route.fullPath`。
:::

::: details 404 页面怎么做？
两种方式：写一个 `[...slug].vue` 捕获所有未匹配的路径，在里面 `throw createError({ status: 404 })`；或者不写，让 Nuxt 在找不到路由时自动抛 404，由 `error.vue` 统一渲染。两种写法返回的都是 404 状态码，不要只渲染一个"页面不存在"组件却返回 200。
:::

## 易错点

- 父页面忘了放 `<NuxtPage />`，子路由能匹配但不显示
- `app.vue` 里没加 `<NuxtLayout>`，`layouts/` 里的布局全部不生效
- 在 `definePageMeta` 里引用 `ref` 或组件内的变量，编译宏提取后找不到这些变量
- 页面或布局有多个根元素，路由过渡失效且没有明显报错
