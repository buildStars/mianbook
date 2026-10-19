import { and, eq } from 'drizzle-orm'

/** 撤销用户的一个访问令牌（直接删除），用这个令牌的 MCP 客户端马上不能再用 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = idParam(event)
  const tokenId = idParam(event, 'tokenId')
  const [result] = await useDb()
    .delete(tables.apiTokens)
    .where(and(eq(tables.apiTokens.id, tokenId), eq(tables.apiTokens.userId, id)))
  if (!result.affectedRows) throw createError({ statusCode: 404, message: '令牌不存在或已被撤销' })
  return { ok: true }
})
