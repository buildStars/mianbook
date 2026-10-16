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

/** 注册相关的设置 */
export interface AuthSettings {
  /** 注册时是否需要邮箱验证码；不设置时，配置了发信就开启 */
  requireEmailCode?: boolean
}

const STALE_MS = 30_000
let ai: AiSettings = {}
let auth: AuthSettings = {}
let loadedAt = 0
let loading: Promise<void> | null = null

/** 从数据库读设置到内存；读失败时保留上一次的值 */
export function loadSettings(): Promise<void> {
  loading ??= (async () => {
    try {
      const rows = await useDb().select().from(tables.settings)
      const byKey = new Map(rows.map((r) => [r.key, r.value]))
      ai = (byKey.get('ai') as AiSettings) ?? {}
      auth = (byKey.get('auth') as AuthSettings) ?? {}
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

export const authSettings = (): AuthSettings => auth

export async function saveAuthSettings(next: AuthSettings) {
  await useDb().insert(tables.settings).values({ key: 'auth', value: next }).onDuplicateKeyUpdate({ set: { value: next } })
  auth = next
  loadedAt = Date.now()
}

export async function saveAiSettings(next: AiSettings) {
  await useDb().insert(tables.settings).values({ key: 'ai', value: next }).onDuplicateKeyUpdate({ set: { value: next } })
  ai = next
  loadedAt = Date.now()
}
