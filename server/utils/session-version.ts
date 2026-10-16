import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'

/**
 * 会话版本：会话是加密后存在 Cookie 里的（无状态），服务端没法直接作废某个会话。
 * 所以在会话里记一个版本号，改密码时把用户的版本加 1，旧 Cookie 里的版本对不上就当作已退出。
 * 每个请求都要比对，版本号在内存里缓存 30 秒；本实例改密码时立即更新缓存
 */
const TTL = 30_000
const cache = new Map<number, { version: number | null; at: number }>()

/** 用户当前的会话版本；用户已被删除时返回 null */
export async function sessionVersionOf(userId: number): Promise<number | null> {
  const hit = cache.get(userId)
  if (hit && Date.now() - hit.at < TTL) return hit.version
  const [row] = await useDb()
    .select({ v: tables.users.sessionVersion })
    .from(tables.users)
    .where(eq(tables.users.id, userId))
  const version = row ? row.v : null
  cache.set(userId, { version, at: Date.now() })
  if (cache.size > 10_000) cache.delete(cache.keys().next().value!)
  return version
}

/** 让这个用户所有已登录的会话失效，返回新的版本号 */
export async function bumpSessionVersion(userId: number, current: number): Promise<number> {
  const next = current + 1
  await useDb().update(tables.users).set({ sessionVersion: next }).where(eq(tables.users.id, userId))
  cache.set(userId, { version: next, at: Date.now() })
  return next
}

/** 登录、注册、重置密码后写入会话，版本号放在只有服务端能读的 secure 部分 */
export function startUserSession(
  event: H3Event,
  row: { id: number; name: string; email: string; role: 'admin' | 'user'; sessionVersion: number },
) {
  const user = { id: row.id, name: row.name, email: row.email, role: row.role }
  return setUserSession(event, { user, secure: { sessionVersion: row.sessionVersion } }).then(() => user)
}
