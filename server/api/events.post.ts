import { z } from 'zod'

const MAX_SECONDS = 30 * 60
/** 只记次数、不带秒数的事件 */
const COUNT_ONLY = new Set(['reveal', 'code_run', 'practice_pass'])

const schema = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(['read', 'reveal', 'voice', 'code_run', 'practice_pass']),
        questionId: z.number().int().positive().optional(),
        /** read、voice 的秒数；单条最多记 30 分钟，挂着不动的时间前端已经扣掉 */
        value: z.number().int().min(1).max(MAX_SECONDS).optional(),
      }),
    )
    .min(1)
    .max(50),
})

/**
 * 批量记录学习事件，浏览器在离开页面时用 sendBeacon 发送。
 * 只记登录用户；题目不存在的事件直接丢掉
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const { events } = await readValidated(event, schema)

  const outline = await getOutline()
  const ids = new Set(outline.flatMap((p) => p.categories.flatMap((c) => c.questions.map((q) => q.id))))
  const rows = events
    .filter((e) => (e.type === 'voice' ? true : e.questionId !== undefined && ids.has(e.questionId)))
    .filter((e) => COUNT_ONLY.has(e.type) || e.value !== undefined)
    .map((e) => ({
      userId: user.id,
      type: e.type,
      questionId: e.questionId !== undefined && ids.has(e.questionId) ? e.questionId : null,
      value: COUNT_ONLY.has(e.type) ? null : e.value!,
    }))
  if (rows.length) await useDb().insert(tables.events).values(rows)
  return { saved: rows.length }
})
