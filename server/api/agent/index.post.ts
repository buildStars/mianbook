import { z } from 'zod'

const schema = z.object({
  goal: z.string().trim().min(4, '请写一下面试目标，比如岗位和重点').max(500, '面试目标最多 500 字'),
  maxQuestions: z.number().int().min(2).max(10).default(5),
})

/** 新建一场 Agent 面试：只存目标，第一轮（出第一题）由页面接着调用 turn 接口开始 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidated(event, schema)
  const [created] = await useDb()
    .insert(tables.agentSessions)
    .values({
      userId: user.id,
      goal: body.goal,
      maxQuestions: body.maxQuestions,
      messages: [{ role: 'user', content: goalMessage(body.goal, body.maxQuestions) }],
      state: { asked: [], current: null, summary: null },
    })
    .$returningId()
  return { id: created!.id }
})
