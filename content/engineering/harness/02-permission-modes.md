---
difficulty: 2
tags: [安全, 系统设计]
---

# Agent 的权限模式怎么设计？哪些操作自动放行、哪些要用户审批？

::: tip 一句话回答
用一套**规则系统**决定每次工具调用的结果：规则由"工具名 + 参数模式"组成，结果是 **allow、ask、deny** 之一，冲突时 **deny 优先于 ask，ask 优先于 allow**。规则来自多层配置（组织、项目、用户、会话），审批可以只对本次、本会话或持久生效。再提供只读、计划等预设模式，让用户一键切换整体松紧。每次判定都写审计记录。
:::

## 详细解析

哪些操作算高风险、执行身份怎么收窄，见 [工具调用的权限和安全](/ai/tools/09-tool-permissions)。这里讲怎么把这些判断落成一套可配置的规则系统。

### 规则怎么匹配

只按工具名太粗："允许执行命令"等于什么都允许。规则要能匹配参数，下面是一种常见的写法：

| 规则 | 含义 |
| --- | --- |
| `Read` | 读文件全部放行 |
| `Bash(npm test*)` | 只放行以 `npm test` 开头的命令 |
| `Edit(src/**)` | 只放行编辑 `src` 下的文件 |
| `Bash(git push*)` | 推送代码，放进 ask |
| `Read(.env*)` | 读环境变量文件，放进 deny |

命令前缀匹配有坑：`npm test && rm -rf x` 也以 `npm test` 开头。harness 要先把复合命令拆开，每一段分别判定，取最严格的结果。路径要先规范化（解析 `..` 和符号链接）再匹配，否则 `src/../.env` 就能绕过目录限制。

### 优先级

1. 任何一层有 deny 命中，直接拒绝
2. 否则有 ask 命中，弹审批
3. 否则有 allow 命中，放行
4. 都没命中，走当前模式的默认行为（通常是 ask）

deny 最优先，是为了让上层的禁止不会被下层的允许覆盖。比如组织禁止读密钥文件，用户自己配一条 allow 也没用。

### 多层配置怎么合并

```text
组织策略（管理员下发，用户改不了）
  └─ 项目配置（提交到仓库，团队共享）
      └─ 本地项目配置（不提交，个人覆盖）
          └─ 用户全局配置
              └─ 本次会话里的临时授权
```

各层规则取并集，再按上面的优先级判定。组织层还可以锁定某些开关，比如禁止切到"全部放行"模式。

### 授权的作用范围

用户审批时给几个选项：只允许这一次、本会话内都允许、永久允许（写进项目或用户配置）。永久允许要落成具体的规则，比如 `Bash(npm run lint)`，而不是把整个工具放开。界面上要展示即将写入的规则，让用户知道自己同意了什么。

### 预设模式

- **默认**：读操作放行，写和执行按规则审批
- **只读 / 计划**：写操作和命令一律不执行，模型只能看和出方案
- **自动接受编辑**：工作区内的文件修改放行，命令仍然审批
- **全部放行**：只适合在隔离的沙箱或一次性容器里用

多数模式只改变"没命中规则时"的默认行为；只读 / 计划模式例外，即使有 allow 规则也不执行写操作。deny 规则应该在任何模式下都生效，具体产品是否这样实现要看它的文档。

## 代码示例

```js
// 简化的规则判定：deny > ask > allow，复合命令逐段判定取最严格
function matchRule(rule, call) {
  const m = rule.match(/^(\w+)(?:\((.*)\))?$/)
  if (!m || m[1] !== call.tool) return false
  if (m[2] === undefined) return true // 只写工具名，匹配所有参数
  const pattern = m[2]
  return pattern.endsWith('*') ? call.arg.startsWith(pattern.slice(0, -1)) : call.arg === pattern
}

function decideOne(call, rules, defaultMode) {
  for (const level of ['deny', 'ask', 'allow']) {
    if (rules[level].some((r) => matchRule(r, call))) return level
  }
  return defaultMode
}

const STRICT = { deny: 0, ask: 1, allow: 2 }
function decide(call, rules, defaultMode = 'ask') {
  const parts = call.tool === 'Bash' ? call.arg.split(/&&|\|\||;|\|/).map((s) => s.trim()) : [call.arg]
  return parts
    .map((arg) => decideOne({ tool: call.tool, arg }, rules, defaultMode))
    .sort((a, b) => STRICT[a] - STRICT[b])[0]
}

const rules = { deny: ['Read(.env)'], ask: ['Bash(git push*)'], allow: ['Bash(npm test*)', 'Read'] }
console.log(decide({ tool: 'Bash', arg: 'npm test' }, rules)) // allow
console.log(decide({ tool: 'Bash', arg: 'npm test && rm -rf x' }, rules)) // ask
console.log(decide({ tool: 'Read', arg: '.env' }, rules)) // deny
```

真实实现还要处理引号、子 shell、路径通配和规范化，这里只演示优先级和拆分的思路。

## 面试官可能追问

::: details 审计记录要记什么？
每次判定记下工具、参数、命中的规则、规则来自哪一层、最终结果、审批人和授权范围。出了问题能查清"这条命令为什么没拦住"；也能发现哪些操作被反复手动批准，适合固化成 allow 规则。
:::

::: details 为什么权限判定要在 harness 里做，不让模型自己判断？
模型可能被注入的内容诱导，也可能误判。权限是安全边界，必须是确定性的代码。模型可以在计划阶段说明意图，判定仍由规则完成。
:::

::: details 用户总是点"允许"，怎么办？
从审计记录里找出反复批准的安全操作，固化成 allow 规则，减少无意义的弹窗；高风险操作保持 ask，界面上突出显示完整命令和影响的路径。更多做法见 [人在回路](/ai/agent/11-human-in-the-loop)。
:::

## 易错点

- 命令前缀匹配不拆复合命令，`安全命令 && 危险命令` 被整体放行
- 路径不规范化就匹配，`..` 和符号链接可以绕过目录限制
- 让下层的 allow 覆盖上层的 deny，组织策略形同虚设
- "永久允许"直接放开整个工具，而不是写一条具体规则
