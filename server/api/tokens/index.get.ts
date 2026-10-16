import { desc, eq } from 'drizzle-orm'
import type { ApiTokenView } from '#shared/types/token'

/** 我的访问令牌（不含令牌本身） */
export default defineEventHandler(async (event): Promise<ApiTokenView[]> => {
  const { user } = await requireUserSession(event)
  const t = tables.apiTokens
  const rows = await useDb().select().from(t).where(eq(t.userId, user.id)).orderBy(desc(t.id))
  return rows.map(toTokenView)
})
