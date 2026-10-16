---
difficulty: 3
tags: [安全, 原理]
---

# 远程 MCP Server 怎么做鉴权？

::: tip 一句话回答
MCP 规范里的授权是可选的，但远程（HTTP 传输）Server 要做的话，规范基于 **OAuth 2.1**：MCP Server 是**资源服务器**，MCP Client 是 **OAuth 客户端**，令牌由独立的**授权服务器**签发。流程是 Server 返回 **401** 并在 `WWW-Authenticate` 里给出**受保护资源元数据**的地址，Client 据此找到授权服务器，用 **PKCE** 走授权码流程，请求时带上 **`resource` 参数**指明令牌给哪个 Server 用。Server 必须**校验令牌的受众是自己**，不能把收到的令牌转发给下游。本地 stdio Server 不走这套，凭证从环境变量读取。
:::

## 详细解析

### 三个角色

| 角色 | 在 OAuth 里的身份 | 职责 |
| --- | --- | --- |
| MCP Server | 资源服务器 | 校验访问令牌，按 scope 决定能做什么 |
| MCP Client | OAuth 客户端 | 发现授权服务器、拉起浏览器让用户授权、保存和刷新令牌 |
| 授权服务器 | 授权服务器 | 和用户交互、签发令牌；可以和 Server 部署在一起，也可以是现成的身份平台 |

把授权服务器拆出去的好处是 Server 不用自己管登录和密码，可以直接对接企业已有的身份系统。

### 完整流程

```text
Client ──请求（无令牌）──────────────▶ MCP Server
       ◀─401 + WWW-Authenticate: resource_metadata="..."
Client ──GET 受保护资源元数据 ────────▶ MCP Server   （RFC 9728，列出授权服务器）
Client ──GET 授权服务器元数据 ────────▶ 授权服务器   （RFC 8414 或 OIDC Discovery）
Client ── 获得 client_id（见下文三种方式）
Client ──打开浏览器：授权请求 + PKCE + resource ──▶ 授权服务器 ── 用户登录并同意
       ◀─回调带授权码
Client ──换令牌：授权码 + code_verifier + resource ──▶ 授权服务器
       ◀─访问令牌（可能还有刷新令牌）
Client ──Authorization: Bearer <token> ──▶ MCP Server
```

几个硬性要求：

- 令牌放在 `Authorization` 请求头里，**每个 HTTP 请求都要带**，不能放在 URL 查询参数里
- `resource` 参数在授权请求和换令牌请求里都要带，值是 MCP Server 的规范 URI，比如 `https://mcp.example.com/mcp`
- 授权码流程必须用 PKCE，防止授权码被截获后被别人换成令牌

### 客户端怎么拿到 client_id

MCP 的特点是 Client 和 Server 往往事先互不认识，所以规范给了三种注册方式。三种都支持的 Client 建议按这个顺序选：有预注册信息先用预注册；授权服务器元数据声明支持（`client_id_metadata_document_supported`）就用 Client ID Metadata Documents；再退到动态注册；都不行才让用户手动填写：

- **Client ID Metadata Documents**：Client 用一个 HTTPS URL 当 `client_id`，授权服务器去这个 URL 拉取客户端的元数据（名称、回调地址）。规范要求 Client 和授权服务器“应当”（SHOULD）支持，面向双方事先没有关系这种最常见的情况
- **预注册**：管理员事先在授权服务器上登记好，适合企业内部固定的客户端
- **动态客户端注册（RFC 7591）**：Client 调注册接口现场申请。规范里是“可以”（MAY）支持，保留主要是为了兼容早期版本的规范

### Server 端最重要的两条

- **校验受众**：令牌必须是签发给本 Server 的。否则用户授权给 B 服务的令牌，B 就能拿来冒充用户调用 A；用了 `resource` 参数并在 A 上校验受众，这种令牌会被拒绝
- **不透传令牌**：Server 要访问下游 API 时，不能把 Client 给的令牌原样转发，而要用自己作为客户端另外获取的下游令牌。透传会绕过下游的受众校验和审计，也会造成"混淆代理"问题。接入第三方 Server 的其他风险见 [接入第三方 MCP Server 有哪些安全风险](/engineering/security/11-mcp-security)

### 权限不够时怎么升级

令牌有效但 scope 不够时，Server 返回 **403**，`WWW-Authenticate` 里带 `error="insufficient_scope"` 和需要的 `scope`。Client 把新旧 scope 合并后重新授权，再重试原请求；重试要有次数上限。这样初次授权只申请最小权限，用到写操作时再申请，见 [工具调用的权限和安全](/ai/tools/09-tool-permissions)。

## 面试官可能追问

::: details 为什么不直接用一个 API Key？
API Key 简单，内部单租户场景也确实常用。但它通常是长期有效的，权限粒度粗，也难以表达"代表哪个用户"。OAuth 让用户自己授权、按 scope 限权、令牌短期有效可刷新、可以单独吊销，适合一个 Server 服务很多用户和很多不同客户端的情况。API Key 的管理见 [大模型 API Key 怎么安全管理](/engineering/security/07-api-key)。
:::

::: details stdio 模式为什么不用 OAuth？
stdio Server 是 Host 在本机启动的子进程，没有网络端点，也就没有"谁在请求"的问题。规范建议它从环境变量等本地配置读取凭证。要注意的是这些凭证就在用户机器上，Server 以用户权限运行，安装来路不明的 Server 等于把凭证交给它。
:::

::: details 令牌在 Client 端怎么存？
访问令牌和刷新令牌都要加密保存，桌面客户端可以用系统的钥匙串，服务端用加密存储。令牌不能写进日志，也不能进入模型的上下文，模型只需要知道"这个工具能用"。
:::

## 易错点

- 认为 MCP 自己定义了一套鉴权协议。它是复用 OAuth 2.1 和相关 RFC，只规定了用哪些部分
- Server 只验签名和过期时间，不验受众，导致发给别的服务的令牌也能用
- 把用户的令牌透传给下游 API
- 把令牌放进 URL 查询参数，会留在日志和浏览器历史里
