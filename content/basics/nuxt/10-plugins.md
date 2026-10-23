---
difficulty: 2
tags: [原理]
---

# Nuxt 的插件是什么？执行顺序怎么控制？怎么给全局注入工具方法？

::: tip 一句话回答
插件是**应用启动时执行一次**的代码，放在 `app/plugins`，顶层文件自动注册，用 `defineNuxtPlugin((nuxtApp) => {})` 写，能拿到 `nuxtApp` 去注册 Vue 插件、指令、运行时钩子。文件名加 `.client`、`.server` 限定运行端。顺序默认按**文件名字符串排序**，用 `01.`、`02.` 前缀控制；对象写法还能用 `enforce`、`dependsOn`、`parallel` 精细控制。返回 `{ provide: { hello } }` 后在任何地方用 `useNuxtApp().$hello` 调用，不过官方更推荐把工具方法写成 composable。
:::

## 详细解析

### 注册规则

- `app/plugins/` 顶层文件自动注册
- 子目录里只认 `index.ts`，而且这种用法已不推荐；其他子目录文件要写进 `nuxt.config` 的 `plugins` 数组
- `xxx.client.ts` 只在浏览器执行，`xxx.server.ts` 只在服务端执行，不带后缀两端都执行

插件和[模块](/basics/nuxt/11-modules)容易混：插件在**应用运行时**执行，每个请求在服务端都会创建应用、跑一遍插件；模块在 **Nuxt 启动和构建时**执行，用来改配置、注册插件和组件。

### 控制执行顺序

默认情况下插件一个接一个执行，前一个是 async 的，后一个会等它完成。

1. **文件名前缀**：`01.sentry.ts`、`02.api.ts`。字符串排序，`10.` 会排在 `2.` 前面
2. **enforce**：`'pre' | 'default' | 'post'`，按阶段分组
3. **dependsOn**：`['my-plugin']`，等名为 `my-plugin` 的插件执行完再运行，配合 `parallel` 使用
4. **parallel**：`true` 时不等这个插件执行完就开始加载下一个，适合互不依赖的慢插件
5. **order**：数字，覆盖 `enforce`，一般只有模块作者用

对象写法的其他字段：`name` 用于调试和依赖声明，`setup` 等价于函数写法，`hooks` 直接注册运行时钩子（如 `'app:created'`），`env.islands` 设为 `false` 时在服务端组件、岛组件的渲染中不运行。这些字段必须**静态可分析**，不要写 `enforce: import.meta.server ? 'pre' : 'post'` 这种运行时计算。

### 注入工具方法

```ts
// app/plugins/format.ts
export default defineNuxtPlugin(() => {
  return {
    provide: {
      money: (cents: number) => `¥${(cents / 100).toFixed(2)}`,
    },
  }
})
```

使用时 `const { $money } = useNuxtApp()`，模板里可以直接写 `$money(price)`。类型可以通过 `declare module '#app' { interface NuxtApp { ... } }` 补充，大多数情况下 Nuxt 会自动推导。

官方更推荐**写成 composable 或 utils**：放在 `app/utils/format.ts` 里自动导入，按需打包、类型清楚，也不用占应用启动时间。provide 适合需要在启动时初始化的单例，比如带拦截器的 API 客户端。

### 注册 Vue 插件和指令

```ts
// app/plugins/focus.ts
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('focus', {
    mounted(el) {
      el.focus()
    },
    // 服务端渲染时没有 DOM，用它返回要输出的属性
    getSSRProps() {
      return {}
    },
  })
})
```

`nuxtApp.vueApp` 就是 Vue 的 app 实例，`nuxtApp.vueApp.use(SomePlugin)` 注册第三方 Vue 插件。只在浏览器能用的库，把插件文件命名成 `.client.ts`；自定义指令如果只注册在客户端，服务端渲染到它时会找不到，需要再放一个 `.server.ts` 的空实现。

## 代码示例

```ts
// app/plugins/api.ts：带鉴权头的 API 客户端
export default defineNuxtPlugin({
  name: 'api',
  enforce: 'pre',
  setup() {
    const token = useCookie('token')
    const api = $fetch.create({
      baseURL: '/api',
      onRequest({ options }) {
        if (token.value) options.headers.set('Authorization', `Bearer ${token.value}`)
      },
    })
    return { provide: { api } }
  },
})
```

```ts
// app/plugins/analytics.client.ts：依赖 api 插件，自己并行加载
export default defineNuxtPlugin({
  name: 'analytics',
  dependsOn: ['api'],
  parallel: true,
  async setup(nuxtApp) {
    nuxtApp.hook('page:finish', () => {
      // 上报页面浏览
    })
  },
})
```

## 面试官可能追问

::: details 插件为什么会拖慢首屏？
插件在应用启动时执行，默认顺序执行。某个插件 await 了一个慢请求，后面的插件和整个应用渲染都要等。服务端每个请求都会跑一遍插件，慢插件同样拉长响应时间。办法是改成 `parallel`、把初始化挪到用到的地方，或者只在客户端执行。
:::

::: details 插件里能不能调用 composable？
能调用依赖 `nuxtApp` 的 composable，比如 `useState`、`useCookie`、`useRuntimeConfig`。依赖组件生命周期的不行，因为插件不在组件里。如果某个 composable 依赖另一个还没执行的插件提供的东西，也会出问题，要用 `dependsOn` 或调整顺序。
:::

::: details provide 出来的 ref 在模板里有什么问题？
通过 provide 注入的 ref、computed 在模板里不会自动解包，要写 `.value`。需要响应式的全局状态更适合用 `useState`。
:::

## 易错点

- 依赖 `window`、`document` 的库没加 `.client` 后缀，服务端渲染时直接报错
- 文件名前缀用 `1.`、`2.`、`10.`，结果 `10.` 排在 `2.` 前面
- 什么工具函数都往 provide 里塞。普通函数放 `utils/` 自动导入更好
- 在插件对象写法里用运行时表达式计算 `enforce`、`dependsOn`，导致排序和优化失效
