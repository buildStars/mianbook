---
difficulty: 2
tags: [原理, 新特性]
---

# MCP Server 怎么向用户索取信息或确认？Elicitation 怎么用？

::: tip 一句话回答
Elicitation 让 Server 在处理请求的中途，**通过 Client 向用户要信息或确认**，比如缺一个参数、要用户确认一次删除。它有两种模式：**表单模式**用受限的 JSON Schema（扁平对象，只有字符串、数字、布尔和枚举）描述要填的字段；**URL 模式**把用户引到浏览器里完成，适合 API Key、OAuth 授权、支付这类**敏感信息**，规范明确禁止用表单收密码和密钥。用户的回应分 **accept、decline、cancel** 三种。2026-07-28 版规范里，Server 不再主动发 `elicitation/create` 请求，而是返回 `resultType: "input_required"` 的结果，Client 收集完输入后**带着答案重试原请求**。
:::

## 详细解析

### 它解决什么问题

工具调用时经常缺信息：模型没给全参数、操作有风险要用户点头、要用户登录第三方服务。没有 Elicitation 时，Server 只能报错，让模型再去问用户，绕一圈还不可控。Elicitation 让 Server 直接通过 Client 的界面问用户，问什么、怎么填由 Server 用 schema 描述，界面怎么画由 Client 决定。各种原语的整体对比见 [MCP 的三种能力](/ai/tools/07-mcp-primitives)。

Client 要在能力里声明 `elicitation`，可以是 `form`、`url` 或两者；只写空对象 `{}` 等同于只支持表单模式。Server 不能发 Client 没声明支持的模式。

### 2026-07-28 版：返回 input_required，再重试

这一版取消了握手和会话（见 [MCP 架构](/ai/tools/06-mcp-architecture)），Server 不能再在会话里主动给 Client 发请求，改用**多轮往返请求（MRTR）**：

1. Client 发 `tools/call`
2. Server 发现缺信息，返回 `InputRequiredResult`：`resultType` 是 `"input_required"`，`inputRequests` 里按 Server 自定的键放一个或多个 `elicitation/create` 请求，可以附一个 `requestState`
3. Client 向用户展示表单或链接，收集结果
4. Client 用**新的 JSON-RPC id** 重发原请求，带上 `inputResponses`（键和 `inputRequests` 对应），并原样回传 `requestState`
5. Server 拿到足够信息，返回最终结果；信息还不够可以再返回一次 `input_required`

```json
{
  "resultType": "input_required",
  "inputRequests": {
    "confirm_delete": {
      "method": "elicitation/create",
      "params": {
        "mode": "form",
        "message": "确认删除仓库 demo？此操作不可恢复",
        "requestedSchema": {
          "type": "object",
          "properties": { "confirm": { "type": "boolean", "title": "确认删除" } },
          "required": ["confirm"]
        }
      }
    }
  },
  "requestState": "由 Server 签名或加密的不透明字符串"
}
```

重试时 Client 在请求参数里带上 `"inputResponses": { "confirm_delete": { "action": "accept", "content": { "confirm": true } } }`。

`requestState` 是 Server 把上下文"寄存"在 Client 那里，这样重试打到任何一个实例都能继续处理，不需要共享存储。它会经过 Client，所以 Server 要把它当作不可信输入：影响授权或业务逻辑时要用 HMAC 或 AEAD 保护完整性，并在里面放用户身份、过期时间和原请求的标识，防止被篡改或拿到别的请求上重放。只能用一次的操作，还得在服务端自己保证。

和 2025-11-25 及更早版本的区别：

| | 2025-11-25 及更早 | 2026-07-28 |
| --- | --- | --- |
| 发起方式 | Server 在处理请求期间主动发 `elicitation/create` 请求 | 返回 `input_required`，Client 带答案重试 |
| 状态 | 依赖会话和长连接，Server 实例要记住进行中的请求 | 无状态，上下文放在 `requestState` 里 |
| URL 模式结束 | 有 `elicitationId` 和 `notifications/elicitation/complete` 通知 | 两者都删了，Client 重试时由 Server 判断外部操作是否完成 |

### 表单模式和 URL 模式

**表单模式**的 schema 只能是扁平对象，属性限于字符串（可带 `email`、`uri`、`date`、`date-time` 格式）、数字或整数、布尔、单选和多选枚举，不支持嵌套对象。数据会经过 Client，所以只能用来收普通信息。

**URL 模式**只给一个 `url` 和一段说明，用户在浏览器里完成操作，输入的内容不经过 Client 和模型。用户 accept 只表示**同意打开链接**，不代表外部操作已经完成；Client 重试时 Server 根据 `requestState` 或自己存的状态判断，没完成就再返回一次 `input_required`。Client 必须完整显示 URL、得到用户同意后才打开，不能预先抓取。

URL 模式用于 Server 代用户拿第三方授权，不是用来做 Client 到 Server 本身的鉴权，那部分走 [MCP 鉴权](/ai/tools/13-mcp-auth)。

### 三种回应

| action | 含义 | Server 该怎么做 |
| --- | --- | --- |
| `accept` | 用户提交了；表单模式带 `content` | 校验数据后继续 |
| `decline` | 用户明确拒绝 | 不要反复追问，给替代方案或结束 |
| `cancel` | 用户关掉了对话框，没表态 | 可以稍后再问 |

### Sampling 和 Roots 怎么办

这两个 Client 能力在 2026-07-28 版被标记为弃用，弃用期内仍可用，也走同样的 `input_required` 流程。新实现不建议再用：要调模型就直接对接模型厂商的 API；要知道工作目录，就通过工具参数、资源 URI 或 Server 配置传入。

## 面试官可能追问

::: details 为什么不能用表单让用户填 API Key？
表单数据会经过 Client，可能进入日志、模型上下文或中间的其他 Server，泄露面太大。规范要求密码、API Key、访问令牌、支付凭证这类敏感信息必须走 URL 模式，由用户在受信任的网页上直接交给 Server。
:::

::: details URL 模式有什么安全风险？
主要是钓鱼：攻击者触发一个授权链接，骗另一个用户去点，令牌就绑到了攻击者的身份上。Server 要确认打开链接的人就是发起请求的那个用户，比如先跳到自己的连接页面，用登录态比对用户身份，再转到第三方授权页。URL 里也不能带用户的敏感信息或预先认证过的访问凭证。
:::

::: details 用户一直不回应怎么办？
Server 不能假设 Client 一定会重试。MRTR 下 Server 返回 `input_required` 后这次请求就结束了，不需要挂着资源等；用户不回应，Client 不重试，Server 什么都不用做。所以 `requestState` 要设过期时间，过期的状态直接拒绝。
:::

## 易错点

- 把 URL 模式的 accept 当成"操作已完成"，它只表示用户同意打开链接
- 新版本里还按旧方式由 Server 主动发 `elicitation/create` 请求，2026-07-28 版已经不支持
- 重试时复用原来的 JSON-RPC id，或修改、丢掉 `requestState`
- 不区分 decline 和 cancel，用户明确拒绝后还反复弹窗
