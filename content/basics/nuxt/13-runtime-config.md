---
difficulty: 2
tags: [实践, 安全]
---

# Nuxt 的 runtimeConfig 和 app.config 有什么区别？部署时环境变量怎么生效？

::: tip 一句话回答
**runtimeConfig** 放和环境有关的配置：顶层键**只在服务端可见**，适合放密钥；`public` 下的键两端都能读。它能在**运行时用 `NUXT_` 开头的环境变量覆盖**，同一份构建产物可以部署到不同环境。**app.config** 放主题、文案这类公开配置，会打进客户端包，可以在运行时用 `updateAppConfig` 修改，但**不能放任何密钥**。
:::

## 详细解析

### runtimeConfig：私有和公开两层

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  runtimeConfig: {
    apiSecret: '', // 私有：只有服务端能读
    public: {
      apiBase: '/api', // 公开：服务端和客户端都能读
    },
  },
})
```

- 客户端只能拿到 `public`（和 Nuxt 保留的 `app`）里的键，读到的对象是响应式的、可以修改
- 服务端能读到全部键，但是只读
- 以 `app` 开头的键是 Nuxt 保留的，例如 `appSecret`，自己起名时避开
- 配置会先序列化再交给服务端，函数、Map、Set 这类值不要写进去

读取时，组件和插件里用 `useRuntimeConfig()`；服务端接口里用 `useRuntimeConfig(event)`，传入 event 才能拿到被环境变量覆盖后的值。

### 环境变量怎么覆盖

运行时，Nuxt 会用**大写、以 `NUXT_` 开头**的环境变量覆盖同名配置，下划线对应键的分隔和驼峰：

| 环境变量 | 覆盖的键 |
| --- | --- |
| `NUXT_API_SECRET` | `apiSecret` |
| `NUXT_PUBLIC_API_BASE` | `public.apiBase` |

几个规则：

- **只能覆盖 nuxt.config 里声明过的键**。没声明 `apiSecret`，设了 `NUXT_API_SECRET` 也读不到
- 值会被转换类型，像数字的字符串会变成数字。要保持字符串，值里要带上引号
- 默认值写成 `process.env.OTHER_VAR` 只在**构建时求值**，部署时改这个变量没有效果。要在运行时生效，就用 `NUXT_` 开头的变量名

### .env 文件只在开发和构建时读

Nuxt CLI 在 `nuxt dev`、`nuxt build`、`nuxt generate` 时读取 `.env`。**运行构建好的服务（`node .output/server/index.mjs`）不会读 `.env`**。生产环境要在部署平台、容器或进程管理器里设置真实的环境变量。

这也是一次构建、多环境部署的基础：产物里不写死环境相关的值，启动时由环境变量注入。

### app.config：公开的、可在运行时改的配置

```ts
// app/app.config.ts
export default defineAppConfig({
  theme: { primary: '#2563eb' },
  footer: { text: 'Acme 版权所有' },
})
```

- 用 `useAppConfig()` 读取，结果是响应式的；可以用 `updateAppConfig()` 在运行时修改，开发时改文件支持热更新
- 内容会进入客户端包，文档明确要求不要放密钥
- 文档没有提供用环境变量覆盖 app.config 的机制，它的值来自源码
- 在 [layers](/basics/nuxt/12-layers) 场景里很常用：layer 给默认主题，使用方的 app.config 深合并覆盖

### 怎么选

| | runtimeConfig | app.config |
| --- | --- | --- |
| 典型内容 | 密钥、接口地址、第三方服务 ID | 主题色、UI 文案、功能开关的默认值 |
| 可见范围 | 顶层仅服务端，`public` 两端 | 两端，打进客户端包 |
| 环境变量覆盖 | 支持 `NUXT_` 前缀 | 文档未提供 |
| 运行时修改 | 客户端的 `public` 可写 | `updateAppConfig` |

和 Vite 的 `import.meta.env` 不同，那是构建时替换进产物的常量，见 [多环境配置](/basics/build/19-env-config)。

## 代码示例

```ts
// server/api/orders.get.ts：密钥只在服务端用
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  return $fetch('https://pay.example.com/orders', {
    headers: { Authorization: `Bearer ${config.apiSecret}` },
  })
})
```

```bash
# 生产环境启动：不读 .env，变量由部署平台注入
NUXT_API_SECRET=xxx NUXT_PUBLIC_API_BASE=https://api.example.com node .output/server/index.mjs
```

## 面试官可能追问

::: details 为什么密钥绝对不能放进 public？
`public` 里的值会序列化进页面的 payload 发给浏览器，任何人打开页面源码或调试工具都能看到。密钥只能放顶层私有键，在服务端接口里使用，客户端通过调用自己的接口间接使用。
:::

::: details 部署后改了环境变量，配置没变，可能是什么原因？
常见三种：变量名不是 `NUXT_` 开头，或者键没有在 nuxt.config 里声明；默认值写的是 `process.env.XXX`，在构建时已经求值；以为生产服务会读 `.env`。另外服务端代码里最好用 `useRuntimeConfig(event)` 读取。
:::

::: details 环境变量的值 "123456" 读出来变成了数字，怎么办？
Nuxt 用 destr 解析环境变量的值，能按 JSON 解析成数字或布尔的会被转换，"123456" 变成数字 123456，代码里按字符串比较或调用字符串方法就会出错（"0123" 这种不合法的 JSON 数字反而保持字符串）。需要保持字符串时，在值里带上引号，例如 `NUXT_PUBLIC_CODE="\"123456\""`。
:::

## 易错点

- 在 `public` 里放密钥，或者在 app.config 里放密钥，两者都会进入浏览器
- 以为任意 `NUXT_` 变量都能读到，实际只能覆盖 nuxt.config 里声明过的键
- 把 `process.env.XXX` 写成默认值后，部署时改 `XXX` 期望生效，其实它只在构建时求值
- 以为 `node .output/server/index.mjs` 会读 `.env`，生产环境要设置真实的环境变量
