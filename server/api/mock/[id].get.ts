import type { MockSessionDetail } from '#shared/types/handbook'

export default defineEventHandler(async (event): Promise<MockSessionDetail> => {
  const { user } = await requireUserSession(event)
  return sessionDetail(await getMockSession(user.id, idParam(event)))
})
