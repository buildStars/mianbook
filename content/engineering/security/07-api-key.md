---
difficulty: 2
tags: [高频, 安全, 实践]
---

# 大模型 API Key 怎么安全管理？前端能直接调用模型 API 吗？

::: tip 一句话回答
不能：前端代码和网络请求对用户完全可见，Key 放在前端就等于公开，别人拿去随意调用，费用记在你的账上。正确做法是**由后端代理请求**：前端调用自己的接口，后端做完**登录鉴权、限流和配额**检查后，再带上 Key 调用模型。Key 放在**环境变量或密钥管理服务**里，不提交到代码仓库；按环境和项目**分开 Key**、设置**用量上限**、**定期轮换**。一旦泄露，先作废、再换新，然后排查用量和泄露源头。
:::

## 详细解析

### 为什么前端藏不住 Key

- 打包后的 JS 可以直接搜索，混淆和压缩只是多一点麻烦
- 浏览器开发者工具的网络面板里能看到每个请求头
- 构建工具会把带特定前缀的环境变量打进前端代码：Vite 的 `VITE_`、Next.js 的 `NEXT_PUBLIC_`、Nuxt 的 `runtimeConfig.public`。Key 放在这些地方等于公开
- 移动 App 同理，安装包可以被反编译
- 后果不只是费用：别人可以用你的账号生成违规内容导致封号；Key 权限越大，能做的事越多，比如读取你上传到平台的文件

### 后端代理要做什么

```text
浏览器 ──（登录态）──► 自己的后端 /api/chat ──（API Key）──► 模型服务
                       ├─ 鉴权：必须登录，识别是谁在调用
                       ├─ 限流：每个用户每分钟最多 N 次，同时最多 M 个请求
                       ├─ 配额：每天、每月的 token 或费用上限
                       ├─ 参数白名单：模型、max_tokens、消息格式由后端决定
                       └─ 记录用量：按用户统计，异常消耗告警
```

参数白名单最容易被忽略：后端如果把前端的请求体原样转发，攻击者就能换成最贵的模型、把输出长度调到最大，甚至塞进自己的 system 消息。流式接口的转发见[服务端转发流式响应](/engineering/streaming/08-server-relay)。

### Key 的存放和管理

| 做法 | 说明 |
| --- | --- |
| 环境变量或密钥管理服务 | 本地用 `.env` 并加入 `.gitignore`；生产环境用云厂商的密钥管理服务或 Vault 按需注入 |
| 不进代码仓库 | 提交前用 gitleaks 这类工具扫描，并开启代码平台的密钥扫描 |
| 按环境、项目拆分 | 开发、测试、生产各用各的 Key，泄露时影响面小，也方便按项目统计费用 |
| 最小权限、用量上限 | 平台支持的话，只给 Key 调用模型的权限；在控制台设置预算上限和告警，被盗用时费用不会失控 |
| 定期轮换 | 新旧 Key 并存一段时间，切换完成后作废旧 Key，不需要停机 |

### Key 泄露了怎么办

1. 立即在供应商控制台作废这个 Key。只删掉代码里的 Key 没用，别人已经拿到了
2. 生成新 Key，更新到密钥管理服务并重新部署
3. 查看用量和账单，确认被盗用的时间段和金额，必要时联系供应商
4. 找到泄露源头（Git 历史、前端构建产物、日志、截图、聊天记录），补上密钥扫描、用量告警等防护

## 代码示例

Express 5 + ioredis 实现的后端代理，`requireUser` 是登录鉴权中间件，按项目的登录方案实现：

