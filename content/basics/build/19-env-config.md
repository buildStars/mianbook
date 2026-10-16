---
difficulty: 2
tags: [实践, 安全]
---

# 前端项目的多环境配置怎么做？环境变量要注意什么？

::: tip 一句话回答
以 Vite 为例：按**模式**加载 `.env`、`.env.local`、`.env.[mode]`、`.env.[mode].local`，模式专属的文件优先于通用文件，启动命令时已经存在的环境变量优先级最高。只有 **`VITE_` 前缀**的变量会通过 **`import.meta.env`** 暴露给前端代码，并且在**构建时被直接替换成字面量**写进产物，所以这些值对所有用户都是公开的，**绝不能放密钥**。值一律是字符串，`"false"` 也是真值。想让同一份产物部署到测试、预发、生产多个环境，就把接口地址这类配置改成**运行时读取**，比如加载 `/config.json` 或者部署时注入一个全局配置对象。
:::

## 详细解析

### 文件约定和加载优先级

```text
.env                所有模式都加载
.env.local          所有模式都加载，只放在本机，不提交到仓库
.env.[mode]         只在对应模式加载，如 .env.production、.env.staging
.env.[mode].local   只在对应模式加载，只放在本机

优先级从高到低：
命令行里已有的环境变量 > .env.[mode].local > .env.[mode] > .env.local > .env
```

- `vite`（开发）默认模式是 `development`，`vite build` 默认是 `production`，用 `--mode staging` 切换，就会加载 `.env.staging`
- **模式和 `NODE_ENV` 是两回事**：`vite build --mode staging` 的 `NODE_ENV` 默认仍然是 `production`，代码照样压缩、删掉开发警告，只是读取的配置文件不同
- `.env` 文件在 Vite 启动时读取，改了要重启开发服务器
- `*.local` 文件要加进 `.gitignore`，适合放每个人自己的本地配置

### VITE_ 前缀和 import.meta.env

- 只有 `VITE_` 开头的变量能在前端代码里通过 `import.meta.env.VITE_XXX` 读到，其他变量读到的是 `undefined`。前缀可以用 `envPrefix` 修改，但不允许设为空字符串，否则所有环境变量都会暴露，Vite 会直接报错
- 内置的几个常量：`MODE`（当前模式）、`BASE_URL`、`DEV`、`PROD`、`SSR`
- 读到的值都是字符串，数字和布尔值要自己转换
- TypeScript 项目在 `vite-env.d.ts` 里扩展 `ImportMetaEnv` 接口，给自己的变量加上类型
- `index.html` 里可以用 `%VITE_APP_TITLE%` 的写法引用

`vite.config.js` 运行时，`.env` 里的值**不会**自动进入 `process.env`。配置文件里需要用（比如设置代理目标、上传 source map 的令牌）时，用 `loadEnv(mode, process.cwd(), '')` 手动加载，第三个参数传空字符串表示不按前缀过滤。这些值只在 Node.js 里使用，不会进入前端产物。

### 构建时替换：进了产物就是公开的

构建时，`import.meta.env.VITE_API_BASE` 会被替换成 `"https://api.example.com"` 这样的字面量，`import.meta.env.DEV` 被替换成 `false`，`if` 里的开发代码也就被当作死代码删掉了。也就是说，这些变量是**构建期常量**，不是运行时去读的环境变量。

因此，第三方服务的密钥、内部系统的地址和令牌，放进 `VITE_` 变量就等于公开发布。需要密钥的调用必须走自己的后端代理，前端只调用自己的接口，见 [前端敏感信息泄露](/basics/web-security/08-sensitive-data) 和 [API Key 的安全管理](/engineering/security/07-api-key)。其他构建工具也是同样的机制，例如 Next.js 的 `NEXT_PUBLIC_` 前缀、webpack 的 `DefinePlugin`。

### 一次构建，多环境部署

每个环境单独构建有几个问题：测试通过的产物和上线的产物不是同一份；每个环境都要等一次构建；回滚时还得找对应环境的那份产物。更好的做法是**构建一次，到处部署**，把随环境变化的配置从产物里拿出来：

