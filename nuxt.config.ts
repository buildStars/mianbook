import { fileURLToPath } from 'node:url'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },

  // 接口测试单独构建到 .nuxt-test / .output-test，避免覆盖正在运行的开发服务器
  ...(process.env.HANDBOOK_TEST_BUILD ? { buildDir: '.nuxt-test' } : {}),

  nitro: {
    ...(process.env.HANDBOOK_TEST_BUILD ? { output: { dir: '.output-test' } } : {}),
    // 写作规范打包进服务端，后台 AI 写题时作为提示词的一部分；默写练习的题目文件（practice/）也打包进去
    serverAssets: [
      { baseName: 'templates', dir: fileURLToPath(new URL('./templates', import.meta.url)) },
      { baseName: 'practice', dir: fileURLToPath(new URL('./practice', import.meta.url)) },
    ],
  },

  modules: ['@nuxtjs/color-mode', '@element-plus/nuxt', 'nuxt-auth-utils'],

  // 标题用思源宋体（可变字重），按字符分片自托管，浏览器只下载页面用到的分片
  css: ['@fontsource-variable/noto-serif-sc/wght.css', '~/assets/css/main.css', '~/assets/css/content.css'],

  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: '面书',
      meta: [
        { name: 'description', content: '面书：前端、后端、AI 应用高频面试题详解，一句话回答、追问和易错点，读完再让 AI 面试官考你一遍' },
        { name: 'apple-mobile-web-app-title', content: '面书' },
        { name: 'theme-color', content: '#faf9f6', media: '(prefers-color-scheme: light)' },
        { name: 'theme-color', content: '#131315', media: '(prefers-color-scheme: dark)' },
        // 百度：页面同时适配电脑和手机，移动搜索不要转码。两条 http-equiv 相同，用 key 区分，否则会被去重成一条
        { name: 'applicable-device', content: 'pc,mobile' },
        { 'http-equiv': 'Cache-Control', content: 'no-transform', key: 'no-transform' },
        { 'http-equiv': 'Cache-Control', content: 'no-siteapp', key: 'no-siteapp' },
      ],
      // 标志素材在 public/，生成方法见 DESIGN.md「站点标志」
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
        { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ],
    },
  },

  // 个人页面、账号页面和后台不让搜索引擎收录（robots.txt 只挡接口，页面靠这个响应头）
  routeRules: {
    // 接口返回的是数据，不收录（目录接口允许抓取，见 robots.txt）
    '/api/**': { headers: { 'X-Robots-Tag': 'noindex' } },
    '/admin/**': { headers: { 'X-Robots-Tag': 'noindex' } },
    // 只挡具体的面试记录；/mock 本身是功能介绍页，要收录（/mock/** 会连 /mock 一起匹配）
    '/mock/*': { headers: { 'X-Robots-Tag': 'noindex' } },
    '/mock/agent/*': { headers: { 'X-Robots-Tag': 'noindex' } },
    '/progress': { headers: { 'X-Robots-Tag': 'noindex' } },
    '/me': { headers: { 'X-Robots-Tag': 'noindex' } },
    '/favorites': { headers: { 'X-Robots-Tag': 'noindex' } },
    '/review': { headers: { 'X-Robots-Tag': 'noindex' } },
    '/report': { headers: { 'X-Robots-Tag': 'noindex' } },
    '/connect': { headers: { 'X-Robots-Tag': 'noindex' } },
    '/login': { headers: { 'X-Robots-Tag': 'noindex' } },
    '/register': { headers: { 'X-Robots-Tag': 'noindex' } },
    '/forgot-password': { headers: { 'X-Robots-Tag': 'noindex' } },
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
      // 发件人，例如 面书 <xxx@qq.com>；不填时用 user
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
    // TalkCue（面试提词助手）从内网查题库用的接口 /api/internal/talkcue-search：token 没配置时接口不存在。
    // minSimilarity 是"题库里有答案"的向量相似度门槛，见 server/utils/talkcue.ts
    talkcue: {
      token: '',
      minSimilarity: 0.62,
    },
    public: {
      siteName: '面书',
      // 对外的网址：canonical、分享卡片、sitemap 里的绝对地址都用它，部署到别的域名时用 NUXT_PUBLIC_SITE_URL 覆盖
      siteUrl: 'https://mianbook.ink',
      // 搜索引擎站长平台"HTML 标签验证"的验证码（meta 标签 content 里的那串），填了才输出到页面，
      // 例如 NUXT_PUBLIC_SITE_VERIFICATION_BAIDU=codeva-xxxx，见 .env.example
      siteVerification: { google: '', bing: '', baidu: '' },
    },
  },
})
