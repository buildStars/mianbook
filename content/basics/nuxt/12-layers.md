---
difficulty: 3
tags: [实践, 系统设计]
---

# Nuxt Layers 是什么？怎么在多个项目之间复用页面、组件和配置？

::: tip 一句话回答
一个 **layer 就是一个带 nuxt.config 的小 Nuxt 项目**，里面可以有 `app/`、`server/`、`app.config.ts`。使用方用 **`extends`** 引入本地路径、npm 包或 git 仓库，项目里的 **`layers/` 目录会自动注册**。合并规则是**同名文件和组件高优先级覆盖低优先级，配置用 defu 深合并**，所以 layer 适合做设计系统、后台基础框架和多品牌站点的共用底座。
:::

## 详细解析

### layer 长什么样

最小的 layer 只需要一个 `nuxt.config.ts`，有了它 Nuxt 才认为这个目录是 layer。其他内容和普通项目的目录结构一样，会被合并进使用方：

- `app/components`、`app/composables`、`app/utils`：组件和函数，照常自动导入
- `app/pages`、`app/layouts`、`app/middleware`、`app/plugins`：页面、布局、中间件、插件
- `app/app.config.ts`：公开配置
- `server/*`：接口、服务端中间件和插件
- `nuxt.config.ts`：模块、css、runtimeConfig 等配置

可以把它理解成"可以被继承的项目"：使用方拿到 layer 的全部能力，再在自己的项目里覆盖需要改的部分。

### 三种引入方式

```ts
// nuxt.config.ts（使用方）
export default defineNuxtConfig({
  extends: [
    '../base', // 本地路径，monorepo 里最常见
    '@acme/nuxt-admin', // npm 包
    'github:acme/nuxt-theme#v1', // git 仓库，不写分支时拉 main
    // 私有仓库带 token，token 从环境变量读，不要写死
    ['github:acme/private-layer', { auth: process.env.GITHUB_TOKEN }],
  ],
})
```

git 仓库还支持 `gitlab:`、`bitbucket:` 前缀；git layer 自己有 npm 依赖时可以加 `{ install: true }`。底层用的是 unjs 的 c12（加载配置和 extends）、giget（拉取远程仓库）和 defu（合并）。

另一种方式不用写 extends：放在项目 `layers/` 目录下的子目录会自动注册成 layer。适合把一个大项目按业务拆成几块，例如 `layers/admin`、`layers/shop`。

### 优先级和覆盖规则

优先级从高到低：

1. 项目自身的文件
2. `layers/` 目录里自动注册的 layer，按目录名字母顺序，**靠后的优先级更高**（Z 高于 A），可以用 `1.base`、`2.theme` 这样的数字前缀控制
3. `extends` 里的 layer，**排在第一个的优先级最高**

覆盖的效果：

- 同名的页面、组件、composable 文件，高优先级的生效。项目里写一个同名的 `AppHeader.vue`，就替换掉 layer 里的
- `nuxt.config` 和 `app.config` 用 defu 深合并，高优先级的值覆盖低优先级的同名键，没写的键保留 layer 的默认值
- layer 里启用的模块，使用方可以把该模块的配置键设为 `false` 关掉，例如 `image: false`，模块的 setup 就不会运行

### 路径陷阱

layer 里的 `~/`、`@/` 别名**按使用方项目解析**，不是按 layer 自己的目录。在 layer 的组件里写 `import x from '~/utils/x'`，被别人 extends 之后会去对方项目里找，结果找不到或者引错文件。

解决办法有两个：

- 改用相对路径，例如 `../utils/x`
- 给 layer 起名，用命名别名。在 layer 的 nuxt.config 里写 `$meta: { name: 'base' }`，之后就能用 `#layers/base/...` 引用

layer 的 nuxt.config 里写的相对路径（例如 css 文件路径）同样按使用方解析，稳妥的做法是用 `fileURLToPath(new URL('./assets/main.css', import.meta.url))` 这类写法转成绝对路径。

### 典型用途和发布

- **设计系统**：组件、主题 token、app.config 默认值放在一个 layer，多个业务项目共用
- **后台基础框架**：登录页、权限中间件、通用布局、请求封装做成 layer，新后台 extends 之后只写业务页面
- **多品牌站点**：一套代码做底座，每个品牌一个项目，只覆盖 logo、配色和个别页面

发布到 npm 时，`package.json` 的 `main` 指向 `./nuxt.config.ts`；运行时要用的依赖放 `dependencies`，`nuxt` 本身放 `devDependencies`。

```json
{
  "name": "@acme/nuxt-admin",
  "main": "./nuxt.config.ts",
  "dependencies": { "some-runtime-lib": "<版本范围>" },
  "devDependencies": { "nuxt": "^4.0.0" }
}
```

## 代码示例

```ts
// layers/base/nuxt.config.ts：给 layer 命名，并提供默认配置
import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  $meta: { name: 'base' },
  // 相对路径会按使用方解析，这里转成绝对路径
  css: [fileURLToPath(new URL('./app/assets/main.css', import.meta.url))],
  runtimeConfig: { public: { apiBase: '/api' } },
})
```

```ts
// layers/base/app/app.config.ts：使用方的 app.config 会深合并覆盖这里
export default defineAppConfig({
  brand: { name: 'Acme', primary: '#2563eb' },
})
```

```vue
<!-- 使用方 app/components/AppLogo.vue：同名组件覆盖 layer 里的版本 -->
<script setup lang="ts">
const { brand } = useAppConfig()
</script>

<template>
  <span :style="{ color: brand.primary }">{{ brand.name }}</span>
</template>
```

## 面试官可能追问

::: details layer 和模块有什么区别？
layer 像一个可以继承的项目，提供的是文件：页面、组件、配置，Nuxt 按目录约定把它们合并进来。[模块](/basics/nuxt/11-modules)是构建时运行的一段程序，通过 `defineNuxtModule` 和 kit 工具去改配置、注册组件和插件。复用一批业务页面和组件用 layer；要根据选项动态生成代码、接入第三方库，用模块。两者也能组合：layer 里可以声明要用的模块。
:::

::: details 多个 layer 定义了同一个组件，最终用哪个？
按优先级取最高的那个：项目自身 > `layers/` 目录（字母序靠后的优先）> `extends`（靠前的优先）。不确定时可以在模块里用 `getLayerDirectories()` 查看顺序，返回数组越靠前优先级越高，第一项是使用方项目。
:::

::: details 共享 layer 改了之后，怎么避免影响所有使用方？
把 layer 当成库来管理：发 npm 包或打 git tag，使用方锁定版本（`#v1`），升级时走 changelog 和回归测试。layer 里只放稳定的公共能力，业务差异通过 app.config、runtimeConfig 和组件覆盖来表达，不要在 layer 里写死某个项目的逻辑。
:::

## 易错点

- 在 layer 里用 `~/` 引用自己的文件，被 extends 后会按使用方项目解析，要用相对路径或 `#layers/名字`
- 把两种优先级记反：`extends` 是第一个最高，`layers/` 目录是字母序靠后的最高
- 以为配置会整个替换。nuxt.config 和 app.config 都是深合并，只想覆盖一个键时不用把整段配置抄过来
- layer 发布成 npm 包时把运行时依赖放进 `devDependencies`，使用方安装后会缺包