```js
import express from 'express'
import Redis from 'ioredis'

const app = express()
const redis = new Redis(process.env.REDIS_URL)

// 前端只能传别名，真实的模型名由后端决定（这里的模型名是示意）
const MODELS = new Map([
  ['fast', 'provider-small-model'],
  ['smart', 'provider-large-model'],
])
const DAILY_TOKENS = 200_000

app.post('/api/chat', requireUser, express.json({ limit: '200kb' }), async (req, res) => {
  const userId = req.user.id

  // 1. 限流：每个用户每分钟最多 10 次（固定窗口）
  const rateKey = `rate:chat:${userId}:${Math.floor(Date.now() / 60_000)}`
  const [[, count]] = await redis.multi().incr(rateKey).expire(rateKey, 60).exec()
  if (count > 10) return res.status(429).json({ error: '请求太频繁，请稍后再试' })

  // 2. 配额：每天的 token 用量（按 UTC 日期）
  const quotaKey = `quota:chat:${userId}:${new Date().toISOString().slice(0, 10)}`
  if (Number(await redis.get(quotaKey)) >= DAILY_TOKENS) {
    return res.status(429).json({ error: '今天的额度已用完' })
  }

  // 3. 参数白名单：只接受 user 和 assistant 消息，system 消息由后端添加
  const { messages, model = 'fast' } = req.body ?? {} // Express 5 里没有请求体时 req.body 是 undefined
  const valid =
    MODELS.has(model) &&
    Array.isArray(messages) &&
    messages.length <= 40 &&
    messages.every((m) => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string')
  if (!valid) return res.status(400).json({ error: '参数不合法' })

  const upstream = await fetch(`${process.env.LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LLM_API_KEY}`, // Key 只存在于服务端
    },
    body: JSON.stringify({
      model: MODELS.get(model),
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 1024, // 输出上限也由后端决定
    }),
    signal: AbortSignal.timeout(60_000),
  })
  // 不把上游的错误详情原样返回给前端
  if (!upstream.ok) return res.status(502).json({ error: 'AI 服务暂时不可用' })

  const data = await upstream.json()
  await redis.multi().incrby(quotaKey, data.usage?.total_tokens ?? 0).expire(quotaKey, 2 * 86_400).exec()
  res.json({ content: data.choices[0].message.content })
})
```

## 面试官可能追问

::: details 实时语音这类场景要求浏览器直连模型服务，怎么办？
有的实时接口支持由后端签发**短期有效的临时令牌**：用户登录后，前端向自己的后端申请令牌，后端校验身份和配额后调用供应商接口生成一个很快过期、权限受限的令牌，前端用它直连。真正的 Key 始终只在后端。
:::

::: details 让用户填自己的 Key（自带 Key）安全吗？
Key 属于用户自己，风险由用户承担，但应用仍要尽到责任：只通过 HTTPS 传输；不写进日志；尽量只保存在用户本地，必须存在服务端时加密存储；页面要严格防 XSS，否则 Key 会被脚本读走。界面上要说明 Key 怎么使用、存在哪里。
:::

::: details 限流和配额有什么区别？配额为什么按 token 而不是按次数算？
限流控制的是短时间内的请求速率和并发，保护服务的稳定；配额控制的是一段时间内的总消耗，保护预算。大模型单次请求的成本差异很大，一句"你好"和一个带着长文档的请求，消耗的 token 可能相差几个数量级，按次数算配额会被少数大请求打穿，所以按 token 或费用计算。
:::

::: details 登录了也可能被批量注册的账号刷，怎么防？
注册环节做手机号验证和人机验证；新账号给更低的额度；按 IP、设备维度再做一层限流；监控异常模式（大量账号的请求内容相似、集中在同一时段）；最后设置全局的每日预算熔断，超过就暂停非付费用户的调用并告警。
:::

## 易错点

- 以为把 Key 放进 `VITE_`、`NEXT_PUBLIC_` 开头的环境变量就安全了，它们会被打进前端代码
- 泄露后只从代码里删掉 Key、改写 Git 历史，却没有在控制台作废它
- 后端代理把前端的请求体原样转发，模型、输出长度、system 消息都能被篡改
- 只限制请求次数，不限制 token 用量
