import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  questionId: z.number().int().positive(),
  kind: z.enum(FEEDBACK_KINDS),
  content: z
    .string()
    .trim()
    .min(FEEDBACK_MIN_LENGTH, `至少写 ${FEEDBACK_MIN_LENGTH} 个字，说说哪里有问题`)
    .max(FEEDBACK_MAX_LENGTH, `最多 ${FEEDBACK_MAX_LENGTH} 个字`),
  /** 给机器人填的隐藏字段，有值就当作提交成功但不保存 */
  website: z.string().optional(),
})

/** 题目纠错和反馈：没登录也能提交，按 IP 限频；登录时记下用户 */
export default defineEventHandler(async (event) => {
  const body = await readValidated(event, schema)
  if (body.website) return { ok: true }

  const db = useDb()
  const [question] = await db
    .select({ id: tables.questions.id })
    .from(tables.questions)
    .where(and(eq(tables.questions.id, body.questionId), eq(tables.questions.status, 'published')))
  if (!question) throw createError({ statusCode: 404, message: '题目不存在或还没有发布' })

  const ipHash = feedbackIpHash(event)
  await checkFeedbackRate(ipHash)
  const session = await getUserSession(event)
  await db.insert(tables.questionFeedback).values({
    questionId: question.id,
    userId: session.user?.id ?? null,
    kind: body.kind,
    content: body.content,
    ipHash,
  })
  return { ok: true }
})
