---
difficulty: 1
tags: [高频, 综合]
---

# CI/CD 流水线怎么设计？一次提交到上线要经过哪些环节？

::: tip 一句话回答
一条典型流水线是：**静态检查和单测 → 构建制品 → 集成和 E2E 测试 → 部署预发 → 审批后部署生产**。原则是**越便宜、越快的检查越靠前**，失败尽早反馈；制品**只构建一次**，同一个制品依次部署到各环境；每个阶段都是**质量门禁**，不过就不往下走。
:::

## 详细解析

### 一次提交经过的环节

```text
push / PR
  │
  ├─ 1. 静态检查：lint、格式、类型检查、依赖漏洞扫描     （秒级到分钟级）
  ├─ 2. 单元测试 + 覆盖率                                 （分钟级）
  ├─ 3. 构建制品：镜像 / 前端产物，打上 commit SHA 标签
  ├─ 4. 集成测试、E2E 测试：起数据库等依赖，跑核心链路
  │      ── PR 到这里结束，结果作为合并的门禁 ──
  ├─ 5. 合并到 main 后：同一个制品部署到预发，跑冒烟测试
  ├─ 6. 人工审批（或自动判断指标）
  └─ 7. 部署生产（灰度），观察指标，异常就回滚
```

CI（持续集成）管 1～4：每次提交都自动验证，保证主干随时可用。CD 管 5～7：持续交付指随时**能**发布，最后一步人工点；持续部署指测试通过就自动上生产。

### 分支策略和触发条件

- **PR 触发**：跑检查、测试和构建，不部署生产。结果配合分支保护规则，不通过不能合并
- **合并到 main 触发**：构建制品并部署预发，生产部署等审批
- **打 tag 或手动触发**：用于有明确版本号的发布
- 分支模型推荐**主干开发**加短命特性分支：分支活得越久，合并冲突和集成风险越大。未完成的功能用特性开关藏起来，见 [发布策略](/engineering/cicd/02-release-strategies)

### 制品一次构建，多环境复用

预发测过的必须是生产要跑的那一份。如果每个环境各自重新构建，依赖可能在两次构建之间更新，预发的测试结果就不能代表生产。做法：

1. 构建一次，产物推到镜像仓库或制品库，用 commit SHA 做标签
2. 环境差异（数据库地址、开关）通过环境变量或配置中心注入，不打进制品
3. 回滚就是把上一个版本的制品重新部署一遍

### 质量门禁和快速反馈

- 门禁要**可自动判断**：测试全过、覆盖率不下降、没有高危漏洞、镜像扫描通过
- 生产部署前加人工审批或变更窗口，审批人看的是预发验证结果
- 快速反馈：PR 流水线控制在十分钟量级，失败时通知到提交人；慢的测试放到合并后或夜间跑。提速方法见 [CI 提速](/engineering/cicd/07-ci-speed)

## 代码示例

GitHub Actions 的骨架，`needs` 串起阶段，`environment` 挂审批：

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 'lts/*'
          cache: npm
      - run: npm ci
      - run: npm run lint && npm run typecheck && npm test

  build:
    needs: check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      # 用 commit SHA 做镜像标签，后面各环境都部署这一个
      - run: docker build -t registry.example.com/app:${{ github.sha }} .

  deploy-prod:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production   # 在仓库设置里给这个环境配审批人
    steps:
      - run: ./deploy.sh ${{ github.sha }}
```

示例省略了推送镜像和预发阶段，真实流水线要把镜像推到仓库，部署时按标签拉取。

## 面试官可能追问

::: details 数据库迁移放在流水线的哪一步？
一般在部署新代码之前单独执行，并且迁移本身要向后兼容：旧代码跑在新表结构上也不能出错，这样部署失败回滚代码时不用回滚表结构。详见 [不停机表结构变更](/engineering/cicd/03-zero-downtime-migration)。
:::

::: details 流水线配置本身怎么保证质量？
配置也是代码，放在仓库里走 PR 评审。复用的步骤抽成可复用工作流或模板，避免几十个仓库各写一份；第三方 action 固定到具体提交 SHA，防止被人改了内容。
:::

::: details 前端项目的流水线有什么不同？
主要差在制品和部署：产物是静态文件，部署到 CDN 或对象存储，缓存和回滚方式不同，见 [前端部署](/basics/build/14-frontend-deploy)。测试分层见 [前端测试](/basics/build/15-frontend-testing)。
:::

## 易错点

- 每个环境重新构建一次：预发测过的和生产跑的不是同一份东西
- 把环境配置打进制品，导致一个制品只能用于一个环境
- 所有测试都塞进 PR 流水线，一次要跑半小时，大家就开始绕过或重复点重试
