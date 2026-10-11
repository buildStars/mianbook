import { z } from 'zod'
import type { MockConfig, MockItem } from '#shared/types/handbook'
import { MOCK_MAX_FOLLOW_UPS } from '#shared/utils/mock-tracks'

const schema = z.object({
  track: z.string().max(32),
  categoryIds: z.array(z.number().int().positive()).max(50).default([]),
  difficulty: z.enum(['basic', 'advanced', 'deep', 'mixed']),
  count: z.number().int().min(3).max(15),
  followUps: z.number().int().min(0).max(MOCK_MAX_FOLLOW_UPS),
  preferWeak: z.boolean().default(true),
})

/** 开始一场模拟面试：按方向和难度抽题 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidated(event, schema)

  const preset = body.track === 'custom' ? null : await trackCategoryIds(body.track)
  const categoryIds = preset ? preset.ids : body.categoryIds
  if (!categoryIds.length) throw createError({ statusCode: 400, message: '请至少选择一个分类' })

  const config: MockConfig = { ...body, categoryIds }
  const questionIds = await pickQuestions(user.id, config, preset?.focus ?? [])
  if (!questionIds.length) throw createError({ statusCode: 400, message: '选中的分类里没有题目' })

  const items: MockItem[] = questionIds.map((questionId) => ({ questionId, interviewId: null, scores: [], skipped: false, done: false }))
  const [created] = await useDb()
    .insert(tables.mockSessions)
    .values({ userId: user.id, title: sessionTitle({ ...config, count: items.length }), config: { ...config, count: items.length }, items })
    .$returningId()
  return { id: created!.id }
})
