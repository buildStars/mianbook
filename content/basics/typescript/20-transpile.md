---
difficulty: 2
tags: [对比, 实践]
---

# tsc、Babel、esbuild 编译 TypeScript 有什么区别？isolatedModules 是什么？

::: tip 一句话回答
**tsc** 是官方编译器，会读取整个项目的类型信息，**做类型检查**，再输出 JS 和 `.d.ts`。**Babel、esbuild、swc** 这类工具**只做转译**：一次处理一个文件，删掉类型、转换语法，**不做类型检查**，所以快得多，但要另外跑 `tsc --noEmit` 检查类型。单文件转译看不到其他文件，有些写法处理不了，比如跨文件的 `const enum`、没写 `export type` 的类型重导出。**`isolatedModules`** 就是让 tsc 把这些写法提前报出来；**`verbatimModuleSyntax`** 更进一步，要求类型导入导出都显式写 `type`。常见组合是：转译交给构建工具，tsc 只负责类型检查。
:::

## 详细解析

### 两类工具的区别

| | tsc | Babel / esbuild / swc |
| --- | --- | --- |
| 类型检查 | 有 | 没有，类型错误照样输出 |
| 处理单位 | 整个项目，能跨文件分析类型 | 一次一个文件 |
| 输出 `.d.ts` | 能 | 一般不能 |
| 速度 | 较慢，要建立完整的类型信息 | 快，只做语法层面的删除和转换 |
| 典型位置 | `tsc --noEmit` 做检查；库用它输出声明文件 | Vite、webpack 的 loader、测试框架里转译代码 |

转译工具删除类型的方式很直接：遇到类型标注、interface、`import type` 就删掉，其余原样输出。它们不知道某个导入的名字到底是类型还是值，这就是下面那些限制的来源。Babel 的工作原理见 [Babel 的原理](/basics/build/07-babel)，各构建工具的对比见 [构建工具的区别](/basics/build/10-bundlers)。

TS 7.0 起官方编译器改用 Go 原生实现，类型检查快了很多，但"检查和转译分工"的思路不变。

### 单文件转译处理不了的写法

```ts
// 文件：types.ts
export interface User {
  id: number
}
export const VERSION = 1

// 文件：index.ts
export { User } from './types' // ❌ 转译工具不知道 User 是类型，会原样保留这行导出
export { VERSION } from './types'
```

转译 `index.ts` 时看不到 `types.ts`，`export { User }` 被当作值导出保留下来；而 `types.ts` 编译后根本没有 `User`，运行时就会报"找不到导出"。改成 `export type { User } from './types'`，转译工具看到 `type` 就知道可以删掉。

同类的问题还有：

- **引用 `.d.ts` 里声明的 const enum**：要知道枚举的值才能把引用内联成常量，而声明文件里的枚举运行时并不存在，见 [enum 的问题](/basics/typescript/08-enum)。在普通 .ts 文件里定义的 const enum，转译工具会当作普通 enum 输出，不受影响
- **全局脚本里的 namespace**：没有 import / export 的文件不是模块，单文件转译无法正确处理

### isolatedModules 和 verbatimModuleSyntax

**isolatedModules** 不改变编译结果，只是让 tsc 对"单文件转译处理不了"的写法报错。上面的 `export { User }` 会报 TS1205，要求改成 `export type`。用 Vite、esbuild 等工具的项目都应该开启，Vite 文档也建议开启。

**verbatimModuleSyntax**（TS 5.0 起）规则更简单：没有 `type` 修饰的导入导出**原样保留**，带 `type` 的**整条删除**，编译器不再自己判断哪些导入只用作类型。它包含了 isolatedModules 的检查，而且只用作类型的导入不写 `type` 也会报错：

```ts
// 文件：use.ts
// ❌ 写成 import { User, VERSION } from './types' 会报 TS1484：User 是类型，必须用仅类型导入
import { type User, VERSION } from './types' // ✅ 行内 type 修饰，编译后只剩 import { VERSION }
import type { User as Admin } from './types' // ✅ 整条仅类型导入，编译后整行删除

const user: User = { id: VERSION }
const admin: Admin = user
```

好处是"写的是什么，输出就是什么"，不同工具的输出结果一致。新项目推荐开启。

### Node.js 直接运行 .ts

Node.js 内置了**类型剥离**（v23.6.0 和 v22.18.0 起默认开启），可以直接运行 .ts 文件。它的做法和转译工具类似但更保守：

- 只把类型标注替换成空白，**不做类型检查**，也**不读取 tsconfig**，`paths` 别名不生效
- 不支持需要生成代码的语法：enum、带运行时代码的 namespace、参数属性、装饰器等
- 仅类型的导入必须写 `import type`；相对导入必须写完整扩展名，如 `./util.ts`；不支持 .tsx
- 不处理 `node_modules` 里的 .ts 文件

想让代码同时适用于类型剥离，可以在 tsconfig 里开启 `erasableSyntaxOnly`（禁止上述需要生成代码的语法）、`verbatimModuleSyntax`，以及允许导入路径写 `.ts` 的 `rewriteRelativeImportExtensions`。Node.js 的其他新能力见 [Node.js 近几年的新能力](/basics/node/20-new-features)。

## 代码示例：常见的工程组合

```json
{
  "scripts": {
    "dev": "vite",
    "typecheck": "tsc --noEmit",
    "build": "tsc --noEmit && vite build"
  }
}
```

- **前端应用**：构建工具负责转译和打包，`tsc --noEmit` 放在 build 脚本和 CI 里；开发时编辑器实时提示，也可以另开 `tsc --noEmit --watch`
- **npm 库**：用打包工具或 tsc 输出 JS，用 tsc（如 `--emitDeclarationOnly`）输出 `.d.ts`
- **Node.js 服务**：开发时用类型剥离或 tsx 这类工具直接运行，CI 里跑 `tsc --noEmit`；生产环境可以先用 tsc 编译成 JS 再部署

## 面试官可能追问

::: details 只用 esbuild 不跑 tsc 会怎样？
代码照样能编译、能运行，但所有类型错误都被忽略，类型就只剩编辑器里的提示，没人看就等于没有。必须在 CI 或构建脚本里跑 `tsc --noEmit`，类型检查失败就阻止合并和发布。
:::

::: details import type 和普通 import 只导入类型，输出有什么不同？
不开 verbatimModuleSyntax 时，tsc 会自动删除只用作类型的导入，两者输出一样；但单文件转译工具不一定能判断。开启 verbatimModuleSyntax 后规则固定：普通 import 一定保留，`import type` 一定删除。如果一个模块有副作用（比如注册全局样式），只写了类型导入，它在运行时就不会被加载。
:::

::: details isolatedDeclarations 是什么？
TS 5.5 加入的选项，要求导出的函数、变量都写明显式的类型标注，这样不需要类型推断就能逐个文件生成 `.d.ts`。思路和 isolatedModules 一样，是为了让其他工具能并行、单文件地生成声明文件，适合大型库和 monorepo。
:::

## 易错点

- Babel、esbuild、swc 不做类型检查，构建成功不代表没有类型错误
- 重导出类型要写 `export type`，否则单文件转译后运行时报找不到导出
- Node.js 类型剥离不读 tsconfig，`paths` 别名和 enum 都不能用
- isolatedModules 只是报错提示，不改变输出；verbatimModuleSyntax 会改变导入导出的保留规则
