---
difficulty: 2
tags: [高频, 对比]
---

# npm、yarn、pnpm 有什么区别？版本号和 lock 文件是怎么回事？

::: tip 一句话回答
版本号遵循**语义化版本** `主版本.次版本.修订号`：`^1.2.3` 允许升级到 `2.0.0` 以下的任意版本，`~1.2.3` 只允许修订号升级（低于 `1.3.0`）。版本范围在不同时间会解析出不同的版本，所以要用 **lock 文件**锁定整棵依赖树的确切版本和完整性校验值，并提交到仓库，CI 里用 `npm ci` 严格按 lock 文件安装。npm 和 Yarn 1.x 会把依赖**扁平化**提升到 `node_modules` 顶层，带来**幽灵依赖**（能引用没有声明的包）和**依赖分身**（同一个版本被重复安装）；pnpm 把包存进全局的**内容寻址存储**，在 `node_modules` 里用**符号链接**还原真实的依赖关系，既省磁盘又避免了幽灵依赖。
:::

## 详细解析

### 语义化版本

不兼容的改动升主版本，向下兼容的新功能升次版本，向下兼容的问题修复升修订号。

| 写法 | 允许的范围 | 说明 |
| --- | --- | --- |
| `1.2.3` | 只能是 1.2.3 | 精确版本 |
| `^1.2.3` | `>=1.2.3 <2.0.0` | `npm install` 默认写入的形式 |
| `~1.2.3` | `>=1.2.3 <1.3.0` | 只接受修订号升级 |
| `^0.2.3` | `>=0.2.3 <0.3.0` | `^` 不允许改动最左边那个非 0 的数字，0.x 版本因此更保守 |
| `^0.0.3` | `>=0.0.3 <0.0.4` | 相当于精确版本 |

语义化版本只是约定，发布者也可能在次版本里带进破坏性改动。而且同样写着 `^1.2.3`，今天和三个月后执行 `npm install`，装到的版本可能不同。

### lock 文件

`package-lock.json`、`yarn.lock`、`pnpm-lock.yaml` 记录了依赖树中每个包（包括间接依赖）的确切版本、下载地址和完整性哈希（integrity）：

- **可复现**：所有开发者、CI 和生产环境装出完全相同的依赖树
- **防篡改**：下载到的包和记录的哈希对不上时，安装失败
- **要提交到仓库**：应用项目必须提交。库的 `package-lock.json` 不会随包发布，使用者安装时也不会读取它，但提交后能让库自身的开发和测试环境保持一致

| | `npm install` | `npm ci` |
| --- | --- | --- |
| 依据 | `package.json`，lock 文件满足范围时按 lock 安装 | 只按 lock 文件安装 |
| lock 和 `package.json` 对不上时 | 重新解析并更新 lock 文件 | 直接报错退出 |
| 是否修改 lock 文件 | 可能修改 | 从不修改 |
| `node_modules` | 在已有的基础上增量安装 | 先删除，再全新安装 |
| 用途 | 本地开发、增删依赖 | CI、构建和部署 |

pnpm 对应 `pnpm install --frozen-lockfile`（CI 环境中默认开启）；Yarn 1.x 是 `--frozen-lockfile`，Yarn 2 及以后是 `--immutable`。

### 扁平化：幽灵依赖和依赖分身

npm 早期按依赖树严格嵌套安装，路径很深，同一个包重复很多份。npm 3 起改为把依赖尽量**提升**到顶层的 `node_modules`（Yarn 1.x 也是这样），版本冲突的才嵌套在各自目录下：

```text
项目声明了 A、D、E；A 依赖 B 和 C@1，D 和 E 都依赖 C@2

node_modules
├── A
├── B           ← 被提升到顶层，项目没有声明它，却能直接 import（幽灵依赖）
├── C (1.0)     ← 顶层的同一个包只能放一个版本
├── D
│   └── node_modules/C (2.0)
└── E
    └── node_modules/C (2.0)   ← 同一个版本又装了一份（依赖分身）
```

- **幽灵依赖**：A 升级后不再依赖 B，或者顶层的 B 换成了别的版本，项目代码会在某次安装后突然报错
- **依赖分身**：浪费磁盘和安装时间；同一个库被加载两份，模块级的状态也有两份，可能出现 `instanceof` 判断失败、单例变成两个（见 [单例模式](/basics/design-pattern/01-singleton)）

