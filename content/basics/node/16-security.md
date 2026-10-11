---
difficulty: 2
tags: [高频, 安全]
---

# Node.js 服务常见的安全问题有哪些？

::: tip 一句话回答
Node.js 服务的安全问题大多来自"**把外部输入当成了代码或结构**"：**原型污染**（不可信的对象被深度合并进来，改到了 `Object.prototype`）、**命令注入**（把输入拼进 shell 命令）、**路径穿越**（用户给的路径跳出了允许的目录）、**SQL / NoSQL 注入**、**ReDoS**（正则回溯卡死主线程）、**SSRF**（服务端替用户请求了内网地址）。另一大类是**依赖和供应链**：一个项目动辄上千个间接依赖，要靠 lock 文件、`npm audit`、限制安装脚本来控制风险。再加上安全响应头（如用 helmet）、请求体大小限制、不暴露错误堆栈，构成基本的防线。
:::

## 详细解析

### 原型污染

JS 对象通过原型链继承属性。如果代码把不可信的 JSON 递归合并到另一个对象上，而 JSON 中包含 `__proto__` 这类**特殊键名**，赋值操作会顺着它改到 `Object.prototype`，之后进程里**所有对象**都多了这个属性。后果取决于后续代码怎么用这些属性：可能绕过 `if (user.isAdmin)` 这类判断，可能让某些库走进异常分支导致拒绝服务，配合模板引擎等"把属性当配置"的代码时甚至可能执行代码。

防御：

- 合并、按路径设值（`set(obj, 'a.b.c', v)`）时跳过 `__proto__`、`constructor`、`prototype` 三个键，使用已修复此问题的工具库版本
- 用 schema 校验请求体（如 zod、ajv），只接收声明过的字段，见 [运行时校验](/basics/typescript/18-runtime-validation)
- 存放用户提供的键值对时用 `Map`，或用 `Object.create(null)` 创建没有原型的对象
- 启动参数 `--disable-proto=delete` 可以删除 `Object.prototype.__proto__` 访问器，减少一类攻击面

### 命令注入和路径穿越

**命令注入**：`exec` 把整条命令交给 shell 解析，用户输入里的 shell 元字符会被当成命令的一部分。需要调用外部程序时用 `execFile` 或 `spawn`（不开 `shell: true`），参数以数组传入，不经过 shell 解析，详见 [child_process 的几种方法](/basics/node/06-multi-core)。同时对参数做白名单校验，防止输入被外部程序当成选项解析。

**路径穿越**：用户传入的文件名中带 `../`，或者干脆是绝对路径，拼接后就能读到目录之外的文件（配置文件、密钥）。正确做法是先 `path.resolve` 成绝对路径，再检查它是否仍在允许的根目录下，见下方代码。简单地删掉 `../` 字符串不可靠，编码、反斜杠等变体都可能绕过。

### 注入和 ReDoS

- **SQL 注入**：一律用参数化查询，见 [数据库访问](/basics/node/15-database-access)
- **NoSQL 注入**：查询参数被框架解析成对象后，原本应该是字符串的字段变成了带查询运算符的对象，查询条件的语义就被改变了。防御是校验字段类型，确保该是字符串的就是字符串
- **ReDoS**：特定输入让回溯式正则引擎做指数级的尝试，主线程被卡住，整个服务不可用。避免嵌套量词，限制输入长度，用户可控的正则用线性时间的引擎，排查方法见 [CPU 飙高怎么排查](/basics/node/13-cpu-profiling)

### SSRF

服务端根据用户提供的 URL 发起请求（抓取网页预览、Webhook 回调、导入远程图片），攻击者就可以让服务器去访问它本来访问不到的地方：内网的管理后台、数据库的 HTTP 接口、云厂商的实例元数据服务（里面可能有临时凭证）。

防御：

- 能用白名单就用白名单，只允许指定的域名
- 做不到白名单时，解析域名后检查 IP，拒绝内网、回环、链路本地等地址段；**每次重定向后都要重新检查**，或者禁止跟随重定向
- 防 DNS 重绑定：检查用的 IP 和实际连接的 IP 必须是同一个，可以在建立连接时的 DNS 解析钩子里校验（如 `http.request` 的 `lookup` 选项），而不是先查一次再让库自己去解析
- 网络层兜底：发起外部请求的服务放在受限的网络出口后面

### 依赖和供应链

