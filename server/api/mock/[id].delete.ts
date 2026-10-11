import { eq } from 'drizzle-orm'

/** 删除一场模拟面试；每道题的面试记录保留在题目页的历史里 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const row = await getMockSession(user.id, idParam(event))
  await useDb().delete(tables.mockSessions).where(eq(tables.mockSessions.id, row.id))
  return { ok: true }
})