### pnpm 的做法

```text
node_modules
├── A -> .pnpm/A@1.0.0/node_modules/A      顶层只有声明过的直接依赖，都是符号链接
└── .pnpm
    ├── A@1.0.0/node_modules
    │   ├── A                              包的文件链接到全局 store，不重复占用磁盘
    │   ├── B -> ../../B@1.0.0/node_modules/B
    │   └── C -> ../../C@1.0.0/node_modules/C
    ├── B@1.0.0/node_modules/B
    └── C@1.0.0/node_modules/C
```

1. **内容寻址存储**：所有项目共用一个全局 store，文件按内容的哈希存放，同样的文件在磁盘上只存一份，再通过硬链接等方式放进各个项目
2. **符号链接还原依赖关系**：每个包的依赖以符号链接的形式放在它旁边，Node.js 按正常的模块解析规则就能找到
3. **严格**：项目代码只能引用 `package.json` 里声明过的包，幽灵依赖在开发阶段就会报错

代价是少数依赖"包被提升到顶层"的旧工具会出问题，可以用 `publicHoistPattern` 把指定的包提升到顶层，或者开启 `shamefullyHoist` 退回扁平结构（pnpm 11 起这类配置写在 `pnpm-workspace.yaml` 中；旧版本写在 `.npmrc` 里，如 `shamefully-hoist=true`）。Yarn 2 及以后默认的 Plug'n'Play 模式更进一步，不生成 `node_modules`，用一张映射表告诉 Node.js 每个包在哪里。

### 三种依赖字段

| 字段 | 含义 | 例子 |
| --- | --- | --- |
| `dependencies` | 运行时需要，别人安装你的包时会一起安装 | express、vue、dayjs |
| `devDependencies` | 只在开发和构建时需要，别人安装你的包时不会安装 | vite、typescript、eslint |
| `peerDependencies` | 要求宿主项目提供，和宿主共用同一份 | 组件库要求 vue，ESLint 插件要求 eslint |

npm 7 起会自动安装 peerDependencies，版本冲突时报 `ERESOLVE` 错误。

## 面试官可能追问

::: details lock 文件合并冲突了怎么办？
不要手动改冲突的内容。先解决 `package.json` 里的冲突，再执行一次 `npm install`，npm 会根据两边的依赖重新生成合并后的 lock 文件；pnpm、Yarn 也能在安装时自动处理 lock 文件的冲突。之后检查依赖版本的变化是否符合预期，再提交。
:::

::: details 间接依赖有安全漏洞，上游还没升级，怎么办？
可以强制指定间接依赖的版本：npm 用 `package.json` 的 `overrides` 字段，Yarn 用 `resolutions`，pnpm 也有 `overrides` 配置。覆盖后要跑一遍测试，强制换版本可能破坏上游包的兼容性；上游发布修复版本后，优先升级上游。

```json
{
  "overrides": {
    "semver": "^7.5.2"
  }
}
```
:::

::: details dependencies 和 devDependencies 放错了会怎样？
要看项目类型。前端应用会被打包，运行时代码都进了产物，放错一般不影响运行。Node.js 服务部署时常用 `npm ci --omit=dev` 跳过开发依赖，运行时要用的包放在了 devDependencies 里，上线就会报找不到模块。发布到 npm 的库最危险：运行时依赖放进 devDependencies，使用者根本不会安装它，库自己的开发环境里却一切正常。
:::

::: details 安装时报 ERESOLVE 的 peer 依赖冲突，怎么办？
先看报错里是哪个包的要求冲突，比如某个插件要求 `vue@^2`，项目用的却是 Vue 3，应该换成支持当前版本的插件。`--legacy-peer-deps` 会跳过 peerDependencies 的检查，能让安装通过，但可能装上互不兼容的版本，到运行时才出错，只能作为临时手段。
:::

## 易错点

- `^0.2.3` 不是"小于 1.0.0 都可以"，而是只允许 0.2.x
- lock 文件没有提交，或者 CI 里用的是 `npm install` 而不是 `npm ci`
- 在 npm 下能运行，不代表依赖声明是完整的，可能只是碰巧用上了幽灵依赖
- 同一个项目混用多种包管理器，会产生多份 lock 文件和不一致的 `node_modules`
