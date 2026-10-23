---
difficulty: 3
tags: [原理, 实践]
---

# Nuxt 模块是什么？和插件有什么区别？怎么写一个模块？

::: tip 一句话回答
模块是在 **Nuxt 启动和构建时**执行的函数，本身**不进入应用运行时**。它通过修改 `nuxt.options`、监听构建钩子、注册插件、组件、composables 和服务端接口来改变应用。插件则是在**应用运行时**执行的代码，浏览器和服务端每次启动应用都会跑。写模块用 `defineNuxtModule`，结构是 `meta`、`defaults`、`hooks`、`moduleDependencies` 和 `setup(options, nuxt)`，在 setup 里用 `@nuxt/kit` 的 `addPlugin`、`addComponent`、`addServerHandler` 等工具注入运行时代码，运行时代码放在 `runtime/` 目录。
:::

## 详细解析

### 模块和插件的区别

| | 模块 | 插件 |
| --- | --- | --- |
| 执行时机 | `nuxt dev`、`nuxt build` 启动时 | 应用启动时（服务端每个请求、浏览器打开页面） |
| 能拿到 | `nuxt` 实例、`nuxt.options`、构建钩子 | `nuxtApp`、`vueApp`、运行时钩子 |
| 能做的事 | 改配置、注册组件和自动导入、加服务端接口、生成模板 | 注册 Vue 插件、指令、provide 工具方法 |
| 打不打包进产物 | 模块代码本身不打包 | 打包 |
| 写在哪 | `modules/` 或 npm 包，在 `modules` 数组里声明 | `app/plugins/` |

一个模块常常会注册插件：例如 Pinia 的 Nuxt 模块在构建时加配置、加自动导入，运行时再通过插件把 Pinia 装到 Vue 应用上。插件本身的写法见 [Nuxt 插件](/basics/nuxt/10-plugins)。

### defineNuxtModule 的结构

- **meta**：`name` 一般是 npm 包名；`configKey` 是用户在 `nuxt.config` 里写选项的键；`compatibility.nuxt` 是支持的 Nuxt 版本范围，不符合时会提示
- **defaults**：默认选项，可以是对象或返回对象的函数，会和用户选项合并后传给 setup
- **hooks**：声明式注册 Nuxt 钩子的语法糖
- **moduleDependencies**：声明依赖的其他模块，可以带版本要求、`optional`，还能修改依赖模块的默认配置；它替代了以前的 `installModule`
- **setup(options, nuxt)**：真正干活的地方，可以是 async

`defineNuxtModule` 包装后还会做几件事：合并默认值、按 `name` 或 `configKey` 保证同一个模块只装一次、做兼容性检查。

### @nuxt/kit 常用工具

- `createResolver(import.meta.url)`：把 `./runtime/xxx` 解析成绝对路径，模块发布到 npm 后路径依然正确
- `addPlugin(path)`：注册运行时插件
- `addComponent({ name, filePath })`、`addComponentsDir({ path })`：注册组件
- `addImports({ name, from })`、`addImportsDir(dir)`：注册自动导入
- `addServerHandler({ route, handler })`：注册 Nitro 接口
- `addRouteMiddleware({ name, path, global })`：注册路由中间件
- 直接改 `nuxt.options`，如 `nuxt.options.css.push(...)`；用 `nuxt.hook('nitro:config', ...)` 改 Nitro 配置

这些工具**只能在模块里用**。组件、页面、插件、composables、服务端接口里都不能 import `@nuxt/kit`，它们运行时已经没有 `nuxt` 实例了。

### runtime 目录和自动导入

模块注入的运行时代码（插件、组件、接口）放在 `runtime/` 下，由模块通过 kit 工具注册进应用。**发布到 npm 的模块**，runtime 代码不能依赖自动导入，要从 `#imports` 显式导入，例如 `import { useRuntimeConfig } from '#imports'`。

### 本地模块

