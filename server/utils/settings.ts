import { eq } from 'drizzle-orm'

/** 后台可以在线修改的 AI 设置；没设置的项用 .env 里的默认值。API Key 不在这里，只放 .env */
export interface AiSettings {
  model?: string
  dailyLimit?: number
  extraHosts?: string[]
  /** 是否允许用户在页面上填自己的 Key，默认允许 */
  allowUserKey?: boolean
  /** 站点 Key 的价格（每百万 token），用来在看板上估算费用 */
  pricing?: { input: number; output: number; currency: 'CNY' | 'USD' } | null
}

const STALE_MS = 30_000
let ai: AiSettings = {}
let loadedAt = 0
let loading: Promise<void> | null = null

/** 从数据库读设置到内存；读失败时保留上一次的值 */
export function loadSettings(): Promise<void> {
  loading ??= (async () => {
    try {
      const [row] = await useDb().select().from(tables.settings).where(eq(tables.settings.key, 'ai'))
      ai = (row?.value as AiSettings) ?? {}
      loadedAt = Date.now()
    } catch (error) {
      console.error('[settings] 读取失败', error)
    } finally {
      loading = null
    }
  })()
  return loading
}

/** 超过 30 秒没刷新就重新读（多实例部署时，别的实例改了设置也能很快生效） */
export async function refreshSettingsIfStale() {
  if (Date.now() - loadedAt > STALE_MS) await loadSettings()
}

/** 当前生效的覆盖值（同步读取内存） */
export const aiOverrides = (): AiSettings => ai

export async function saveAiSettings(next: AiSettings) {
  await useDb().insert(tables.settings).values({ key: 'ai', value: next }).onDuplicateKeyUpdate({ set: { value: next } })
  ai = next
  loadedAt = Date.now()
}
