---
difficulty: 2
tags: [高频, 实践]
---

# tsconfig 里哪些配置最重要？strict 包含哪些检查？

::: tip 一句话回答
最关键的是四组：**strict** 一键打开 `strictNullChecks`、`noImplicitAny`、`strictFunctionTypes` 等一整套严格检查（TS 6.0 起默认就是 true）；**target 和 lib**，target 决定输出的语法版本，lib 决定代码里能用哪些内置 API 的类型，两者都不做 polyfill；**module 和 moduleResolution**，用打包工具的前端项目选 `bundler`，直接在 Node.js 上运行的代码选 `nodenext`；还有 strict 之外值得开的 `noUncheckedIndexedAccess`。另外要知道 `paths` 只影响类型检查、需要构建工具配合，`skipLibCheck` 用来跳过声明文件的检查。
:::

## 详细解析

### strict 包含哪些检查

| 选项 | 作用 |
| --- | --- |
| `strictNullChecks` | null 和 undefined 不再能赋给任何类型，必须显式处理 |
| `noImplicitAny` | 推断不出类型时报错，而不是悄悄变成 any |
| `strictFunctionTypes` | 函数类型的参数按逆变检查，见 [协变和逆变](/basics/typescript/13-variance) |
| `strictBindCallApply` | 检查 `bind`、`call`、`apply` 的参数 |
| `strictPropertyInitialization` | 类的属性必须在声明处或构造函数里初始化 |
| `strictBuiltinIteratorReturn` | 内置迭代器的返回值类型用 undefined 而不是 any |
| `noImplicitThis` | `this` 推断为 any 时报错 |
| `useUnknownInCatchVariables` | `catch (e)` 的 e 是 unknown 而不是 any |
| `alwaysStrict` | 按 JS 严格模式解析，输出 `"use strict"`；TS 7.0 起总是开启，不能再设为 false |

- 开了 strict 还能单独关掉其中某一项（`alwaysStrict` 除外），比如老项目迁移时先关 `strictPropertyInitialization`
- 官方说明以后的版本可能往 strict 里加入新的检查，所以升级 TS 后出现新报错是正常的
- TS 6.0 起 `strict` 默认为 true，不写也是开启的；老项目想保持原样要显式写 `"strict": false`

### target 和 lib

- **target**：输出的 JS 用哪个版本的语法。比如可选链 `?.` 在低于 ES2020 的 target 下会被改写成普通判断
- **lib**：编译时引入哪些内置类型声明，比如 `Array.prototype.at`、`Promise.withResolvers` 的类型，以及浏览器环境的 `dom`。不写时根据 target 推导
- 两者都**只管语法和类型，不会补 API**。lib 里写了 ES2023，代码就能调用 `findLast`，但运行环境不支持就会报错，需要的 polyfill 要自己引入，见 [Babel 和 polyfill](/basics/build/07-babel)

用 Vite 等打包工具时，语法降级通常交给打包工具，TS 只做类型检查，target 设成较新的版本即可。

### module 和 moduleResolution

| moduleResolution | 适用场景 | 特点 |
| --- | --- | --- |
| `bundler` | Vite、webpack 等打包工具处理的前端项目 | 支持 package.json 的 `exports`、`imports`；相对路径导入**不需要写扩展名** |
| `node16` / `nodenext` | 直接用 Node.js 运行的代码、发布到 npm 的库 | 模拟 Node.js 的真实规则：按 `type` 字段和 `.mts`/`.cts` 区分 ESM 和 CommonJS，ESM 里的相对导入**必须写扩展名**（写 `.js`） |

- `bundler` 一般搭配 `module: esnext` 或 `preserve`；`node16` / `nodenext` 要求 `module` 也设成 Node.js 系列的值（`node16`、`node20`、`nodenext` 等），否则直接报错，通常两者都写 `nodenext`
- 用 `bundler` 写出来的代码，换到 Node.js 直接运行可能找不到模块，因为 Node.js 要求写扩展名。所以库和 Node.js 服务用 `nodenext` 更稳妥
- 旧的 `node`（`node10`）在 TS 6.0 废弃、`classic` 在 TS 6.0 移除，TS 7.0 两者都不再支持

### strict 之外值得开的检查

