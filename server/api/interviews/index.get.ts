import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { InterviewSummary } from '#shared/types/handbook'

const schema = z.object({ questionId: z.coerce.number().int().positive() })

/** 当前用户在某道题上的面试记录，最近的在前 */
export default defineEventHandler(async (event): Promise<InterviewSummary[]> => {
  const { user } = await requireUserSession(event)
  const { questionId } = queryValidated(event, schema)
  const rows = await useDb()
    .select()
    .from(tables.interviews)
    .where(and(eq(tables.interviews.userId, user.id), eq(tables.interviews.questionId, questionId)))
    .orderBy(desc(tables.interviews.updatedAt), desc(tables.interviews.id))
    .limit(10)
  return rows.map((r) => ({
    id: r.id,
    rounds: r.rounds,
    score: r.score,
    turns: r.turns,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }))
})
