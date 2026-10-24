import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({ status: z.enum(FEEDBACK_STATUSES) })

/** 标记反馈：已处理、忽略，或者重新打开 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = idParam(event)
  const { status } = await readValidated(event, schema)
  const t = tables.questionFeedback
  const [result] = await useDb()
    .update(t)
    .set({ status, handledAt: status === 'open' ? null : new Date() })
    .where(eq(t.id, id))
  if (!result.affectedRows) throw createError({ statusCode: 404, message: '这条反馈不存在' })
  return { ok: true }
})
