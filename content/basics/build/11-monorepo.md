---
difficulty: 2
tags: [实践, 高频]
---

# monorepo 是什么？pnpm workspace 和 Turborepo 怎么用？

::: tip 一句话回答
monorepo 是把多个相关的项目和包放在**同一个仓库**里管理，好处是代码共享方便、跨包修改可以在一次提交里完成、工具链和规范统一；代价是仓库变大，构建和权限管理更复杂。**pnpm workspace** 解决包之间的链接：用 `workspace:` 协议引用本地包，安装时直接链接源码目录。**Turborepo** 解决任务编排：按依赖拓扑顺序运行任务，根据输入计算哈希来**缓存结果**，没改动的包直接复用，还支持**远程缓存**让团队和 CI 共享。发版通常配合 **changesets** 管理版本号和变更日志。
:::

## 详细解析

### monorepo 和多仓库

| | monorepo | 多仓库（polyrepo） |
| --- | --- | --- |
| 代码共享 | 直接引用本地包，改完立即生效 | 先发布到 npm，再到各仓库升级版本 |
| 跨项目修改 | 一次提交、一个 PR | 多个仓库分别提交，按顺序发布 |
| 依赖和工具链 | 统一版本、统一配置 | 各自维护，容易不一致 |
| 构建和 CI | 需要增量构建，否则越来越慢 | 每个仓库各自独立，规模小 |
| 权限 | 粒度粗，要靠 CODEOWNERS 等方式控制 | 可以按仓库分配权限 |

适合 monorepo 的情况：组件库、工具包和使用它们的应用由同一个团队维护，经常需要一起修改。团队之间相互独立、发布节奏差异很大时，多仓库反而更省事。

### pnpm workspace

1. 在根目录的 `pnpm-workspace.yaml` 里声明哪些目录是子包
2. 子包之间用 `workspace:` 协议声明依赖，例如 `"@demo/utils": "workspace:*"`，pnpm 只会从本地工作区解析它，在 `node_modules` 中创建指向源码目录的符号链接
3. 执行 `pnpm publish` 时，`workspace:*` 会被替换成被依赖包当时的具体版本，`workspace:^` 替换成 `^` 加版本号，发布出去的包不会带着 `workspace:`
4. 用 `--filter` 选择要操作的包：`pnpm --filter web dev`、`pnpm --filter @demo/utils add dayjs`；`pnpm -r build` 在所有包中执行，并且按依赖顺序执行

公共的开发依赖（TypeScript、ESLint）可以用 `pnpm add -Dw` 装在根目录。pnpm 的严格依赖结构能避免子包之间互相"借用"没有声明的依赖，见 [幽灵依赖](/basics/node/10-package-managers)。

### 任务编排与缓存：Turborepo 的思路

包一多，"每次全量构建"就不可接受了。Turborepo、Nx 这类工具的核心思路一致：

1. **依赖拓扑**：根据各包 `package.json` 里的依赖关系建出任务图，`dependsOn: ["^build"]` 表示先构建它依赖的包，没有依赖关系的任务并行执行
2. **内容哈希缓存**：把源码文件、依赖包的哈希、环境变量、任务配置一起算出一个哈希。哈希和之前一致就跳过执行，直接还原 `outputs` 里的产物和日志
3. **增量构建**：只改了 `packages/utils`，就只重新构建它和依赖它的包；`--filter`、`--affected` 可以只运行受影响的包
4. **远程缓存**：缓存存到远端，同事和 CI 都能命中同一份结果。Turborepo 用 `turbo login` 和 `turbo link` 连接远程缓存，也可以自建兼容的缓存服务

### 版本发布：changesets

1. 每次提交需要发版的改动时，执行 `pnpm changeset`，选择受影响的包和升级类型（major / minor / patch），写一句变更说明，生成一个 `.changeset/*.md` 文件，随代码一起提交
2. 发版时执行 `pnpm changeset version`：消费所有 changeset 文件，升级版本号、更新依赖它的内部包、写入 `CHANGELOG.md`
3. 执行 `pnpm changeset publish`：把版本号高于 npm 上已有版本的包发布出去，并打上 git tag

在 CI 中通常用 changesets 提供的 GitHub Action 自动开一个"版本 PR"，合并后再自动发布。

## 代码示例

```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

上面是根目录的 `turbo.json`（Turborepo 1.x 中这个字段叫 `pipeline`，2.x 改名为 `tasks`）。常用命令：

```bash
pnpm turbo run build                     # 按拓扑顺序构建所有包，命中缓存的直接跳过
pnpm turbo run build --filter=web...     # 只构建 web 及它依赖的包
pnpm turbo run test --affected           # 只运行当前分支改动影响到的包
```

## 面试官可能追问

::: details Turborepo 的缓存什么时候会失效？命中错了怎么办？
输入的哈希变了就失效：包内的源码文件、依赖包的哈希、`turbo.json` 中这个任务的配置、声明过的环境变量。最常见的"错误命中"是构建结果依赖某个环境变量，却没有在 `env` 里声明，结果不同环境复用了同一份产物。另一种是 `outputs` 写漏了，缓存命中后产物不完整。排查时用 `--dry` 查看任务的哈希和输入，必要时用 `--force` 跳过缓存。
:::

::: details 子包要不要先构建才能被其他包使用？
两种做法都常见。一种是子包的 `main` 指向构建后的 `dist`，依赖方使用前必须先构建，靠 `dependsOn: ["^build"]` 保证顺序。另一种是"内部包"直接指向源码，由应用的构建工具一起编译，省掉了子包的构建步骤，开发时改了立即生效，但要求应用的构建配置能处理子包的源码（TypeScript、JSX 等）。
:::

::: details Turborepo 和 Nx 有什么区别？
核心都是任务图加缓存。Turborepo 配置少，主要做任务编排和缓存，上手快。Nx 功能更多：代码生成器、按框架提供的插件、依赖关系可视化、模块边界约束等，适合规模更大、需要更强治理能力的仓库。只用到任务缓存时，两者差别不大。
:::

## 易错点

- `workspace:*` 只在工作区内有效，用 npm 直接发布不会被替换，要用 `pnpm publish` 或 changesets
- `turbo.json` 的 `outputs` 写漏，缓存命中后产物缺失；`dev` 这类常驻任务忘了设置 `cache: false`
- 以为 monorepo 就是"所有代码放在一个仓库里"，没有任务缓存和依赖边界，仓库越大 CI 越慢
- 根目录的依赖被子包直接引用而没有在子包里声明，子包单独发布后就找不到依赖
