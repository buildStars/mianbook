import { z } from 'zod'
import type { ReviewSummary } from '#shared/types/handbook'

const schema = z.object({ tz: z.coerce.number().int().min(-840).max(840).default(0) })

/** 复习概况：今天要复习几道、已复习几道、连续天数、未来 7 天的到期分布 */
export default defineEventHandler(async (event): Promise<ReviewSummary> => {
  const { user } = await requireUserSession(event)
  const { tz } = queryValidated(event, schema)
  return reviewSummary(user.id, tz)
})
