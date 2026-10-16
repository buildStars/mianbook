import { eq } from 'drizzle-orm'

/** 删除一场 Agent 面试；已经写进复习计划的得分不受影响 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const row = await getAgentSession(user.id, idParam(event))
  await useDb().delete(tables.agentSessions).where(eq(tables.agentSessions.id, row.id))
  return { ok: true }
})