| 风险 | 措施 |
| --- | --- |
| 依赖中有已知漏洞 | `npm audit` 定期检查，配合 Dependabot、Renovate 自动提升级 PR |
| 安装时装到了不同或被篡改的版本 | 提交 lock 文件，CI 中用 `npm ci`，校验 integrity，见 [lock 文件](/basics/node/10-package-managers) |
| 恶意包在安装时执行脚本 | 对不需要构建的依赖禁用安装脚本（`npm ci --ignore-scripts`）；pnpm 10 起默认不运行依赖的安装脚本，需要构建的包在 `allowBuilds`（旧版本是 `onlyBuiltDependencies`）中逐个放行 |
| 包名拼写相近的仿冒包、维护者账号被盗 | 引入新依赖前看下载量、维护状态和发布来源；减少不必要的依赖 |

### 其他基础防线

- **安全响应头**：helmet 中间件一次设置 `Content-Security-Policy`、`Strict-Transport-Security`、`X-Content-Type-Options` 等响应头，并去掉暴露技术栈的 `X-Powered-By`
- **限制请求体大小**：`express.json({ limit: '100kb' })`，防止超大请求体耗尽内存和 CPU
- **错误信息**：生产环境不把堆栈和 SQL 返回给客户端
- **密钥**：放在环境变量或密钥管理服务中，不提交到仓库，不写进日志
- **调试端口**：`--inspect` 只绑定 `127.0.0.1`

## 代码示例

```js
import path from 'node:path'
import { readFile, realpath } from 'node:fs/promises'

// 合并不可信对象时跳过危险的键
const BLOCKED = new Set(['__proto__', 'constructor', 'prototype'])
export function safeMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (BLOCKED.has(key)) continue
    const val = source[key]
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      if (!Object.hasOwn(target, key) || typeof target[key] !== 'object') target[key] = {}
      safeMerge(target[key], val)
    } else {
      target[key] = val
    }
  }
  return target
}

// 防路径穿越：解析成绝对路径后，确认仍在允许的目录里
const ROOT = path.resolve('public')
const ROOT_REAL = await realpath(ROOT) // 根目录本身也可能在符号链接下
export async function readPublicFile(userPath) {
  const full = path.resolve(ROOT, userPath) // 绝对路径会直接覆盖 ROOT，也要被拦住
  if (!full.startsWith(ROOT + path.sep)) throw new Error('非法路径')
  const real = await realpath(full) // 目录中有符号链接时，检查真实路径
  if (!real.startsWith(ROOT_REAL + path.sep)) throw new Error('非法路径')
  return readFile(real, 'utf8')
}
```

检查前缀时要带上路径分隔符：只检查 `startsWith(ROOT)` 的话，`/srv/public-secret` 也会被当成在 `/srv/public` 下面。

## 面试官可能追问

::: details Node.js 的权限模型能防住这些问题吗？
权限模型（`--permission`）可以限制进程能读写哪些目录、能否创建子进程和 Worker 等，能缩小出问题后的影响范围。但官方文档明确说它是"安全带"式的设计，用来防止可信代码意外访问未授权的资源，**不能防御恶意代码**，恶意代码有办法绕过它。所以它只是纵深防御的一层，不能代替输入校验和依赖治理，见 [Node.js 新能力](/basics/node/20-new-features)。
:::

::: details npm audit 报了一堆漏洞，都要修吗？
先看漏洞在不在实际会执行的路径上：只在构建工具里、不处理外部输入的依赖，风险低很多，可以用 `npm audit --omit=dev` 只看生产依赖。能通过升级修复的尽快升级；上游还没修复的间接依赖可以用 `overrides` 强制版本；确实不受影响的记录原因后忽略。不建议无脑执行 `npm audit fix --force`，它可能跨主版本升级、引入破坏性变更。
:::

::: details 为什么 JSON.parse 不会直接污染原型，合并时却会？
`JSON.parse` 把 `__proto__` 当成普通的自有属性创建出来，不会改原型。问题出在后续的合并代码：它遍历到这个键后执行 `target[key] = ...` 或递归进入 `target[key]`，而对普通对象来说 `target['__proto__']` 取到的正是 `Object.prototype`，于是改到了全局的原型上。所以要防的是"拿不可信的键去读写对象"的代码。
:::

## 易错点

- 用 `startsWith(ROOT)` 检查路径时没有带分隔符，或者先检查再做 URL 解码
- 以为用了 `spawn` 就安全，却同时开了 `shell: true`
- SSRF 只在第一次请求前检查 IP，没有处理重定向和 DNS 重绑定
- 以为 lock 文件和 `npm audit` 就能解决供应链问题：它们只能发现已知漏洞、保证可复现，挡不住新出现的恶意版本
