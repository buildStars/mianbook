import { desc, eq } from 'drizzle-orm'
import type { MockSessionSummary } from '#shared/types/handbook'

/** 最近的整场模拟面试 */
export default defineEventHandler(async (event): Promise<MockSessionSummary[]> => {
  const { user } = await requireUserSession(event)
  const rows = await useDb()
    .select()
    .from(tables.mockSessions)
    .where(eq(tables.mockSessions.userId, user.id))
    .orderBy(desc(tables.mockSessions.createdAt), desc(tables.mockSessions.id))
    .limit(30)
  return rows.map(toSummary)
})
