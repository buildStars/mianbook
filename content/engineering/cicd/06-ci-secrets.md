---
difficulty: 2
tags: [安全, 实践]
---

# CI 里的密钥和环境变量怎么管理？

::: tip 一句话回答
密钥不进仓库，存在 CI 平台的**密钥库**里，按**环境**分开，生产密钥只给部署生产的任务用，并配审批。日志里平台会自动遮盖已登记的密钥，但派生出来的值要自己遮盖。来自外部 fork 的 PR 默认**拿不到密钥**，因为 PR 里的代码不可信。部署到云上优先用 **OIDC** 换取短期凭证，不再保存长期的访问密钥；令牌权限按**最小权限**给，并定期轮换。
:::

## 详细解析

### 密钥放在哪、怎么分

- **不进仓库**：`.env`、私钥、云凭证都不提交，仓库里只放 `.env.example` 说明需要哪些变量。提交前和 CI 里跑密钥扫描，防止误提交
- **用 CI 的密钥库**：以 GitHub Actions 为例，密钥分仓库级、组织级和环境级。普通配置（区域名、功能开关）用变量，真正的机密才用密钥
- **按环境区分**：预发和生产用不同的密钥，生产密钥挂在 `production` 环境上，这个环境配置审批人和允许部署的分支。没走到这个环境的任务读不到生产密钥

应用运行时的配置怎么注入，见 [K8s 配置管理](/basics/container/09-k8s-config) 和 [前端环境变量](/basics/build/19-env-config)；API Key 本身的管理见 [API Key 安全](/engineering/security/07-api-key)。本题只讲流水线里的密钥。

### 日志脱敏

平台会把日志中出现的已登记密钥替换成 `***`，但有几个漏洞：

- 密钥被转换过（base64 编码、截取一段、拼进 URL）后，就不再匹配，会原样打印
- 一个 JSON 整体存成密钥时，里面单个字段被打印出来不一定能遮住
- 开了调试模式的命令（如 `set -x`、`curl -v`）会把请求头打出来

所以派生出来的敏感值要手动登记遮盖（GitHub Actions 里用 `::add-mask::`），少打印环境变量，不在日志里输出完整请求。

### 为什么 fork 的 PR 拿不到密钥

外部贡献者可以在 PR 里改任何文件，包括测试脚本和流水线配置。如果这样的 PR 能读到密钥，只要在测试里加一行把环境变量发到外面，密钥就泄露了。所以 GitHub Actions 对 fork 来的 `pull_request` 事件不传密钥，`GITHUB_TOKEN` 也只有只读权限。

另一个触发器 `pull_request_target` 运行在目标仓库的上下文里，可以读密钥。它本来是给打标签、评论这类不执行 PR 代码的操作用的；如果在里面检出并运行 PR 的代码，就把上面的保护绕过去了，这是常见的配置漏洞。

### 用 OIDC 代替长期密钥

传统做法是在 CI 里存一对长期有效的云访问密钥，泄露了就一直能用。OIDC 的流程：

```text
CI 任务 ──(1) 申请身份令牌──▶ CI 平台的 OIDC 服务
        ◀─(2) 签名的 JWT：仓库、分支、环境等信息──
CI 任务 ──(3) 拿 JWT 换凭证──▶ 云厂商的身份服务
                               (4) 校验签名，并检查 JWT 里的仓库、分支、环境是否符合信任策略
        ◀─(5) 短期临时凭证，任务结束后很快过期──
```

好处是 CI 里没有任何长期密钥可偷；信任策略可以限制到"只有某个仓库的 `production` 环境"，别的分支即使改了配置也换不到凭证。

### 最小权限和轮换

- `GITHUB_TOKEN` 在工作流顶层设成只读，个别任务需要写权限再单独加
- 云角色只授予部署需要的权限，不给管理员
- 无法用 OIDC 的长期密钥定期轮换，并保证轮换过程中新旧密钥能短暂共存
- 第三方 action 能读到传给它的密钥，要固定版本，最好固定到提交 SHA

## 代码示例

GitHub Actions 用 OIDC 部署到 AWS：

```yaml
name: deploy
on:
  push:
    branches: [main]

permissions:
  contents: read           # 默认只读

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production  # 审批人和环境级密钥都挂在这里
    permissions:
      id-token: write        # 允许申请 OIDC 令牌
      contents: read
    steps:
      - uses: actions/checkout@v7
      # 第三方 action 能读到密钥，生产里最好固定到完整的 commit SHA
      - uses: aws-actions/configure-aws-credentials@v6
        with:
          role-to-assume: arn:aws:iam::123456789012:role/deploy-prod
          aws-region: ap-northeast-2
      - run: ./deploy.sh
```

云端的角色信任策略里要限制 JWT 的 `sub` 字段，例如只接受 `repo:my-org/my-repo:environment:production`。

## 面试官可能追问

::: details 密钥已经泄露了怎么办？
先吊销并换新，再查影响：泄露期间这把密钥做过什么操作。只从 Git 历史里删掉是不够的，克隆过、缓存过的地方都还有，必须当它已经公开。
:::

::: details 外部贡献者的 PR 需要密钥跑集成测试怎么办？
常见做法是 PR 先跑不需要密钥的检查，维护者审过代码后再手动触发需要密钥的任务，或者把代码推到内部分支再跑。不要图方便直接改成 `pull_request_target` 运行 PR 代码。
:::

::: details 自建的 Runner 有什么额外风险？
自建 Runner 如果长期复用，上一个任务留下的文件和进程可能被下一个任务读到。公开仓库不要用自建 Runner，或者每个任务用一次性的干净环境。
:::

## 易错点

- 以为平台会自动遮盖一切，结果 base64 后的密钥原样出现在日志里
- 所有环境共用一套密钥，预发的任务也能动生产
- OIDC 信任策略只校验了组织，没限制仓库和环境，同组织任何仓库都能换到生产凭证