项目根目录的 `modules/` 下，`modules/*.ts` 和 `modules/*/index.ts` 会自动注册，不用写进配置。加载顺序是先执行 `nuxt.config` 里 `modules` 数组的模块，再按字母序执行本地模块，可以加数字前缀调整。本地模块可以从 `nuxt/kit` 导入工具，不必单独装 `@nuxt/kit`。

## 代码示例

一个小模块：注册一个组件、一个服务端接口，并把选项合并进 public 运行时配置。

```text
modules/hello/
├── index.ts
└── runtime/
    ├── components/HelloBanner.vue
    └── server/api/hello.get.ts
```

```ts
// modules/hello/index.ts
import { defineNuxtModule, createResolver, addComponent, addServerHandler } from 'nuxt/kit'
import { defu } from 'defu'

export interface ModuleOptions {
  greeting: string
}

export default defineNuxtModule<ModuleOptions>({
  meta: { name: 'hello', configKey: 'hello' },
  defaults: { greeting: 'Hello' },
  setup(options, nuxt) {
    const resolver = createResolver(import.meta.url)

    // 合并到 public 运行时配置，组件里用 useRuntimeConfig().public.hello 读取
    nuxt.options.runtimeConfig.public.hello = defu(
      nuxt.options.runtimeConfig.public.hello as Partial<ModuleOptions> | undefined,
      { greeting: options.greeting },
    )

    addComponent({
      name: 'HelloBanner',
      filePath: resolver.resolve('./runtime/components/HelloBanner.vue'),
    })

    addServerHandler({
      route: '/api/hello',
      handler: resolver.resolve('./runtime/server/api/hello.get.ts'),
    })
  },
})
```

```ts
// modules/hello/runtime/server/api/hello.get.ts
export default defineEventHandler((event) => {
  const { greeting } = useRuntimeConfig(event).public.hello as { greeting: string }
  return { message: `${greeting}, Nuxt` }
})
```

```ts
// nuxt.config.ts：用户通过 configKey 传选项
export default defineNuxtConfig({
  hello: { greeting: '你好' },
})
```

## 面试官可能追问

::: details 什么时候该写模块，什么时候插件就够了？
只需要在运行时初始化某个库、注入方法，插件就够了。需要改构建配置、批量注册组件和自动导入、加服务端接口，或者要把一套能力打包给多个项目复用，就写模块。
:::

::: details 模块里的选项为什么要合并进 runtimeConfig？
模块只在构建时运行，`options` 不会自动出现在运行时。要让组件或接口读到，就得写进 `runtimeConfig`（敏感的放顶层，公开的放 `public`）。写进 `public` 的值会下发到浏览器，不能放密钥。
:::

::: details 多个模块改同一个配置，谁说了算？
没有统一的"谁赢"规则，取决于执行顺序和写法：直接赋值时，后执行的模块会改掉先执行的设置；像示例里那样用 defu 把已有值放在前面合并，已有的值会保留。模块在 `nuxt.config` 的 `modules` 数组里按顺序执行，本地 `modules/` 目录在它们之后。文档说明 `moduleDependencies` 不保证执行先后，它的作用是声明依赖和调整依赖模块的配置。
:::

::: details 怎么调试模块？
本地 `modules/` 下改代码会触发 Nuxt 重启。可以在 setup 里打日志，看 `nuxt.options` 被改成了什么；注册的组件、自动导入和接口，在 Nuxt DevTools 里能看到。
:::

## 易错点

- 在插件或组件里 import `@nuxt/kit`。kit 只在模块运行的构建阶段可用
- 用相对路径 `'./runtime/plugin'` 直接传给 `addPlugin`，发布后路径解析错误，要用 `createResolver`
- 发布的模块在 runtime 代码里依赖自动导入，用户关掉自动导入或换了环境就报错，要从 `#imports` 显式导入
- 把模块选项里的密钥写进 `runtimeConfig.public`，结果打包进了客户端
