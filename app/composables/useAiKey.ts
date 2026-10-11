export interface UserAiConfig {
  providerId: string
  baseUrl: string
  model: string
  apiKey: string
}

const STORAGE_KEY = 'handbook-ai-key'

/**
 * 用户自己的 AI 配置，只保存在当前浏览器的 localStorage 里，不上传到数据库。
 * 面试时通过请求头带给服务端，服务端用完即弃
 */
export function useAiKey() {
  const config = useState<UserAiConfig | null>('user-ai-config', () => null)

  /** 由插件在水合完成后调用：服务端渲染时没有这份数据，提前读会导致水合不匹配 */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      config.value = raw ? JSON.parse(raw) : null
    } catch {
      // 隐私模式或数据损坏时当作没有配置
    }
  }

  const hasKey = computed(() => Boolean(config.value?.apiKey && config.value.baseUrl && config.value.model))

  function save(next: UserAiConfig) {
    config.value = { ...next, apiKey: next.apiKey.trim(), model: next.model.trim() }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config.value))
    } catch {
      // 存不下也能在本次访问中使用
    }
  }

  function clear() {
    config.value = null
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // 忽略
    }
  }

  /** 发给服务端的请求头；没有配置时为空对象，服务端使用站点的 Key */
  function headersFor(c: UserAiConfig | null = config.value): Record<string, string> {
    if (!c?.apiKey) return {}
    return { [AI_HEADERS.baseUrl]: c.baseUrl, [AI_HEADERS.model]: c.model, [AI_HEADERS.apiKey]: c.apiKey }
  }

  return { config, hasKey, load, save, clear, headersFor }
}
