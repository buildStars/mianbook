import { z } from 'zod'
import type { WeeklyReport } from '#shared/types/handbook'

const schema = z.object({
  tz: z.coerce.number().int().min(-840).max(840).default(0),
  /** 0 本周，-1 上周……最多往回看一年 */
  offset: z.coerce.number().int().min(-52).max(0).default(0),
})

export default defineEventHandler(async (event): Promise<WeeklyReport> => {
  const { user } = await requireUserSession(event)
  const { tz, offset } = queryValidated(event, schema)
  return buildWeeklyReport(user.id, tz, offset)
})
