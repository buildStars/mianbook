import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'

/** 会话里的角色可能过期（比如被降级），管理接口以数据库为准 */
export async function requireAdmin(event: H3Event) {
  const { user } = await requireUserSession(event)
  const [row] = await useDb()
    .select({ role: tables.users.role })
    .from(tables.users)
    .where(eq(tables.users.id, user.id))
  if (row?.role !== 'admin') throw createError({ statusCode: 403, message: '需要管理员权限' })
  return user
}
