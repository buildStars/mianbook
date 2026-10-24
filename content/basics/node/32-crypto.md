---
difficulty: 2
tags: [安全, 实践]
---

# Node.js 的 crypto 模块常用来做什么？哈希、HMAC、加密和随机数分别怎么选？

::: tip 一句话回答
按目的选：校验**完整性**用哈希（sha256）；防**篡改**、验证来源用 **HMAC**（带密钥，如 Webhook 签名）；**存密码**用慢哈希（内置的 `scrypt`，较新的版本里还内置了 argon2），不能用 md5、sha256 直接存；要能**还原明文**才用加密，对称加密选 **AES-256-GCM**，IV 每次随机，并保存校验 authTag；**随机数**用 `randomBytes`、`randomUUID`、`randomInt`，不用 `Math.random`。比较签名和令牌用 `timingSafeEqual`，长度不同它会直接抛错，要先处理长度。
:::

## 详细解析

### 四类需求，别用混

| 目的 | 用什么 | 关键点 |
| --- | --- | --- |
| 文件、数据有没有损坏或被替换 | 哈希：`crypto.hash('sha256', data)` 或 `createHash` | 无密钥，谁都能算，只防意外损坏 |
| 消息是不是我方签发、有没有被改 | HMAC：`createHmac('sha256', secret)` | 有密钥，用于 Webhook 签名、签名 Cookie、接口签名 |
| 存用户密码 | 慢哈希：`scrypt`、argon2 | 每个用户随机盐，故意慢，抗暴力破解 |
| 需要还原的敏感数据 | 加密：AES-256-GCM | 密钥管理是重点，IV 不能重复 |
| 令牌、验证码、ID | `randomBytes`、`randomUUID`、`randomInt` | 用密码学安全的随机源 |

`crypto.hash(algorithm, data)` 是一次性哈希的简便写法，直接返回十六进制字符串；数据分多次到达（比如流式计算文件哈希）时用 `createHash().update().digest()`。

### 为什么密码不能用 sha256

sha256 设计得很快，攻击者拿到数据库后每秒能尝试极多的候选密码。存密码要用**故意慢、可调成本**的算法：`scrypt` 同时消耗 CPU 和内存，增加了用专用硬件并行破解的成本。每个用户用不同的随机盐，相同密码的存储结果也不一样，彩虹表就没用了。

argon2 在较新的版本里也内置了（`crypto.argon2`，可选 argon2d、argon2i、argon2id，存密码一般用 argon2id），旧版本没有这个 API，以所用版本的文档为准；用不了时可以用 scrypt，或者第三方的 argon2 库。前端到底要不要加密密码，见 [前端加密有用吗](/basics/web-security/07-frontend-crypto)。

### 比较签名要防时序攻击

`a === b` 遇到第一个不同的字符就返回，比较耗时会泄露"前面猜对了几位"。`timingSafeEqual` 的耗时只和长度有关。它要求两个 Buffer **长度相同**，否则直接抛 `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH`，所以要先判断长度，或者先把两边各做一次 HMAC 或哈希变成定长再比较。长度本身一般不是秘密，先比长度没有问题。

### AES-256-GCM 的要点

- GCM 是**认证加密**：加密的同时生成 authTag，解密时校验，密文被改过一个比特都会失败
- **IV（nonce）每次加密都随机生成**，长度用 12 字节；同一个密钥下 IV 重复会严重破坏安全性
- IV 和 authTag 不是秘密，和密文一起保存；解密前必须 `setAuthTag`
- 密钥是 32 字节的随机值，放在环境变量或密钥管理服务（KMS）里，不写进代码和仓库；要轮换密钥时，在密文里带上密钥版本号

### Web Crypto

全局的 `crypto.subtle`（Web Crypto API）在 Node.js 和浏览器里都能用，接口全是 Promise。写同时跑在浏览器、边缘运行时和 Node.js 上的代码时用它；只在 Node.js 里用时，`node:crypto` 的 API 更全、更顺手。

