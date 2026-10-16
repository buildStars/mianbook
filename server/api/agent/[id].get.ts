import type { AgentSessionDetail } from '#shared/types/agent'

export default defineEventHandler(async (event): Promise<AgentSessionDetail> => {
  const { user } = await requireUserSession(event)
  return agentDetail(await getAgentSession(user.id, idParam(event)))
})
