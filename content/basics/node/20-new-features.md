---
difficulty: 1
tags: [新特性, 高频]
---

# Node.js 近几年有哪些值得关注的新能力？

::: tip 一句话回答
这几年 Node.js 把很多原来要靠第三方包的能力**内置**了：全局的 **`fetch`** 和 **`WebSocket`** 客户端，测试运行器 **`node:test`**，**`--watch`** 监听文件变化自动重启，**`--env-file`** 读取 `.env` 文件，**权限模型** `--permission`，直接运行 `.ts` 文件的**类型剥离**，CommonJS 中 **`require()` ES 模块**，以及内置的 **`node:sqlite`**。它们能替代 node-fetch、ws（客户端部分）、nodemon、dotenv 等依赖，减少依赖数量和供应链风险。版本上，到 Node.js 26 为止都是**偶数版本进入 LTS**，生产环境应该使用 LTS 版本。
:::

## 详细解析

### 内置能力一览

| 能力 | 用法 | 状态（以官方文档为准） |
| --- | --- | --- |
| `fetch` | 全局可用，和浏览器的 API 一致，底层基于 undici | 18 起默认可用，21 起稳定 |
| `WebSocket` 客户端 | 全局的 `WebSocket` 类，用法同浏览器 | 22 起默认可用，已稳定；只有客户端，服务端仍需要 ws 等库 |
| `node:test` | `node --test` 运行测试，内置 mock、快照、覆盖率 | 20 起稳定；覆盖率功能仍是实验性的 |
| `--watch` | `node --watch app.js`，依赖的文件变化后自动重启 | 22 起稳定 |
| `--env-file` | `node --env-file=.env app.js`，也可以在代码中调用 `process.loadEnvFile()` | 20.6 加入，较新版本已不再是实验性的 |
| 权限模型 | `--permission` 开启后，文件系统、子进程、Worker 等默认禁止（较新版本还包括网络），用 `--allow-fs-read` 等参数放开 | 22.13 起稳定 |
| 类型剥离 | `node app.ts` 直接运行 TS 文件 | 22.18 起默认开启，较新版本已稳定 |
| `require(esm)` | CommonJS 中 `require()` 不含顶层 await 的 ES 模块 | 20.19、22.12 起默认开启，较新版本已稳定 |
| `node:sqlite` | 内置的同步 SQLite 接口 | 22.5 加入，较新版本处于"候选发布"阶段，还不是稳定版 |

### 类型剥离：能做什么、不能做什么

Node.js 把类型注解**替换成空白**后直接执行，所以行号不变、不需要 source map，但：

- **不做类型检查**，类型检查还是要在 CI 中跑 `tsc --noEmit`
- **不读取 `tsconfig.json`**，`paths` 别名、语法降级都不支持；需要别名时用 `package.json` 的 `imports` 字段（`#` 开头）
- 只支持**可擦除的语法**：`enum`、带运行时代码的 `namespace`、构造函数的参数属性、装饰器这些需要生成代码的语法会报错
- 导入时必须写 `.ts` 扩展名，只导入类型时必须写 `import type`
- 不处理 `node_modules` 中的 `.ts` 文件，发布到 npm 的包仍要编译成 JS

TypeScript 提供了配套的编译选项：`erasableSyntaxOnly` 禁止写不可擦除的语法，`verbatimModuleSyntax` 强制类型导入写 `import type`，`rewriteRelativeImportExtensions` 在需要编译产物时把 `.ts` 扩展名改写成 `.js`。TS 的编译方式对比见 [TypeScript 是怎么编译的](/basics/typescript/20-transpile)。

### 权限模型的定位

官方文档把它描述为"安全带"：防止**可信的代码**意外访问没有授权的资源，比如脚本写错路径删了不该删的文件，或者某个依赖的 bug 让它读写了项目目录之外的文件。它**不能防御恶意代码**，文档明确说恶意代码可以绕过它；符号链接也会被跟随到授权目录之外。适合用来给脚本、构建工具、处理不可信文件的服务加一层限制，不能代替其他安全措施，见 [Node.js 服务常见的安全问题](/basics/node/16-security)。

