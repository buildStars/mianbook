import { lt } from 'drizzle-orm'

/**
 * 把接口抛出的 5xx 错误记进 error_logs，后台概览里能看到最近的错误（不接第三方监控也能发现问题）。
 * 4xx 是用户的请求有问题，不记；同样的错误一分钟内只记一次，防止刷屏
 */
const recent = new Map<string, number>()

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, { event }) => {
    const status = Number((error as { statusCode?: number }).statusCode ?? 500)
    if (status < 500) return
    const message = String(error.message || 'Unknown error').slice(0, 500)
    const path = event?.path?.split('?')[0]?.slice(0, 255) ?? null
    const key = `${status}:${path}:${message}`
    const now = Date.now()
    if (now - (recent.get(key) ?? 0) < 60_000) return
    recent.set(key, now)
    if (recent.size > 1000) recent.clear()

    const db = useDb()
    db.insert(tables.errorLogs)
      .values({ message, stack: error.stack?.slice(0, 4000) ?? null, method: event?.method ?? null, path, statusCode: status })
      .catch(() => {})
    // 偶尔清理 30 天前的记录
    if (Math.random() < 0.02) {
      db.delete(tables.errorLogs)
        .where(lt(tables.errorLogs.createdAt, new Date(now - 30 * 86_400_000)))
        .catch(() => {})
    }
  })
})
