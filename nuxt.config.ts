// 站点标志：印章红底白字"面"
const favicon =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='%23c8372d'/><text x='32' y='45' font-size='36' font-weight='700' font-family='serif' text-anchor='middle' fill='white'>面</text></svg>"

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },

  // 接口测试单独构建到 .nuxt-test / .output-test，避免覆盖正在运行的开发服务器
  ...(process.env.HANDBOOK_TEST_BUILD ? { buildDir: '.nuxt-test', nitro: { output: { dir: '.output-test' } } } : {}),

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
    ai: {
      baseUrl: 'https://api.moonshot.cn/v1',
      apiKey: '',
      model: 'kimi-k2-turbo-preview',
      dailyLimit: 30,
      // 用户自带 Key 时，除预设服务商外额外允许的域名，逗号分隔，如 api.example.com
      extraHosts: '',
    },
    public: {
      siteName: '全栈面试手册',
    },
  },
})
