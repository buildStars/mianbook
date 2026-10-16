---
difficulty: 2
tags: [原理]
---

# package.json 的 main、module、exports 字段有什么区别？

::: tip 一句话回答
**`main`** 是最早的入口字段，Node.js 和打包工具都认，没有 `exports` 时才生效。**`module`** 是打包工具之间约定俗成的 **ESM 入口**，Node.js 本身完全不读它。**`exports`** 是 Node.js 官方的入口字段，**优先级高于 `main`**，有两个作用：按 `import`、`require`、`types`、`default` 等**条件**指向不同文件，条件按**书写顺序**匹配，第一个命中的生效；同时**封装**整个包，没声明的子路径外部导入会报错。另外 `type: "module"` 决定 `.js` 文件按 ESM 还是 CommonJS 解析，`types` 给 TypeScript 找声明文件，`sideEffects` 给打包工具做 tree shaking。
:::

## 详细解析

### 各个字段由谁读取

| 字段 | 谁会读 | 作用 |
| --- | --- | --- |
| `main` | Node.js、打包工具、TypeScript（没有 `exports` 或用旧解析模式时） | 传统入口，没有 `exports` 时使用 |
| `module` | webpack、Rollup、Vite 等打包工具 | ESM 入口，Node.js 忽略 |
| `browser` | 打包工具 | 浏览器环境用的替代入口 |
| `exports` | Node.js、打包工具、TypeScript（`node16`、`nodenext`、`bundler` 解析模式） | 条件导出和封装，存在时优先于以上字段 |
| `type` | Node.js、打包工具 | 决定 `.js` 文件的模块格式 |
| `types` | TypeScript | 声明文件入口 |
| `sideEffects` | 打包工具 | 声明哪些文件有副作用 |

`module` 字段出现得比 `exports` 早：当时 Node.js 还不支持 ESM，库作者用 `main` 给 Node.js 提供 CommonJS，用 `module` 给打包工具提供 ESM，打包工具就能做 tree shaking。打包工具在包有 `exports` 时也会优先读 `exports`，`main`、`module` 只作为兜底，例如 Vite 的文档明确说从 `exports` 解析成功后就忽略这些字段。Node.js 查找模块的完整流程见 [Node.js 模块加载](/basics/node/11-module-resolution)，这里从发布库的角度讲怎么写。

### exports 的条件导出

- **Node.js 内置的条件**：`import`（被 `import` 或 `import()` 加载）、`require`（被 `require()` 加载）、`node`（在 Node.js 中）、`default`（兜底）等
- **社区约定的条件**：`types`（给类型系统，**要写在最前面**）、`browser`、`development` / `production`。Node.js 默认不认这些，打包工具会按自己的配置额外匹配，例如 Vite 默认还匹配 `module`、`browser` 和 `development` / `production`
- **按书写顺序匹配**：Node.js 从上往下找第一个满足的条件，所以条件要从具体到宽泛排列，`default` 放最后。把 `default` 写在 `import` 前面，`import` 永远不会被用到
- **可以嵌套**：`{ "node": { "import": ..., "require": ... }, "default": ... }`，内层都不满足时继续检查外层剩下的条件

### exports 的封装

声明了 `exports` 之后，只有列出来的路径可以被导入。`import 'my-lib/dist/esm/internal.js'` 会抛出 `ERR_PACKAGE_PATH_NOT_EXPORTED`，`package.json` 本身也一样，需要读取时要显式导出 `"./package.json"`。

- 子路径可以用 `*` 模式批量导出：`"./utils/*": "./dist/esm/utils/*.js"`，`*` 只是字符串替换
- 值写成 `null` 可以把某些路径排除在外，比如 `"./utils/internal/*": null`
- 给已有的包**新加** `exports`，原来能用的深层导入会全部失效，属于破坏性变更。要么升主版本，要么把以前支持的入口都列进去

### type 和文件扩展名

- `type: "module"`：包里的 `.js` 按 ESM 解析；不写或写 `"commonjs"`：`.js` 按 CommonJS 解析
- 不管 `type` 是什么，`.mjs` 永远是 ESM，`.cjs` 永远是 CommonJS
- 同时发两种格式时，一般 `type: "module"`，ESM 产物用 `.js`，CommonJS 产物用 `.cjs`

