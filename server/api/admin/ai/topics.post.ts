import { z } from 'zod'

const schema = z.object({
  categoryId: z.number().int().positive('请先选择分类'),
  count: z.number().int().min(3).max(12).default(8),
  /** 想补充的方向，可选 */
  hint: z.string().trim().max(500).optional(),
})

/** 让 AI 推荐这个分类还缺的题目 */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const body = await readValidated(event, schema)
  const ai = authorTarget(event)
  const context = await authoringContext(body.categoryId)

  let text: string
  try {
    const result = await chatOnce(ai.target, buildTopicMessages({ context, count: body.count, hint: body.hint }), { maxTokens: 1500 })
    text = result.text
    await recordAiCall(admin.id, 'author', ai.ownKey, result.usage)
  } catch (error) {
    throw createError({ statusCode: 502, message: describeAiError(error, ai.target) })
  }

  const existing = context.siblings.map((s) => s.title)
  const suggestions = parseTopicSuggestions(text, existing, body.count)
  if (!suggestions.length) throw createError({ statusCode: 502, message: 'AI 没有按格式给出选题，请重试一次' })
  return { suggestions }
})