```ts
const scores: Record<string, number> = { tom: 90 }
const list = [1, 2, 3]

// 开启 noUncheckedIndexedAccess 后，按索引签名或数组下标取值会带上 undefined
const a = scores['jerry'] // number | undefined
const b = list[5] // number | undefined
if (b !== undefined) console.log(b.toFixed(0))

interface Settings {
  theme?: 'dark' | 'light'
}
// 开启 exactOptionalPropertyTypes 后，可选属性"不存在"和"值为 undefined"被区分开
// @ts-expect-error theme 可以不写，但不能显式写成 undefined
const s: Settings = { theme: undefined }
```

- `noUncheckedIndexedAccess`：能拦住大量"数组越界、对象没有这个键"的问题，代价是要多写判断
- `exactOptionalPropertyTypes`：更准确，但很多第三方类型没按这个规则写，开启后可能出现不少报错，按项目情况决定
- `noImplicitOverride`：子类重写父类方法必须写 `override`，见 [TypeScript 的 class](/basics/typescript/19-class)

### paths、skipLibCheck、types 和项目引用

- **paths**：配置 `"@/*": ["./src/*"]` 这样的别名。它**只告诉 TS 怎么找类型**，不会改写输出代码里的导入路径，打包工具（Vite 的 `resolve.alias`）、测试框架也要配同样的别名，或者用能读取 tsconfig 的插件。`baseUrl` 在 TS 6.0 废弃、TS 7.0 移除，paths 直接相对 tsconfig 所在目录书写
- **skipLibCheck**：跳过所有 `.d.ts` 的类型检查，只检查自己代码用到的部分。能明显加快编译，也能避开不同依赖之间的声明冲突，官方推荐开启。代价是声明文件本身的错误不会报出来
- **types**：控制自动加入哪些 `@types` 包的全局声明。TS 6.0 起默认是空数组，用到 `process` 这类全局变量要写 `"types": ["node"]`
- **项目引用**：大仓库可以拆成多个 tsconfig，子项目开启 `composite`，根配置用 `references` 列出它们，再用 `tsc -b` 按依赖顺序增量构建。Vite 模板里的 `tsconfig.app.json` 和 `tsconfig.node.json` 就是用 references 把浏览器代码和配置文件代码分开检查

## 代码示例：Vite 前端项目的常见配置

```json
{
  "compilerOptions": {
    "target": "es2022",
    "lib": ["es2022", "dom"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

`noEmit` 表示 TS 只做类型检查、不输出文件，编译交给 Vite。`verbatimModuleSyntax` 和单文件编译的关系见 [tsc、Babel、esbuild 的区别](/basics/typescript/20-transpile)。

## 面试官可能追问

::: details strictNullChecks 关掉会怎样？
null 和 undefined 能赋值给任何类型，`const user: User = null` 不报错，`find()` 的返回值也不会带 `| undefined`，最常见的"读取 undefined 的属性"错误就检查不出来了。它是 strict 里收益最大的一项，新项目一定要开。
:::

::: details include、exclude、files 有什么区别？
`files` 逐个列出文件；`include` 用通配符指定范围；`exclude` 只是从 include 的结果里剔除，被其他文件 import 的文件仍会被编译。所以把某个文件写进 exclude 却还在报错，通常是因为它被别的文件引用了。
:::

::: details 为什么 tsc 报错了，Vite 照样能跑？
Vite 用 Oxc、esbuild 这类转译器处理 TS（不同版本用的工具不同），只转换语法、删除类型，不做类型检查，所以类型错误不影响开发服务器。类型检查要单独跑 `tsc --noEmit`（Vue 项目用 `vue-tsc`），一般放在构建脚本和 CI 里，详见 [tsc、Babel、esbuild 的区别](/basics/typescript/20-transpile)。另外 TS 7.0 还没有提供编程 API，官方公告说 Vue、Svelte、Astro 这类嵌入了 TS 的项目暂时要继续用 TS 6.0，vue-tsc 也要搭配 6.0 使用。
:::

## 易错点

- lib 写了新版本不等于运行环境支持，TS 不补任何 API
- paths 只影响类型解析，打包工具不配置别名，运行时照样找不到模块
- `moduleResolution: bundler` 的代码直接放到 Node.js 上运行，常因为缺少文件扩展名而报错
- 升级到 TS 6.0 以上后，`types` 默认变成空数组，原本自动可用的 `process`、`describe` 等全局类型会报找不到
