import { and, desc, eq, lt } from 'drizzle-orm'
import { z } from 'zod'
import type { CategoryInsight } from '#shared/types/handbook'

const schema = z.object({ tz: z.coerce.number().int().min(-840).max(840).default(0) })

/** 按分类汇总 AI 面试得分和到期复习数，用于进度页的薄弱点分析；掌握程度由前端按学习记录统计 */
export default defineEventHandler(async (event): Promise<Record<number, CategoryInsight>> => {
  const { user } = await requireUserSession(event)
  const { tz } = queryValidated(event, schema)
  const db = useDb()

  const [outline, interviews, dueRows] = await Promise.all([
    getOutline(),
    db
      .select({ questionId: tables.interviews.questionId, turns: tables.interviews.turns })
      .from(tables.interviews)
      .where(eq(tables.interviews.userId, user.id))
      .orderBy(desc(tables.interviews.updatedAt), desc(tables.interviews.id)),
    db
      .select({ questionId: tables.reviewCards.questionId })
      .from(tables.reviewCards)
      .where(and(eq(tables.reviewCards.userId, user.id), lt(tables.reviewCards.due, endOfLocalDay(tz)))),
  ])

  const categoryOf = new Map<number, number>()
  for (const part of outline) for (const cat of part.categories) for (const q of cat.questions) categoryOf.set(q.id, cat.id)

  // 每道题只取最近一次面试的第一轮得分：它反映"现在会不会这道题"
  const latest = new Map<number, number>()
  for (const row of interviews) {
    const score = row.turns[0]?.score
    if (!latest.has(row.questionId) && typeof score === 'number') latest.set(row.questionId, score)
  }

  const result: Record<number, CategoryInsight> = {}
  const ensure = (catId: number) => (result[catId] ??= { avgScore: null, interviewed: 0, due: 0 })
  const sums = new Map<number, number>()
  for (const [questionId, score] of latest) {
    const catId = categoryOf.get(questionId)
    if (!catId) continue
    const r = ensure(catId)
    r.interviewed++
    sums.set(catId, (sums.get(catId) ?? 0) + score)
  }
  for (const [catId, sum] of sums) result[catId]!.avgScore = Math.round((sum / result[catId]!.interviewed) * 10) / 10
  for (const { questionId } of dueRows) {
    const catId = categoryOf.get(questionId)
    if (catId) ensure(catId).due++
  }
  return result
})