1. **同域代理**：前端只请求相对路径 `/api`，由 nginx 或网关转发到各环境的后端，前端代码完全不需要知道后端地址，最简单
2. **运行时加载 `config.json`**：产物里不写死地址，应用启动时先请求 `/config.json`，拿到配置再挂载。每个环境部署时放一份不同的文件，比如在容器里挂载配置文件
3. **注入全局配置**：`index.html` 在应用脚本之前加载 `/config.js`，内容是 `window.__APP_CONFIG__ = {...}`；容器启动时由脚本根据环境变量生成这个文件

这些配置文件同样对用户可见，只放地址、开关这类公开信息。文件名不带哈希，不能设置长期强缓存，否则改了配置浏览器还在用旧的。部署和缓存策略见 [前端部署](/basics/build/14-frontend-deploy)。

### 和后端配置的区别

| | 前端构建变量 | 后端环境变量 |
| --- | --- | --- |
| 什么时候读取 | 构建时，替换进代码 | 进程运行时读取 `process.env` |
| 谁能看到 | 所有能打开页面的人 | 只有服务器 |
| 能不能放密钥 | 不能 | 可以，最好再配合密钥管理服务 |
| 修改后 | 重新构建、重新部署 | 重启进程，或者配置中心热更新 |

## 代码示例

```ini
# .env.production（提交到仓库，只放公开配置）
VITE_API_BASE=https://api.example.com
VITE_ENABLE_MOCK=false

# .env.production.local（不提交）：没有 VITE_ 前缀，只在 vite.config 里用 loadEnv 读取
SOURCEMAP_UPLOAD_TOKEN=xxxx
```

```js
// ❌ "false" 是非空字符串，条件永远成立
if (import.meta.env.VITE_ENABLE_MOCK) startMock()
// ✅ 明确和字符串比较
if (import.meta.env.VITE_ENABLE_MOCK === 'true') startMock()
```

运行时加载配置，再挂载应用：

```js
// src/config.js
let config = null

export async function loadConfig() {
  const res = await fetch('/config.json', { cache: 'no-store' }) // 不走缓存，每次都重新请求
  if (!res.ok) throw new Error(`加载配置失败：${res.status}`)
  config = await res.json()
}

export function getConfig() {
  if (!config) throw new Error('配置还没有加载')
  return config
}

// src/main.js
import { createApp } from 'vue'
import App from './App.vue'
import { loadConfig } from './config.js'

loadConfig()
  .then(() => createApp(App).mount('#app'))
  .catch((err) => {
    document.body.textContent = '应用初始化失败，请刷新重试'
    console.error(err)
  })
```

## 面试官可能追问

::: details 环境变量改了，为什么页面上没变？
`.env` 只在 Vite 启动时读取，开发时要重启开发服务器；构建产物里的值已经是字面量，改了服务器上的环境变量不会影响已经构建好的文件，必须重新构建。如果改的是运行时的 `config.json`，就要检查它是不是被浏览器或 CDN 缓存了。
:::

::: details 能不能把密钥加密后再放进前端？
不能解决问题。前端能解密，说明解密需要的密钥和代码也在前端，攻击者照着执行一遍就能拿到原文；即使拿不到原文，也可以直接在浏览器里调用你的代码发请求。密钥只能留在服务端，前端通过自己的接口间接使用。
:::

::: details 多个环境的配置项越来越多，怎么管理？
公共的默认值写在 `.env`，各环境只写差异；用 TypeScript 的类型声明或启动时的校验（如用 zod 校验 `import.meta.env` 和 `config.json`）保证必填项不缺失、格式正确，缺了就在构建或启动时直接报错，而不是线上才发现。真正需要按环境变化的配置，尽量收敛到运行时配置里。
:::

## 易错点

- 把密钥写进 `VITE_` 开头的变量，或者为了省事把 `envPrefix` 改得过宽，构建后它们都会出现在 JS 文件里
- 布尔开关直接拿来判断，`VITE_ENABLE_MOCK=false` 读到的是字符串 `"false"`，结果 mock 在生产环境被打开
- 以为 `--mode staging` 会让 `NODE_ENV` 也变成 staging，实际 `vite build` 下 `NODE_ENV` 默认是 `production`，模式只决定读哪些 `.env` 文件
- 在 `vite.config.js` 里直接读 `process.env.VITE_XXX`，拿不到 `.env` 文件里的值，要用 `loadEnv`
