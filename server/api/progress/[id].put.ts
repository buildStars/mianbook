import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  status: z.enum(['weak', 'fuzzy', 'mastered']).nullable().optional(),
  starred: z.boolean().optional(),
  note: z.string().max(5000, '笔记最多 5000 字').nullable().optional(),
})

/** 只更新传入的字段 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const questionId = idParam(event)
  const body = await readValidated(event, schema)

  const [question] = await useDb()
    .select({ id: tables.questions.id })
    .from(tables.questions)
    .where(eq(tables.questions.id, questionId))
  if (!question) throw createError({ statusCode: 404, message: '题目不存在' })

  const current = await getStudyRecord(user.id, questionId)
  // 手动标记掌握程度也算一次复习，加入或更新复习计划；清除标记不影响已有的计划
  if (body.status && body.status !== current?.status) {
    await reviewQuestion(user.id, questionId, gradeFromStatus[body.status], 'page')
  }
  return saveStudyRecord(user.id, questionId, {
    status: body.status !== undefined ? body.status : (current?.status ?? null),
    starred: body.starred ?? current?.starred ?? false,
    note: body.note !== undefined ? body.note : (current?.note ?? null),
  })
})
