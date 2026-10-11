import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import type { ReviewItem } from '#shared/types/handbook'

const schema = z.object({
  tz: z.coerce.number().int().min(-840).max(840).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

/** 从正文 HTML 里取出"一句话回答"的内容（不含标题） */
function answerOf(html: string): string {
  const block = html.match(/<div class="tip custom-block answer">([\s\S]*?)<\/div>/)?.[1] ?? ''
  return block.replace(/<p class="custom-block-title">[\s\S]*?<\/p>/, '').trim()
}

/** 今天要复习的题，逾期最久的在前 */
export default defineEventHandler(async (event): Promise<ReviewItem[]> => {
  const { user } = await requireUserSession(event)
  const { tz, limit } = queryValidated(event, schema)

  const cards = await dueCards(user.id, tz, limit)
  if (!cards.length) return []
  const ids = cards.map((c) => c.questionId)

  const db = useDb()
  const [contents, records, outline] = await Promise.all([
    db
      .select({ id: tables.questions.id, html: tables.questions.contentHtml })
      .from(tables.questions)
      .where(inArray(tables.questions.id, ids)),
    db
      .select({ questionId: tables.studyRecords.questionId, status: tables.studyRecords.status })
      .from(tables.studyRecords)
      .where(and(eq(tables.studyRecords.userId, user.id), inArray(tables.studyRecords.questionId, ids))),
    getOutline(),
  ])
  const htmlById = new Map(contents.map((c) => [c.id, c.html]))
  const statusById = new Map(records.map((r) => [r.questionId, r.status]))
  const meta = new Map<number, { num: number; title: string; path: string; category: string; difficulty: number }>()
  for (const part of outline)
    for (const cat of part.categories)
      for (const q of cat.questions) meta.set(q.id, { num: q.num, title: q.title, path: q.path, category: cat.title, difficulty: q.difficulty })

  const now = new Date()
  return cards.flatMap((row) => {
    const q = meta.get(row.questionId)
    if (!q) return [] // 题目已下线
    const card = rowToCard(row)
    return [
      {
        id: row.questionId,
        ...q,
        status: statusById.get(row.questionId) ?? null,
        due: row.due.toISOString(),
        reps: row.reps,
        lapses: row.lapses,
        answerHtml: answerOf(htmlById.get(row.questionId) ?? ''),
        intervals: previewIntervals(card, now),
      },
    ]
  })
})
