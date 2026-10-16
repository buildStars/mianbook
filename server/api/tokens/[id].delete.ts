import { and, eq } from 'drizzle-orm'

/** 撤销访问令牌：直接删除，用这个令牌的客户端立刻失效 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const t = tables.apiTokens
  const [result] = await useDb()
    .delete(t)
    .where(and(eq(t.id, idParam(event)), eq(t.userId, user.id)))
  if (!result.affectedRows) throw createError({ statusCode: 404, message: '令牌不存在' })
  return { ok: true }
})
