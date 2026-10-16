import { z } from 'zod'
import type { MockConfig, MockItem } from '#shared/types/handbook'
import { MOCK_MAX_FOLLOW_UPS } from '#shared/utils/mock-tracks'

const schema = z.object({
  resume: z.string().trim().min(50, '简历或项目描述至少写 50 个字').max(8000, '简历最多 8000 字，可以只保留项目经历部分'),
  role: z.string().trim().max(60).default(''),
  /** 项目深挖题几道 */
  projectCount: z.number().int().min(2).max(8),
  /** 再从题库相关分类里抽几道基础题 */
  bankCount: z.number().int().min(0).max(6),
  followUps: z.number().int().min(0).max(MOCK_MAX_FOLLOW_UPS),
})

/**
 * 按简历出题：AI 读简历生成项目深挖题，并识别技术栈，从题库相关分类里补几道基础题。
 * 简历原文只用于这一次出题，不写进数据库
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidated(event, schema)
  const { target } = await resolveAi(event, user.id)

  const outline = await getOutline()
  const categories = outline.flatMap((p) => p.categories.map((c) => ({ key: `${p.slug}/${c.slug}`, title: c.title, id: c.id })))

  let parsed: ReturnType<typeof parseResumeQuestions> = null
  const call = startAiCall(user.id, 'resume', target)
  try {
    const result = await chatOnce(
      target,
      buildResumeMessages({ resume: body.resume, role: body.role, count: body.projectCount, categories }),
      { maxTokens: 3000 },
    )
    parsed = parseResumeQuestions(result.text)
    await call.finish({ usage: result.usage, produced: true, error: parsed ? undefined : new AiError(502, '没有按格式出题') })
  } catch (error) {
    await call.finish({ error, produced: false })
    throw createError({ statusCode: 502, message: describeAiError(error, target) })
  }
  if (!parsed) throw createError({ statusCode: 502, message: 'AI 没有按格式出题，请重试一次' })

  const projectItems: MockItem[] = parsed.questions.slice(0, body.projectCount).map((q) => ({
    questionId: null,
    custom: q,
    turns: [],
    interviewId: null,
    scores: [],
    skipped: false,
    done: false,
  }))

  // 简历里识别出的技术栈对应的分类，再从题库抽基础题
  const categoryIds = parsed.categories
    .map((key) => categories.find((c) => c.key === key)?.id)
    .filter((id): id is number => id !== undefined)
    .slice(0, 6)
  let bankIds: number[] = []
  if (body.bankCount && categoryIds.length) {
    bankIds = await pickQuestions(user.id, {
      track: 'resume',
      categoryIds,
      difficulty: 'mixed',
      count: body.bankCount,
      followUps: body.followUps,
      preferWeak: true,
    })
  }
  const bankItems: MockItem[] = bankIds.map((questionId) => ({ questionId, interviewId: null, scores: [], skipped: false, done: false }))

  // 真实面试一般先聊项目，再问基础
  const items = [...projectItems, ...bankItems]
  const config: MockConfig = {
    mode: 'resume',
    track: 'resume',
    categoryIds,
    difficulty: 'mixed',
    count: items.length,
    followUps: body.followUps,
    preferWeak: true,
    role: body.role,
  }
  const [created] = await useDb()
    .insert(tables.mockSessions)
    .values({ userId: user.id, title: sessionTitle(config), config, items })
    .$returningId()
  return { id: created!.id, projectCount: projectItems.length, bankCount: bankItems.length }
})