### 版本和 LTS 策略

- 每个主版本发布后先处于 **Current** 阶段约 6 个月，这段时间给库作者适配
- 到 Node.js 26 为止：**奇数版本**在 Current 阶段结束后就停止维护；**偶数版本**进入 **LTS**（长期支持），先是 Active LTS，再进入 Maintenance LTS，总共大约 30 个月
- 官方已经宣布从 Node.js 27 起改为每年一个主版本，不再区分奇偶，每个主版本都会进入 LTS；正式发布前增加一段 Alpha 阶段，供库作者提前测试。具体日程以官方的发布计划为准
- 生产环境只用 Active LTS 或 Maintenance LTS；升级前看官方的变更日志和废弃 API 列表

## 代码示例

```ts
// sum.test.ts —— 用 node --test 运行；类型剥离开启时会自动找到 .test.ts 文件
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sum } from './sum.ts' // 直接运行 .ts 时，导入要写完整的扩展名

test('sum', () => {
  assert.equal(sum(1, 2), 3)
})

test('用 mock 替换全局 fetch', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true })) // 测试结束自动还原
  const res = await fetch('https://example.com/api')
  assert.deepEqual(await res.json(), { ok: true })
})
```

```ts
// app.ts —— node --env-file=.env app.ts
import { DatabaseSync } from 'node:sqlite' // 较新版本中这个类改名为 Database，旧名作为废弃的别名保留

interface User { id: number; name: string }

console.log(process.env.DB_HOST) // 由 --env-file 从 .env 注入，不需要 dotenv

const db = new DatabaseSync(':memory:')
db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
db.prepare('INSERT INTO users (name) VALUES (?)').run('Alice')
const user = db.prepare('SELECT * FROM users WHERE id = ?').get(1) as unknown as User
console.log(user.name)
```

```bash
# 只允许读取当前目录，写文件、创建子进程都会抛出 ERR_ACCESS_DENIED
node --permission --allow-fs-read=./ app.js
```

## 面试官可能追问

::: details 有了内置的 fetch，还需要 axios 吗？
大多数场景不需要了：内置 `fetch` 支持流式响应体、`AbortSignal` 超时和取消。axios 额外提供的是拦截器、自动 JSON 转换、更友好的错误处理（`fetch` 对 4xx、5xx 不会 reject，要自己检查 `res.ok`），这些自己封装一层就能实现。需要精细控制连接池、代理等底层行为时，可以直接用 undici 包。
:::

::: details 能用 node:test 替代 Jest 或 Vitest 吗？
写 Node.js 库和服务的单元测试完全够用：内置 `describe` / `it`、mock、定时器模拟、快照和并发执行，不需要安装依赖，启动也快。前端项目通常还是用 Vitest：它能复用 Vite 的转换配置，支持 JSX、CSS 模块和组件测试，生态也更完整。
:::

::: details 有了类型剥离，还需要编译 TypeScript 吗？
开发时运行脚本、写服务端代码可以直接运行 `.ts` 文件，省掉构建步骤。但发布到 npm 的包仍然要编译成 JS 并生成 `.d.ts`，因为 Node.js 不处理 `node_modules` 中的 TS 文件；用了 `enum`、装饰器等语法的项目（比如 NestJS）也还需要 tsc 或其他编译工具。类型检查在任何情况下都要单独运行。
:::

## 易错点

- 以为 `node app.ts` 会做类型检查：它只是删掉类型，类型错误照样能运行
- 把权限模型当成运行不可信代码的沙箱
- 在生产环境使用还处于 Current 阶段的版本（26 及以前的奇数版本永远不会进入 LTS），或者长期停留在已经停止维护的版本
- 文章、教程里的版本号很快过时，用某个特性前先查当前版本的官方文档确认它的稳定状态
