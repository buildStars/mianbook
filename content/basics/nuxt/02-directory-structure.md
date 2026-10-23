---
difficulty: 1
tags: [实践]
---

# Nuxt 4 的目录结构是怎样的？app、server、shared 目录分别放什么？

::: tip 一句话回答
Nuxt 4 把代码按运行位置分成三块：**`app/`** 放 Vue 应用（页面、布局、组件、composables、路由中间件、插件），**`server/`** 放 Nitro 服务端代码（接口、服务端中间件、插件、工具函数），**`shared/`** 放两边都能用的纯逻辑，不能 import Vue 或 Nitro 的代码。根目录还有 `public/`（原样发布）、`layers/`、`modules/`（自动注册）和生成目录 `.nuxt/`。这样分开后，三块代码分成不同的 TypeScript 项目分别检查类型，文件监听也不用再扫根目录下的 `.git/` 和 `node_modules/`。
:::

## 详细解析

### 整体结构

```text
my-app/
├─ app/                  # Vue 应用，别名 ~ 指向这里
│  ├─ pages/             # 文件路由
│  ├─ layouts/           # 布局，default.vue 是默认布局
│  ├─ components/        # 组件，自动导入
│  ├─ composables/       # 组合式函数，顶层文件自动导入
│  ├─ utils/             # 工具函数，顶层文件自动导入
│  ├─ middleware/        # 路由中间件
│  ├─ plugins/           # Nuxt 插件，顶层文件自动注册
│  ├─ assets/            # 需要经过构建处理的样式、图片、字体
│  ├─ app.vue            # 根组件
│  ├─ app.config.ts      # 应用配置（会进客户端 bundle）
│  └─ error.vue          # 错误页
├─ server/               # Nitro 服务端
│  ├─ api/               # 接口，自动加 /api 前缀
│  ├─ routes/            # 服务端路由，不加前缀
│  ├─ middleware/        # 每个请求都执行
│  ├─ plugins/           # Nitro 插件
│  └─ utils/             # 服务端工具，自动导入
├─ shared/               # 应用和服务端共用
│  ├─ utils/             # 顶层文件自动导入
│  └─ types/             # 顶层文件自动导入
├─ public/               # 原样发布到网站根目录
├─ layers/               # 子目录自动注册为 layer
├─ modules/              # 本地模块，自动注册
├─ .nuxt/                # 生成目录，不提交
└─ nuxt.config.ts
```

### app 目录

- `pages/`：每个文件对应一条路由；没有这个目录时不会打包 vue-router，只渲染 `app.vue`
- `layouts/`、`middleware/`、`plugins/`：分别是布局、路由中间件和插件，后两者在客户端导航和 SSR 时都会执行
- `components/`、`composables/`、`utils/`：自动导入，组件名按目录拼接
- `assets/` 和 `public/` 的区别：`assets/` 里的文件会被构建工具处理（带 hash、压缩、可以被 import），`public/` 里的文件不处理，`public/robots.txt` 直接对应 `/robots.txt`
- `app.config.ts`：用 `defineAppConfig` 导出，运行时可以用 `updateAppConfig` 修改。会打进客户端 bundle，不能放密钥
- `error.vue`：不是路由，不放在 `pages/` 里，通过 `error` prop 拿到错误信息

### server 目录

- `api/`：`server/api/hello.ts` 对应 `/api/hello`；`routes/`：`server/routes/hello.ts` 对应 `/hello`，适合 sitemap、RSS 这类不想带前缀的路径
- 文件名可以带方法后缀，如 `users.get.ts`、`users.post.ts`
- `middleware/`：在每个请求的路由处理之前执行，只做检查或往 `event.context` 上加数据，不应该返回响应
- `plugins/`：用 `defineNitroPlugin` 注册，服务启动时执行一次
- `utils/`：服务端自动导入的工具函数

服务端代码不要 import `app/` 里的组件和 composables，应用代码也不要 import 只能在服务端运行的代码。

### shared 目录

放两边都要用的东西，比如校验规则、格式化函数、类型定义：

```ts
// shared/utils/price.ts：页面和接口都能直接调用 formatPrice
export function formatPrice(cents: number) {
  return `¥${(cents / 100).toFixed(2)}`
}
```

```ts
// 非 utils、types 目录下的文件，用 #shared 别名导入
import { orderSchema } from '#shared/schemas/order'
```

`shared/` 里不能 import Vue 或 Nitro 的代码，否则另一端用不了。只有 `shared/utils/` 和 `shared/types/` 的顶层文件自动导入。

### 为什么把应用代码放进 app/

- **类型检查分开**：Nuxt 4 生成多份 tsconfig（应用、服务端、shared、构建期配置），应用代码里不会提示只有服务端才有的 API，反之亦然
- **监听更快**：源码都放在根目录时，文件监听会扫到 `.git/`、`node_modules/`，在非 macOS 系统上可能明显拖慢启动；源码收进 `app/` 后监听范围更小
- **兼容旧项目**：不迁移也能继续用。Nuxt 发现没有 `app/` 目录时把根目录当作源码目录；要显式固定旧结构，在配置里设 `srcDir: '.'`，再加 `dir: { app: 'app' }`

注意 `~` 别名指向 `app/`，根目录要用 `~~`。

## 面试官可能追问

::: details server/api 和 server/routes 有什么区别？
只是 URL 前缀不同：`api/` 下的文件自动加 `/api`，`routes/` 下的不加。写法完全一样，都是 `defineEventHandler`。返回 JSON 的接口放 `api/`，要占用根路径的（如 `/sitemap.xml`）放 `routes/`。
:::

::: details .nuxt 目录是什么，能不能改？
是开发和构建时生成的目录，里面有自动导入的类型声明、tsconfig、路由等生成文件。每次 `nuxt dev` 都会重建，手改会被覆盖，应该加进 `.gitignore`。CI 里做类型检查前要先运行 `nuxt prepare` 生成它。
:::

::: details 一段代码前端和后端都要用，放哪？
不依赖 Vue 也不依赖 Nitro 的纯函数和类型放 `shared/`。如果它用到了 `ref` 或 `useNuxtApp`，就只能放 `app/`；用到了 `event`、`useStorage`，就只能放 `server/`。
:::

## 易错点

- 在 `app/` 里写 `~/server/...` 引服务端代码。`~` 指向 `app/`，而且应用代码本来就不该 import 服务端代码
- 以为 `server/middleware` 和 `app/middleware` 是一回事。前者是 Nitro 层、每个请求都执行，后者是 Vue Router 层的路由中间件
- 把密钥写进 `app.config.ts`。它会打包进客户端，密钥应该放 `runtimeConfig` 的私有键
- 以为 `shared/` 下任何深度的文件都自动导入。只有 `utils/` 和 `types/` 的顶层文件会
