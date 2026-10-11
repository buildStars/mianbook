---
difficulty: 2
tags: [实践, 高频]
---

# ESLint、Prettier 和 Git Hooks 怎么配合保证代码规范？

::: tip 一句话回答
**ESLint 管代码质量**（未使用的变量、`==`、Hooks 用法错误），**Prettier 管格式**（缩进、引号、换行）。两者的格式规则会冲突，用 **eslint-config-prettier** 关掉 ESLint 里和格式相关的规则，格式统一交给 Prettier。ESLint 9 起默认使用**扁平配置** `eslint.config.js`。提交时用 **husky** 注册 Git Hooks，在 pre-commit 里运行 **lint-staged**，只检查**暂存的文件**；在 commit-msg 里用 **commitlint** 校验提交信息。本地的检查可以被 `--no-verify` 跳过，所以 **CI 还要再跑一遍**。
:::

## 详细解析

### 分工：质量和格式

| | ESLint | Prettier |
| --- | --- | --- |
| 关心什么 | 可能的错误和不好的写法 | 代码长什么样 |
| 例子 | `no-unused-vars`、`eqeqeq`、`react-hooks/rules-of-hooks` | 分号、引号、缩进、每行最大宽度 |
| 可配置程度 | 规则多，可以按需开关 | 选项很少，刻意减少争论 |
| 能否自动修复 | 部分规则可以 `--fix` | 总是直接重写格式 |

ESLint 过去也有很多格式类规则，和 Prettier 同时开启就会互相"打架"：一个要加分号，一个要删分号。解决办法是在 ESLint 配置的**最后**加上 `eslint-config-prettier`，关掉所有和 Prettier 冲突的规则。另一种做法是 eslint-plugin-prettier，把 Prettier 作为一条 ESLint 规则运行，格式问题也以 lint 报错的形式出现，但会更慢，编辑器里也会出现大量红线。更推荐两个工具分别运行。

### ESLint 的扁平配置

ESLint 9 起默认使用 `eslint.config.js`，ESLint 10 移除了旧的 `.eslintrc.*` 配置。和旧格式相比：

- 配置是一个**数组**，每一项用 `files` 指定作用范围，后面的配置覆盖前面的
- 不再用字符串名称去查找插件和共享配置，而是直接 `import` 进来，来源一目了然
- `env` 改成 `languageOptions.globals`，常配合 `globals` 包使用；`.eslintignore` 改成配置里的 `ignores` 或 `globalIgnores()`
- `defineConfig()` 提供类型提示，并支持在配置对象里用 `extends` 复用别的配置

### Git Hooks：husky + lint-staged

1. **husky** 负责安装 Git Hooks：`npx husky init` 会创建 `.husky/pre-commit`，并在 `package.json` 里加上 `"prepare": "husky"`，其他人执行 `npm install` 时会自动启用钩子
2. **lint-staged** 只对本次**暂存**的文件运行命令，并把文件路径作为参数传给命令。全量检查一个大仓库要几十秒，只检查改动的文件通常只要几秒
3. 命令修改了文件（`eslint --fix`、`prettier --write`）后，lint-staged 会把修改自动加回到这次提交中；有无法自动修复的错误时，提交被中止

### 提交信息：commitlint

commitlint 按 Conventional Commits 规范检查提交信息，例如 `feat: 新增导出功能`、`fix(login): 修复验证码不刷新`。规范的提交信息可以用来自动生成 CHANGELOG、判断版本号该升哪一位。它在 `commit-msg` 钩子里运行，读取 Git 传入的提交信息文件。

### 多道防线

```text
编辑器保存时        →  Prettier 格式化 + ESLint 实时提示       反馈最快
git commit         →  lint-staged 检查暂存文件 + commitlint     可以被 --no-verify 跳过
CI（PR 合并前）     →  eslint . + prettier --check . + 类型检查   最后兜底，不通过不能合并
```

编辑器层面，在 `.vscode/settings.json` 里开启 `editor.formatOnSave`，把默认格式化工具设为 Prettier，再把这个文件和推荐插件列表提交到仓库，让团队配置一致。

## 代码示例

```js
// eslint.config.js
import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import eslintConfigPrettier from 'eslint-config-prettier/flat'
import globals from 'globals'

export default defineConfig([
  globalIgnores(['dist/', 'coverage/']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      eqeqeq: 'error',
    },
  },
  // 放在最后，关掉和 Prettier 冲突的格式类规则
  eslintConfigPrettier,
])
```

`package.json` 中的 lint-staged 配置：

```json
{
  "scripts": {
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{js,jsx,ts,tsx,vue}": ["eslint --fix", "prettier --write"],
    "*.{css,md,json}": "prettier --write"
  }
}
```

两个钩子文件和 commitlint 配置：

```bash
# .husky/pre-commit
npx lint-staged

# .husky/commit-msg
npx --no -- commitlint --edit $1
```

```js
// commitlint.config.js
export default { extends: ['@commitlint/config-conventional'] }
```

## 面试官可能追问

::: details 老项目接入 ESLint 报了几千个错误，怎么推进？
不要一次性全量修复。先把格式化单独做一次提交（只改格式、不改逻辑，方便评审），再把规则分级：可能导致 bug 的规则设为 error，风格类的先设为 warn。配合 lint-staged，只要求"改到的文件必须通过"，存量问题随日常修改逐步消化。ESLint 也支持批量抑制：`eslint --suppress-all` 把现有的 error 记录到 `eslint-suppressions.json`，之后只拦截新增的问题。
:::

::: details 为什么 CI 里还要再检查一遍？
本地钩子可以被 `git commit --no-verify` 跳过，有人没执行 `npm install` 钩子就不会安装，直接在网页上改代码也不会触发钩子。lint-staged 只检查改动的文件，修改一个公共函数可能让别的文件出现问题。CI 对整个项目运行 lint 和类型检查，是合并前唯一可靠的关卡。
:::

::: details pre-commit 里要不要跑单元测试和类型检查？
看耗时。pre-commit 应该在几秒内完成，否则大家会习惯性地用 `--no-verify`。类型检查需要分析整个项目，单元测试可能更慢，一般放到 pre-push 钩子或 CI 里。只有测试很快时，才在 pre-commit 里运行和改动相关的测试。
:::

## 易错点

- `eslint-config-prettier` 没有放在配置数组的最后，后面的配置又把格式类规则打开了
- 照着旧教程写 `.eslintrc.js`，ESLint 9 默认不会读取它，ESLint 10 已不再支持
- 在 lint-staged 的命令里自己写 `git add`，新版本会自动把修改加回暂存区，不需要手动添加
- 以为有了 Git Hooks 就万无一失，没有在 CI 里设置检查
