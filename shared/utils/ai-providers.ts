/** 用户自带 API Key 时可选的服务商，都兼容 OpenAI 的 /chat/completions 接口 */
export interface AiProvider {
  id: string
  name: string
  baseUrl: string
}

export const AI_PROVIDERS: AiProvider[] = [
  { id: 'moonshot', name: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn/v1' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'qwen', name: '通义千问（阿里云百炼）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
  { id: 'siliconflow', name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
]

/** 浏览器把用户自己的 AI 配置放在这三个请求头里发给服务端 */
export const AI_HEADERS = {
  baseUrl: 'x-ai-base-url',
  model: 'x-ai-model',
  apiKey: 'x-ai-key',
} as const
