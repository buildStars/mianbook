import { eq } from 'drizzle-orm'

/** 删除题目，相关的学习记录和面试记录会被级联删除 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = idParam(event)
  const [result] = await useDb().delete(tables.questions).where(eq(tables.questions.id, id))
  if (!result.affectedRows) throw createError({ statusCode: 404, message: '题目不存在' })
  invalidateContent()
  return { ok: true }
})
