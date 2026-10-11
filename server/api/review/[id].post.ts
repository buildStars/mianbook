import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { ReviewGrade } from '#shared/types/handbook'

const schema = z.object({ grade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]) })

/** 复习页上给一道题评分：重新安排下次复习时间，同时把掌握程度同步成对应的状态 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const questionId = idParam(event)
  const { grade } = await readValidated(event, schema)

  const [question] = await useDb()
    .select({ id: tables.questions.id })
    .from(tables.questions)
    .where(eq(tables.questions.id, questionId))
  if (!question) throw createError({ statusCode: 404, message: '题目不存在' })

  const card = await reviewQuestion(user.id, questionId, grade as ReviewGrade, 'review')
  const current = await getStudyRecord(user.id, questionId)
  const record = await saveStudyRecord(user.id, questionId, {
    status: statusFromGrade(grade as ReviewGrade),
    starred: current?.starred ?? false,
    note: current?.note ?? null,
  })
  return { due: card.due.toISOString(), record }
})
