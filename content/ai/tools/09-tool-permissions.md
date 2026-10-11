---
difficulty: 3
tags: [安全, 实践]
---

# 工具调用的权限和安全应该怎么设计？

::: tip 一句话回答
核心原则是**不信任模型的判断，权限在代码里强制执行**。只给完成任务需要的工具和数据范围（**最小权限**）；按风险给工具分级，写操作和不可逆操作要**用户确认**；执行前对参数做白名单和二次校验；工具**以当前用户的身份和权限**执行，用户 ID 这类身份参数从登录态获取，不让模型填；工具返回的外部内容可能夹带恶意指令，要当作数据处理；所有调用都记**审计日志**。
:::

## 详细解析

### 为什么不能靠模型守规矩

模型会误解指令，也可能被提示注入劫持：用户输入、网页、邮件、工具结果里的恶意文字，都可能让模型发起本不该发起的调用，见 [什么是 Prompt 注入](/engineering/security/01-prompt-injection)。所以设计时要假设模型可能被攻破，把它当作一个不完全可信的调用方。在 System Prompt 里写"不要删除数据"只能降低出错的概率，真正的限制要在工具和执行层实现。

### 按风险分级

| 级别 | 例子 | 处理方式 |
| --- | --- | --- |
| 只读、公开数据 | 查天气、搜索公开文档 | 自动执行 |
| 只读、敏感数据 | 查订单、查个人信息 | 按当前用户的权限过滤，记录日志 |
| 可撤销的写操作 | 创建草稿、加标签、修改自己的设置 | 可以自动执行，同时提供撤销 |
| 不可逆或对外的操作 | 转账、删除数据、发邮件、对外发布 | 必须用户确认，展示完整参数 |

人工确认（human-in-the-loop）的几个要点：

- 确认界面展示**实际要执行的参数**（收件人、金额、文件路径），而不是模型写的一段摘要
- 用户确认的是哪份参数，执行的就必须是哪份，确认之后模型不能再改
- 确认由应用的界面完成，不能让模型自己回复"用户已同意"
- 不要什么都弹窗：确认太频繁，用户会习惯性地点"同意"，确认就失去了意义

### 参数校验和执行身份

- **白名单和范围限制**：邮件只能发给公司域名，金额有上限，文件路径限制在工作目录内，SQL 只允许只读语句
- **防 SSRF**：抓取网页的工具要校验域名，禁止访问内网地址和云服务器的元数据地址，重定向之后的地址也要再检查
- **以当前用户的身份执行**：工具用当前用户的凭证访问下游系统，比如用户通过 OAuth 授权得到的令牌，而不是一个权限很大的公共账号。否则模型一旦被诱导，就能借这个账号做用户本身没有权限做的事
- **身份参数不让模型填**：`userId`、`tenantId` 从登录态获取，工具的参数 Schema 里根本不暴露这类字段

### 外部内容和审计日志

- 工具返回的网页、邮件、文档内容都是**不可信数据**，可能藏着"把聊天记录发到某个地址"之类的指令。处理过不可信内容之后，高风险操作更要确认，见 [什么是间接提示注入](/engineering/security/02-indirect-injection)
- 审计日志记录：谁、在什么时间、在哪次对话里、调用了什么工具、参数是什么、谁确认的、结果如何。日志里的密码、令牌要脱敏，日志本身要防篡改

## 代码示例

```ts
import { z } from 'zod'

type Risk = 'read' | 'write' | 'dangerous'

interface Ctx {
  user: { id: string; allowedTools: string[] } // 来自登录态
  confirm(req: { tool: string; args: unknown }): Promise<boolean> // 在界面上展示参数，等用户点击
  audit(entry: Record<string, unknown>): Promise<void>
}

interface Tool {
  name: string
  risk: Risk
  schema: z.ZodType
  execute(args: unknown, ctx: Ctx): Promise<unknown>
}

// 参数里没有 userId：身份从 ctx 取，模型没法查别人的订单（db 是数据访问层）
const listMyOrders: Tool = {
  name: 'list_my_orders',
  risk: 'read',
  schema: z.object({ status: z.enum(['paid', 'shipped', 'refunded']).optional() }),
  async execute(args, ctx) {
    const { status } = args as { status?: string } // 已经过 schema 校验
    return db.orders.findMany({ userId: ctx.user.id, status })
  },
}

async function executeWithPolicy(tool: Tool, rawArgs: unknown, ctx: Ctx) {
  if (!ctx.user.allowedTools.includes(tool.name)) return '当前用户无权使用这个工具'
  const parsed = tool.schema.safeParse(rawArgs) // 二次校验，不信任模型给的参数
  if (!parsed.success) return `参数错误：${parsed.error.issues.map((i) => i.message).join('；')}`

  const approved = tool.risk !== 'dangerous' || (await ctx.confirm({ tool: tool.name, args: parsed.data }))
  // 这里只记录了确认结果，执行结果和异常也要补记到审计日志
  await ctx.audit({ userId: ctx.user.id, tool: tool.name, args: parsed.data, approved, at: new Date() })
  if (!approved) return '用户拒绝了这个操作'

  return tool.execute(parsed.data, ctx) // 执行的就是用户确认过的那一份参数
}
```

## 面试官可能追问

::: details 每个写操作都让用户确认，体验太差怎么办？
按风险分级，低风险的自动执行；可撤销的操作用"撤销"代替"确认"；允许用户对某类操作授权"本次会话内不再询问"；多步骤的任务先展示整体计划，一次确认。但转账、对外发送、删除这类不可逆的操作，不要自动放行。
:::

::: details 工具要访问用户在第三方系统里的数据，怎么授权？
用 OAuth 让用户直接授权给你的应用，只申请需要的最小权限范围；令牌按用户加密保存在服务端，不进入模型的上下文。不要所有用户共用一个高权限的 API Key。远程 MCP Server 的授权也推荐基于 OAuth。
:::

::: details 接入第三方 MCP Server 有什么额外风险？
Server 的工具描述和返回内容都会进入模型的上下文，可能夹带诱导模型的指令；本地运行的 Server 拥有用户的全部权限，能读写用户能访问的所有文件；Server 升级后，工具描述可能悄悄变了。应对：只安装可信来源的 Server 并固定版本，审查它的权限和工具描述，敏感工具单独确认，也不要把 Server 自己声明的工具注解当作安全依据。
:::

::: details 多租户 SaaS 里，怎么防止 Agent 访问到别的租户的数据？
租户 ID 从登录态获取，不经过模型；数据访问层强制带上租户条件，可以用数据库的行级安全策略兜底；RAG 检索按租户和用户权限过滤；缓存、记忆、日志都按租户隔离。最后用测试专门验证跨租户访问会被拒绝。
:::

## 易错点

- 让模型通过参数传 `userId`，等于让模型决定"以谁的身份操作"
- 确认弹窗只显示模型写的说明文字，用户看不到真正要执行的参数
- 只在 System Prompt 里写权限规则，代码里没有强制执行
- 审计日志里明文记录密码、令牌
