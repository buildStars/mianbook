import crypto from 'node:crypto'
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import type { H3Event } from 'h3'

/** 个人访问令牌：mbk_ 加 40 个 base64url 字符（240 位随机数），带前缀方便识别和扫描泄露 */
export const API_TOKEN_PREFIX = 'mbk_'
const TOKEN_PATTERN = /^mbk_[\w-]{40}$/

export function generateApiToken() {
  const token = API_TOKEN_PREFIX + crypto.randomBytes(30).toString('base64url')
  return { token, hash: hashApiToken(token), prefix: token.slice(0, 12) }
}

/** 令牌本身是高熵随机数，用 SHA-256 存储即可，不需要 bcrypt 这类慢哈希 */
export const hashApiToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex')

/** 从 Authorization: Bearer 里取令牌；格式不对返回 null */
export function bearerToken(header: string | undefined): string | null {
  const token = header?.match(/^Bearer\s+(\S+)\s*$/i)?.[1]
  return token && TOKEN_PATTERN.test(token) ? token : null
}

/** 令牌无效：HTTP 层返回 401 */
export class TokenError extends Error {}

export interface TokenOwner {
  tokenId: number
  scope: 'read' | 'write'
  user: { id: number; name: string; email: string }
}

// 最近一次写 last_used_at 的时间：每个令牌一分钟最多写一次，不用每个请求都更新数据库
const touched = new Map<number, number>()

/** 校验请求里的令牌：不存在、已过期（或已撤销，撤销即删除）都返回 401 */
export async function authenticateApiToken(event: H3Event): Promise<TokenOwner> {
  const token = bearerToken(getHeader(event, 'authorization'))
  if (!token) throw new TokenError('缺少访问令牌：请在请求头里带上 Authorization: Bearer mbk_…')
  const t = tables.apiTokens
  const now = new Date()
  const [row] = await useDb()
    .select({
      id: t.id,
      scope: t.scope,
      userId: tables.users.id,
      name: tables.users.name,
      email: tables.users.email,
      disabledAt: tables.users.disabledAt,
    })
    .from(t)
    .innerJoin(tables.users, eq(tables.users.id, t.userId))
    .where(and(eq(t.tokenHash, hashApiToken(token)), or(isNull(t.expiresAt), gt(t.expiresAt, now))))
  if (!row) throw new TokenError('访问令牌无效、已过期或已被撤销，请在网站的"接入 AI 工具"页面重新创建')
  // 令牌不删，账号重新启用后还能接着用
  if (row.disabledAt) throw new TokenError('这个账号已被管理员停用，访问令牌暂时不能使用')

  if (now.getTime() - (touched.get(row.id) ?? 0) > 60_000) {
    touched.set(row.id, now.getTime())
    useDb()
      .update(t)
      .set({ lastUsedAt: now })
      .where(eq(t.id, row.id))
      .catch(() => {})
  }
  return { tokenId: row.id, scope: row.scope, user: { id: row.userId, name: row.name, email: row.email } }
}

/** 每个令牌每分钟最多 limit 次请求（固定窗口，单实例部署够用；多实例时换成 Redis） */
const windows = new Map<number, { start: number; count: number }>()

export function tokenRateLimited(tokenId: number, limit = 60, now = Date.now()): boolean {
  const w = windows.get(tokenId)
  if (!w || now - w.start >= 60_000) {
    windows.set(tokenId, { start: now, count: 1 })
    // 顺手清理过期的窗口，Map 不会无限增长
    if (windows.size > 10_000) for (const [id, v] of windows) if (now - v.start >= 60_000) windows.delete(id)
    return false
  }
  w.count++
  return w.count > limit
}

export function toTokenView(row: typeof tables.apiTokens.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scope: row.scope,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  }
}
