import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'

/** 会话里的角色可能过期（比如刚被提升或降级），判断管理员以数据库为准 */
export async function isAdminUser(userId: number): Promise<boolean> {
  const [row] = await useDb()
    .select({ role: tables.users.role })
    .from(tables.users)
    .where(eq(tables.users.id, userId))
  return row?.role === 'admin'
}

export async function requireAdmin(event: H3Event) {
  const { user } = await requireUserSession(event)
  if (!(await isAdminUser(user.id))) throw createError({ statusCode: 403, message: '需要管理员权限' })
  return user
}