## 代码示例

```js
import { createHmac, timingSafeEqual, scrypt, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

// 1. 校验 Webhook 签名：对原始请求体算 HMAC，再常量时间比较
function verifySignature(rawBody, signatureHex, secret) {
  const expected = createHmac('sha256', secret).update(rawBody).digest()
  const received = Buffer.from(signatureHex, 'hex')
  if (received.length !== expected.length) return false // 长度不同 timingSafeEqual 会抛错
  return timingSafeEqual(received, expected)
}

// 2. 存密码：随机盐 + scrypt，盐和结果一起存
async function hashPassword(password) {
  const salt = randomBytes(16)
  const key = await scryptAsync(password, salt, 64)
  return `${salt.toString('hex')}:${key.toString('hex')}`
}
async function verifyPassword(password, stored) {
  const [saltHex, keyHex] = stored.split(':')
  const key = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64)
  return timingSafeEqual(key, Buffer.from(keyHex, 'hex')) // 都是 64 字节
}

// 3. AES-256-GCM：输出 iv + authTag + 密文
function encrypt(plaintext, key) {
  const iv = randomBytes(12) // 每次随机，不能复用
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')
}
function decrypt(payload, key) {
  const buf = Buffer.from(payload, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12))
  decipher.setAuthTag(buf.subarray(12, 28)) // authTag 默认 16 字节
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8')
}

const body = '{"event":"paid"}'
const sig = createHmac('sha256', 'whsec_demo').update(body).digest('hex')
console.log(verifySignature(body, sig, 'whsec_demo'))       // true
console.log(verifySignature(body + ' ', sig, 'whsec_demo')) // false
console.log(verifySignature(body, 'abcd', 'whsec_demo'))    // false，不会抛错

const stored = await hashPassword('correct horse')
console.log(await verifyPassword('correct horse', stored))  // true
console.log(await verifyPassword('wrong', stored))          // false

const key = randomBytes(32) // 实际从 KMS 或环境变量读取
console.log(decrypt(encrypt('手机号 13800000000', key), key)) // 手机号 13800000000
```

密文被改动后，`decipher.final()` 会抛出 `Unsupported state or unable to authenticate data`，调用方要捕获并当作数据无效处理。

## 面试官可能追问

::: details 校验 Webhook 签名时，为什么要用原始请求体？
签名是对发送方的原始字节算的。如果先 `JSON.parse` 再 `JSON.stringify`，空格、字段顺序、转义都可能变，算出的 HMAC 就对不上。框架里要拿到未解析的 raw body，再做校验。通常还要校验时间戳，拒绝过期的请求，防止重放。
:::

::: details 加密和哈希的根本区别是什么？
加密可逆，有密钥就能还原明文，用于之后还要读的数据，比如身份证号、第三方 API 密钥。哈希不可逆，只能比对，用于只需要验证、不需要还原的场景，比如密码。能用哈希解决的就不要加密，少一份需要保管的密钥。
:::

::: details scrypt 会阻塞事件循环吗？
异步的 `scrypt` 在 libuv 线程池里执行，不阻塞主线程，但线程池默认只有 4 个线程，登录高峰时会排队，也会拖慢同样走线程池的 `fs` 操作。不要在请求里用 `scryptSync`。参数（成本、内存）按压测结果调，让单次计算的耗时在可接受的范围内。
:::

## 易错点

- 用 md5、sha1 或不加盐的 sha256 存密码，或者所有用户共用一个盐
- 直接对两个长度可能不同的 Buffer 调用 `timingSafeEqual`：会抛 `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH`，要先判断长度
- AES-GCM 用固定 IV，或者解密时不设置 authTag
- 用 `Math.random()` 生成令牌、验证码：它不是密码学安全的随机数，结果可能被预测；更多服务端安全问题见 [Node.js 常见的安全问题](/basics/node/16-security)
