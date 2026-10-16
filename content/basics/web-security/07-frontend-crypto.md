---
difficulty: 2
tags: [安全, 场景题]
---

# 前端加密有用吗？密码在前端加密能防住什么？

::: tip 一句话回答
传输安全靠 **HTTPS**，前端加密替代不了它：前端代码和里面的密钥对所有人公开，没有 HTTPS 时，中间人连下发的加密脚本都能换掉。密码在前端哈希或加密后，提交给服务端的那串值**就成了新的密码**，被截获后原样提交照样能登录，最多能让原始明文不出现在日志里。正确做法是 **HTTPS 传输 + 服务端用 Argon2、bcrypt 这类慢哈希加盐存储**。前端加密真正有用的是**端到端加密、本地数据加密**这类密钥不交给服务端的场景，用浏览器自带的 **Web Crypto API** 实现。
:::

## 详细解析

### 先问清楚：防的是谁

| 威胁 | 靠什么防 | 前端加密有没有用 |
| --- | --- | --- |
| 传输中被窃听、篡改 | HTTPS，见 [HTTPS 如何保证安全](/basics/network/08-https) | 没有 HTTPS 时没用，中间人能替换加密脚本；有 HTTPS 时是重复劳动 |
| 数据库泄露后密码被破解 | 服务端慢哈希 + 盐 | 无关 |
| 明文密码出现在网关、APM、访问日志里 | 日志脱敏、不记录请求体 | 有一点用，日志里只有密文 |
| 用户在多个网站用同一个密码 | 服务端风控、多因素认证 | 有一点用，截获者拿不到原始密码去别的网站试 |
| 接口被脚本刷、参数被篡改 | 服务端鉴权、校验、限流 | 签名能提高门槛，但密钥就在前端 |

### 前端处理密码的问题

- **哈希值就是新密码**：服务端只认收到的那串值，截获者不需要知道原始密码，原样提交就能登录。加上时间戳、随机数防重放，也挡不住能拿到当前页面脚本的攻击者
- **加密脚本本身不可信**：没有 HTTPS 时，中间人可以把下发的 JS 和公钥一起换掉；有 HTTPS 时，传输已经是加密的
- **防不住真正常见的威胁**：XSS、恶意浏览器扩展、钓鱼页面都是在加密之前直接读输入框
- **服务端如果直接存前端的哈希**，数据库一旦泄露，攻击者拿着哈希就能登录，和存明文没有区别

如果团队规范要求前端对密码做一次处理，可以做，但服务端要把收到的值当成明文密码，照样做慢哈希加盐。

### 服务端怎么存密码

- 不用 MD5、SHA-256 这类快速哈希，它们设计目标就是算得快，被拖库后很容易被暴力破解
- 用专门的密码哈希算法：首选 **Argon2id**，用不了时选 scrypt 或 bcrypt，有合规要求时用 PBKDF2。它们故意算得慢，并且可以调整计算成本
- 每个密码使用**随机的盐**，相同的密码存出来也不一样，彩虹表失效。主流库会自动生成盐，并和哈希一起存在结果字符串里
- bcrypt 大多数实现只处理前 72 字节，要限制密码长度

### 接口签名

前端用密钥对参数、时间戳、随机数计算签名，服务端验证，能防止参数在半路被篡改、请求被重放。但密钥就在前端代码里，任何人都能提取出来，给任意参数签名，混淆只能增加提取的成本。它适合用来提高爬虫和批量调用的门槛，不能作为安全边界，真正的防线是服务端的鉴权、权限校验和限流。

### Web Crypto API 适合做什么

- **安全随机数**：`crypto.getRandomValues()`、`crypto.randomUUID()`，生成 ID、盐、IV 时不要用 `Math.random()`
- **计算摘要**：`crypto.subtle.digest()` 计算文件哈希，用于秒传和校验完整性，见[大文件上传](/basics/network/18-large-file-upload)
- **端到端加密**：密钥从用户口令派生或在设备上生成，从不交给服务端，服务端只存密文，比如私密笔记、密码管理器、端到端加密的聊天
- **本地数据加密**：把 IndexedDB 里的数据加密存放，密钥设为不可导出

除了 `getRandomValues()`，`crypto.subtle`、`randomUUID()` 都只能在安全上下文（HTTPS 或 localhost）中使用。它提供的是底层原语，很容易用错，比如复用 IV、自己设计协议，重要的场景要找懂密码学的人审核。

## 代码示例

用口令派生密钥，再用 AES-GCM 加解密（浏览器和 Node.js 的 ES 模块中都能运行）：

```js
const enc = new TextEncoder()

// 从用户口令派生 AES 密钥。salt 随机生成，和密文一起保存，不需要保密
async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' }, // 迭代次数越大，暴力猜口令越慢
    base,
    { name: 'AES-GCM', length: 256 },
    false, // 不可导出：脚本只能拿它加解密，读不出原始密钥
    ['encrypt', 'decrypt'],
  )
}

async function encrypt(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12)) // 每次加密都用新的 IV，同一个密钥下绝不能复用
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text))
  return { iv, data }
}

async function decrypt(key, { iv, data }) {
  // 密文被改动过或者密钥不对，这里会直接抛错（GCM 自带完整性校验）
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
  return new TextDecoder().decode(plain)
}

const salt = crypto.getRandomValues(new Uint8Array(16))
const key = await deriveKey('用户自己的口令', salt)
const box = await encrypt(key, '只有我能看的笔记')
console.log(await decrypt(key, box)) // 只有我能看的笔记
```

## 面试官可能追问

::: details 面试时被问"密码要不要在前端加密"，怎么回答？
先给结论：传输安全靠 HTTPS，前端加密不能替代它。再分析它能防什么、不能防什么：提交的值本身就是凭证，截获了照样能登录；它只能让明文不出现在日志里、减少撞库风险。最后讲完整的方案：全站 HTTPS 加 HSTS，服务端慢哈希加盐存储，登录接口限流，配合多因素认证和异常登录检测。如果公司要求前端加密，可以做，但服务端照常按明文密码的标准处理。
:::

::: details 已经全站 HTTPS 了，为什么密码还是可能被截获？
常见原因都不在传输层：用户设备上被装了不可信的根证书，或者经过了会解密流量的代理；页面有 XSS 或用户装了恶意扩展，脚本直接读取输入框；用户在钓鱼页面上输入了密码。前端加密对这几种情况都无效，要靠防 XSS、CSP、多因素认证和风控。
:::

::: details 把 Token 加密后再存进 localStorage，有意义吗？
意义很小。前端要用 Token，就必须能解密，解密用的密钥也只能放在前端：XSS 脚本可以直接调用同样的解密逻辑，或者等页面解密后从内存里拿。它最多防住"有人直接翻看本地存储文件"。存储位置的取舍见 [Token 存在哪里更安全](/basics/web-security/04-token-storage)。
:::

## 易错点

- 把 Base64 当成加密：它只是编码，任何人都能还原
- 用 `Math.random()` 生成令牌、盐或 IV：它不是密码学安全的随机数
- AES-GCM 在同一个密钥下复用 IV：会直接破坏机密性和完整性
- 前端做了 MD5，服务端就直接存这个值：泄露后哈希值本身就能登录