两种模块格式本身的区别见 [ES Module 和 CommonJS](/basics/javascript/17-esm-vs-cjs)。

### types 和 TypeScript

TypeScript 在 `node16`、`nodenext`、`bundler` 模式下按 `exports` 找声明文件，顶层的 `types` 字段不起作用：匹配到的条件里有 `types` 就用它指定的文件，没有就在匹配到的 JS 文件旁边找同名的声明文件（如 `index.js` 对应 `index.d.ts`）。ESM 和 CommonJS 两份产物各自需要一份声明文件（`.d.ts` / `.d.cts`），写在 `import`、`require` 各自的嵌套条件里，否则声明文件的模块格式和实际的 JS 对不上，TypeScript 会按错误的格式检查使用方的导入。顶层的 `types`、`main` 仍然建议保留，给使用旧解析模式的项目兜底。声明文件的写法见 [声明文件](/basics/typescript/10-declaration-files)。

## 代码示例

一个同时提供 ESM 和 CommonJS 的库：

```json
{
  "name": "my-lib",
  "type": "module",
  "main": "./dist/cjs/index.cjs",
  "module": "./dist/esm/index.js",
  "types": "./dist/types/index.d.ts",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/types/index.d.ts",
        "default": "./dist/esm/index.js"
      },
      "require": {
        "types": "./dist/types/index.d.cts",
        "default": "./dist/cjs/index.cjs"
      }
    },
    "./utils/*": "./dist/esm/utils/*.js",
    "./package.json": "./package.json"
  },
  "sideEffects": false,
  "files": ["dist"]
}
```

```js
// 使用方的 ESM 代码
import { format } from 'my-lib' // 命中 import 条件 → dist/esm/index.js
import { d } from 'my-lib/utils/date' // 命中 ./utils/* → dist/esm/utils/date.js
import 'my-lib/dist/esm/internal.js' // ❌ ERR_PACKAGE_PATH_NOT_EXPORTED

// 使用方的 CommonJS 代码
const lib = require('my-lib') // 命中 require 条件 → dist/cjs/index.cjs
```

`main`、`module`、顶层 `types` 是给不支持 `exports` 的老工具准备的，支持 `exports` 的环境只看 `exports`。`sideEffects` 的作用见 [Tree Shaking](/basics/build/04-tree-shaking)。

## 面试官可能追问

::: details 同时发布 ESM 和 CJS 两份产物会有什么问题？
同一个应用里，一部分代码 `import` 这个包、另一部分 `require` 它，就会分别加载两份产物，得到两个独立的模块实例：模块里的单例、缓存、注册表各有一份，`instanceof` 也会判断失败。这叫双包风险。规避办法是让状态只存在一份，比如 ESM 入口只是对 CommonJS 实现的一层薄包装，`import cjs from './index.cjs'` 再重新导出；或者干脆只发 ESM，较新的 Node.js 已经能直接 `require` 不含顶层 await 的 ES 模块。
:::

::: details 为什么我的库在 webpack 里能用，到 Node.js 里就报找不到模块？
最常见的原因是只写了 `module` 字段，或者 `exports` 里只给了 `import` 条件。打包工具认 `module`，Node.js 不认，`require` 时又匹配不到条件。另一个常见原因是 ESM 产物里的相对导入没写扩展名，打包工具能自动补全，Node.js 的 ESM 不能。发布前用 Node.js 分别 `import` 和 `require` 一次，或者用 publint、arethetypeswrong 这类工具检查入口和类型声明。
:::

::: details exports 里的 browser 条件和顶层 browser 字段有什么区别？
顶层 `browser` 字段是打包工具的老约定，可以整体替换入口，也可以用对象把某些文件替换成浏览器版本，或者写 `false` 屏蔽 Node.js 专用模块。`exports` 里的 `browser` 是条件导出的一个条件，只用于选择入口。两者都只有打包工具会读，Node.js 不认。
:::

## 易错点

- 以为 Node.js 会读 `module` 字段，实际上它只给打包工具用
- `exports` 里 `default` 写在 `import`、`require` 前面，或者 `types` 没放在第一个，后面的条件匹配不到
- 给已发布的包新加 `exports` 却只升了小版本，依赖深层路径的使用方直接报错
- 有了 `exports` 还去改 `main` 想修复入口问题，支持 `exports` 的环境根本不看 `main`
