---
difficulty: 1
tags: [对比, 新技术]
---

# Deno、Bun 和 Node.js 有什么区别？现在该怎么选？

::: tip 一句话回答
三者都是服务端 JavaScript 运行时。**Node.js** 生态最成熟，生产环境的首选；**Deno** 主打**默认安全**（访问文件、网络、环境变量都要用 `--allow-*` 显式授权）、原生 TypeScript 和内置的格式化、lint、测试工具，通过 `npm:`、`node:` 前缀兼容 npm 包；**Bun** 用 **JavaScriptCore** 引擎，把运行时、包管理器、打包器、测试运行器做成一个工具，主打启动和安装速度，并尽量兼容 Node.js API。生产服务优先看兼容性和团队经验，脚本、工具链和新项目可以尝试 Deno 或 Bun，迁移前用测试验证依赖。
:::

## 详细解析

### Node.js：生态和稳定性

Node.js 基于 V8 引擎，npm 上的绝大多数包都是为它写的，框架、APM、云厂商的运行时支持也最完整。它的短板曾经是工具链要自己拼：TypeScript 要编译，测试要装 Jest，`fetch` 要装库。这几年 Node.js 补上了很多：内置 `fetch`、`node:test` 测试运行器、`--watch`、类型剥离直接运行 `.ts`、权限模型等，详见 [Node.js 近几年的新能力](/basics/node/20-new-features)。很多当初"只有 Deno、Bun 才有"的差异已经变小了。

### Deno：默认沙箱和一体化工具链

Deno 同样基于 V8，核心卖点是**默认安全**：没有授权时，代码不能读写文件、访问网络、读环境变量，也不能启动子进程。

```bash
# 只允许读当前目录下的 data、访问 api.example.com，其他操作都会被拒绝
deno run --allow-read=./data --allow-net=api.example.com main.ts
```

- `--deny-*` 优先于 `--allow-*`；`-A`（`--allow-all`）等于关掉沙箱，只适合测试
- `--allow-run` 启动的子进程、`--allow-ffi` 加载的原生库都不受沙箱约束，评估风险时相当于给了全部权限
- 原生 TypeScript：Deno 剥离类型后交给 V8 运行，`deno run` 默认不做类型检查，要检查用 `deno check`
- 内置工具：`deno fmt`、`deno lint`、`deno test`、`deno compile`（打成独立可执行文件）等，不用再装 Prettier、ESLint
- 兼容 Node.js：内置模块用 `node:` 前缀导入，npm 包用 `npm:` 前缀（如 `npm:express`），也能识别 `package.json`；npm 包的 `postinstall` 等生命周期脚本默认不执行
- 第三方模块推荐用 JSR 注册表（`jsr:` 前缀）

### Bun：一个工具包办，追求速度

Bun 用的是 Safari 的 **JavaScriptCore** 引擎，不是 V8。官方文档现在的说法是它用 Rust 编写；不少资料里还是早期"用 Zig 编写"的说法，答题时按官方现在的说法讲即可。

- 一个 `bun` 可执行文件包含：运行时（定位是 Node.js 的直接替代品）、包管理器 `bun install`、打包器 `bun build`、测试运行器 `bun test`（尽量兼容 Jest 写法）
- 直接运行 TS、JSX，同样不做类型检查
- 依赖的生命周期脚本默认不执行，要把包名加进 `trustedDependencies`
- 自带不少服务端 API：`Bun.serve`、`Bun.file`、`bun:sqlite`、`Bun.password` 等，用了它们代码就不能直接在 Node.js 上跑
- 兼容性：官方会跑 Node.js 测试套件，把"Node.js 能跑而 Bun 不能"视为 Bun 的 bug；但兼容性页面上仍有一些模块标注为部分实现（如 `node:cluster`、`node:worker_threads` 的部分选项），依赖这些能力前要先查

### 怎么选

1. **已有的生产服务**：继续用 Node.js。换运行时的收益通常抵不过兼容性风险，APM、原生扩展、部署平台的支持也要逐个确认
2. **新项目、内部脚本、CLI 工具**：可以试 Bun 换来更快的安装和启动，或者用 Deno 的权限控制来运行不完全信任的脚本
3. **只换工具不换运行时**：比如只用 `bun install` 装依赖、用 `bun test` 跑测试，生产仍跑 Node.js，风险最小
4. **迁移前**：跑一遍完整测试，重点看原生 addon、`child_process`、`worker_threads`、`http` 的边缘行为，以及依赖 npm 目录结构的工具

| 维度 | Node.js | Deno | Bun |
| --- | --- | --- | --- |
| 引擎 | V8 | V8 | JavaScriptCore |
| 安全模型 | 默认不限制，有可选的权限模型 | 默认沙箱，`--allow-*` 授权 | 默认不限制 |
| TypeScript | 类型剥离后直接运行 | 原生支持 | 原生支持 |
| 工具链 | 包管理器、打包器等靠第三方 | fmt、lint、test、compile 内置 | 包管理、打包、测试内置 |
| npm 兼容 | 原生 | `npm:` 前缀、识别 package.json | 直接用 package.json 和 node_modules |
| 适合 | 生产服务、生态依赖重的项目 | 重视安全的脚本、TS 项目 | 追求开发速度的新项目和工具链 |

## 面试官可能追问

::: details Deno 的权限控制和 Node.js 的权限模型有什么区别？
Deno 是默认开启，不授权就不能访问；Node.js 的权限模型要用 `--permission` 主动开启，默认什么都不限制。两者都只是降低风险的手段，不能把不可信的代码当成安全隔离来跑，真正隔离还要靠容器或独立进程。
:::

::: details Bun 为什么安装依赖快？
它的包管理器是原生代码实现的，不跑在 JS 里，下载过的包放在全局缓存中，再次安装时直接复用。具体快多少和项目、网络、缓存状态有关，官方的对比数字只能当参考，自己的项目要自己测。
:::

::: details 用了 Bun 或 Deno 专属的 API，有什么代价？
代码被绑定到这个运行时，以后想换回 Node.js 要重写这部分。库和公共代码尽量用 Web 标准 API（`fetch`、`Request`、`Response`）和 `node:` 内置模块，专属 API 只放在应用入口这类容易替换的地方。
:::

## 易错点

- 说 Bun 基于 V8：Bun 用的是 JavaScriptCore，Node.js 和 Deno 才是 V8
- 以为 Deno 和 Bun 运行 TS 会做类型检查：两者默认都只剥离类型，类型错误不会阻止运行
- 以为"兼容 Node.js"等于百分之百兼容：两者都有部分实现的模块，原生 addon 和边缘 API 要实际验证
- 只看跑分做选型：框架、数据库驱动、监控和部署平台的支持往往比运行时本身的速度更重要
