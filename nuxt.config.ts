import { fileURLToPath } from 'node:url'

// 站点标志：印章红底白字"面"
const favicon =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='%23c8372d'/><text x='32' y='45' font-size='36' font-weight='700' font-family='serif' text-anchor='middle' fill='white'>面</text></svg>"

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },

  // 接口测试单独构建到 .nuxt-test / .output-test，避免覆盖正在运行的开发服务器
  ...(process.env.HANDBOOK_TEST_BUILD ? { buildDir: '.nuxt-test' } : {}),

  nitro: {
    ...(process.env.HANDBOOK_TEST_BUILD ? { output: { dir: '.output-test' } } : {}),
    // 写作规范打包进服务端，后台 AI 写题时作为提示词的一部分
    serverAssets: [{ baseName: 'templates', dir: fileURLToPath(new URL('./templates', import.meta.url)) }],
  },

  modules: ['@nuxtjs/color-mode', '@element-plus/nuxt', 'nuxt-auth-utils'],

  // 标题用思源宋体（可变字重），按字符分片自托管，浏览器只下载页面用到的分片
  css: ['@fontsource-variable/noto-serif-sc/wght.css', '~/assets/css/main.css', '~/assets/css/content.css'],

  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: '全栈面试手册',
      meta: [
        { name: 'description', content: '前端、后端、LLM 与 Agent 面试题详解，带 AI 模拟面试官' },
        { name: 'theme-color', content: '#faf9f6', media: '(prefers-color-scheme: light)' },
        { name: 'theme-color', content: '#131315', media: '(prefers-color-scheme: dark)' },
      ],
      link: [{ rel: 'icon', href: favicon }],
    },
  },

  colorMode: {
    classSuffix: '',
    preference: 'system',
    fallback: 'light',
    storageKey: 'handbook-color-mode',
  },

  elementPlus: {
    importStyle: 'css',
    themes: ['dark'],
  },

  // AI 点评在浏览器端用 markdown-it 渲染，提前预构建，避免开发时首次打开题目页触发整页刷新
  vite: {
    optimizeDeps: { include: ['markdown-it', 'markdown-it-cjk-friendly'] },
  },

  // 环境变量会覆盖这里的默认值，例如 NUXT_AI_API_KEY → ai.apiKey，见 .env.example
  runtimeConfig: {
    databaseUrl: '',
    // 后台修改题目时写回的 content 目录，默认是启动目录下的 content/；部署环境没有这个目录时只改数据库
    contentDir: '',
    ai: {
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKey: '',
      model: 'kimi-k2-turbo-preview',
      dailyLimit: 30,
      // 用户自带 Key 时，除预设服务商外额外允许的域名，逗号分隔，如 api.example.com
      extraHosts: '',
    },
    // 问手册（RAG）的向量模型：OpenAI 兼容的 /embeddings 接口，默认硅基流动的 bge-m3（中英文都好）。
    // 不填 Key 时只用关键词检索，问手册照样能用
    embed: {
      baseUrl: 'https://api.siliconflow.cn/v1',
      apiKey: '',
      model: 'BAAI/bge-m3',
      // 每次请求送几段文本
      batchSize: 16,
    },
    // 问手册的重排模型：混合检索取出的前 candidates 块交给它，按和问题的相关度重新排序（/rerank 接口，硅基流动、Jina、Cohere 通用）。
    // 接口地址和 Key 留空时沿用上面 embed 的；model 设为空字符串关闭重排。超时或出错时用融合排序，不影响回答
    rerank: {
      baseUrl: '',
      apiKey: '',
      model: 'BAAI/bge-reranker-v2-m3',
      // 候选越多越可能把排在后面的正确资料捞回来，耗时和 token 也越多
      candidates: 30,
      timeoutMs: 3000,
    },
    // 发信（注册验证码）：SMTP 配置，例如 QQ 邮箱 smtp.qq.com、465 端口、授权码。
    // 云服务器一般封了 25 端口，要用 465（SSL）或 587。outboxDir 设置后不真正发信，而是把邮件写成文件，用于本地开发和测试
    mail: {
      host: '',
      port: 465,
      user: '',
      pass: '',
      // 发件人，例如 全栈面试手册 <xxx@qq.com>；不填时用 user
      from: '',
      outboxDir: '',
    },
    auth: {
      // 部署在反向代理（Caddy）后面时设为 true，用 X-Forwarded-For 识别用户 IP
      trustProxy: false,
      // 验证码的发送限制
      codeCooldownSeconds: 60,
      codePerEmailHourly: 5,
      codePerIpHourly: 10,
      codePerIpDaily: 30,
      codeDailyTotal: 500,
    },
    public: {
      siteName: '全栈面试手册',
    },
  },
})
