import { desc, eq } from 'drizzle-orm'
import type { AgentSessionSummary } from '#shared/types/agent'

/** 最近的 Agent 面试 */
export default defineEventHandler(async (event): Promise<AgentSessionSummary[]> => {
  const { user } = await requireUserSession(event)
  const rows = await useDb()
    .select()
    .from(tables.agentSessions)
    .where(eq(tables.agentSessions.userId, user.id))
    .orderBy(desc(tables.agentSessions.id))
    .limit(20)
  return rows.map(agentSummary)
})
