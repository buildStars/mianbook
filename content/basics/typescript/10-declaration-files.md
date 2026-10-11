---
difficulty: 2
tags: [实践, 原理]
---

# 声明文件怎么写？什么是声明合并和模块扩充？

::: tip 一句话回答
声明文件（`.d.ts`）只描述类型、不包含实现，用 `declare` 告诉编译器"这个东西在运行时存在，类型是这样的"。类型的来源有三种：库自带、社区维护的 `@types/xxx` 包、自己写。写声明文件最关键的是分清**全局声明和模块声明**：文件里没有顶层 `import` / `export` 时是全局脚本，声明对整个项目可见；一旦有了，就变成模块，要用 `declare global` 才能添加全局类型。**声明合并**是指同名的 interface 等声明会合并成一个；**模块扩充**是在模块文件里用 `declare module 'xxx'` 给已有模块的类型打补丁，比如给 Vue 的组件实例加属性。
:::

## 详细解析

### declare 和 .d.ts

```ts
// src/types/env.d.ts
declare const __APP_VERSION__: string // 构建工具在编译时注入的常量
declare function trackEvent(name: string, data?: Record<string, unknown>): void // 页面通过 script 标签引入的全局函数
```

`declare` 只声明类型，不生成任何代码。如果运行时其实没有这个变量，编译照样通过，运行时才报错。`.d.ts` 文件里只能写声明，不能写实现。

### 类型从哪里来

| 来源 | 说明 |
| --- | --- |
| 库自带 | `package.json` 的 `types` 字段，或 `exports` 中的 `types` 条件指向声明文件，安装即可用 |
| `@types/xxx` | 社区在 DefinitelyTyped 仓库维护，如 `@types/lodash`、`@types/node`，版本要和库的版本对应 |
| 自己写 | 没有类型的库、全局变量、构建工具注入的常量、图片等非 JS 资源的导入 |

`import` 一个库时，TS 会自动查找它自带的声明或对应的 `@types` 包。tsconfig 的 `types` 选项控制的是哪些 `@types` 包的**全局声明**（比如 `@types/node` 提供的 `process`）会被加入编译。

### 全局声明和模块声明

```text
文件里没有顶层 import / export  →  全局脚本：声明在整个项目中可见
文件里有顶层 import / export    →  模块：声明只在本文件有效，要用 declare global 添加全局类型
```

经典的坑：在全局声明文件里加了一行 `import type { User } from './user'`，文件变成了模块，原来那些全局类型全部"失效"。解决办法是把全局声明放进 `declare global { }`，或者不写顶层 import，改用 `import('./user').User` 这种写法引用类型。

### 给没有类型的第三方库补声明

在全局脚本里用 `declare module '模块名'` 声明整个模块的类型：

```ts
// src/types/legacy-sdk.d.ts
declare module 'legacy-sdk' {
  export interface InitOptions {
    appId: string
    debug?: boolean
  }
  export function init(options: InitOptions): void
  export function track(event: string, data?: Record<string, unknown>): void
}
```

```ts
// src/main.ts
import { init, track } from 'legacy-sdk'
import logo from './logo.svg'

init({ appId: 'demo', debug: __APP_VERSION__.endsWith('-dev') })
track('page_view', { path: location.pathname, logo })
```

赶时间时可以只写一行 `declare module 'legacy-sdk'`，这个模块导入的所有内容都是 any，相当于放弃检查，只适合过渡。上面导入 `.svg` 用的也是同样的机制，用通配符声明一类文件：

```ts
// src/types/assets.d.ts
declare module '*.svg' {
  const src: string
  export default src
}
```

Vite 项目引入的 `vite/client` 类型已经声明了常见的资源文件，一般不用自己写。

### 声明合并和模块扩充

同名的 interface 会合并成一个（见 [type 和 interface 的区别](/basics/typescript/01-type-vs-interface)），利用这一点可以扩充已有的类型。

**给 window 加属性**：

```ts
// src/types/global.d.ts
export {} // 让文件成为模块，才能使用 declare global

declare global {
  interface Window {
    __INITIAL_STATE__?: Record<string, unknown>
    dataLayer: unknown[]
  }
}
```

**给 Vue 组件实例加属性**：

```ts
// src/types/vue.d.ts
export {} // 必须是模块，下面的 declare module 才是扩充，而不是覆盖

declare module 'vue' {
  interface ComponentCustomProperties {
    $formatPrice: (cents: number) => string
  }
}
```

配合运行时的 `app.config.globalProperties.$formatPrice = ...`，模板和选项式 API 的 `this` 上就有了 `$formatPrice` 的类型。Pinia、Vue Router 也是用模块扩充让用户补充类型的，比如给路由的 `meta` 字段声明类型。

## 面试官可能追问

::: details declare module 'xxx' 什么时候是声明，什么时候是扩充？
取决于所在的文件是不是模块。在全局脚本里，`declare module 'xxx'` 是**环境模块声明**，描述一个模块的完整类型，适合给没有类型的库补声明；在模块文件里，它是**模块扩充**，和原有的声明合并。如果想扩充 Vue，却把 `declare module 'vue'` 写在了全局脚本里，它会被当作整个 `vue` 模块的声明，原有的类型被覆盖，`import { ref } from 'vue'` 都会报错。
:::

::: details 为什么写了 .d.ts 却不生效？
- 文件不在 tsconfig 的 `include` 范围内
- 文件里有顶层 import / export，变成了模块，全局声明却没写在 `declare global` 里
- 想做模块扩充的文件不是模块，结果覆盖了原有类型
- 编辑器缓存了旧的类型信息，重启 TS 服务后再看
:::

::: details `/// <reference types="..." />` 是做什么的？
三斜线指令，在文件里显式引入某个类型包的声明。比如 Vite 项目的 `env.d.ts` 里常见的 `/// <reference types="vite/client" />`，引入了 `import.meta.env` 和静态资源导入的类型。它必须写在文件最顶部，只在声明文件、或者需要引入全局类型时使用；也可以在 tsconfig 的 `types` 字段里配置。普通代码引用模块还是用 import。
:::

## 易错点

- `declare` 只告诉编译器"它存在"，不生成代码，运行时真的没有照样报错
- 全局声明文件一加顶层 import 就变成模块，全局类型随之失效
- 模块扩充所在的文件必须是模块，否则会覆盖原有类型，而不是扩充
