import { z } from 'zod'
import type { ReviseRequest } from '../../../utils/authoring'

const common = {
  categoryId: z.number().int().positive('请先选择分类'),
  title: z.string().trim().min(2, '请先填写题目').max(255),
  difficulty: z.number().int().min(1).max(3),
  contentMd: z.string().trim().min(1, '正文是空的').max(200_000),
  questionId: z.number().int().positive().optional(),
}

const schema = z.discriminatedUnion('mode', [
  /** 修复格式检查发现的问题 */
  z.object({ ...common, mode: z.literal('lint'), issues: z.array(z.string().trim().min(1).max(300)).min(1, '没有需要修复的问题').max(50) }),
  /** 参考这道题的 AI 面试点评，补上候选人普遍答不好的地方 */
  z.object({ ...common, mode: z.literal('feedback'), questionId: z.number().int().positive('保存后才能参考面试反馈') }),
  /** 按管理员写的要求修改 */
  z.object({ ...common, mode: z.literal('custom'), instruction: z.string().trim().min(2, '请写下修改要求').max(2000) }),
])

/** 后台 AI 改写题目正文，返回修改后的完整正文（SSE 流式），由浏览器对比后决定是否采用 */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const body = await readValidated(event, schema)

  let request: ReviseRequest
  if (body.mode === 'lint') request = { mode: 'lint', issues: body.issues }
  else if (body.mode === 'custom') request = { mode: 'custom', instruction: body.instruction }
  else {
    const feedback = await interviewFeedback(body.questionId)
    if (!feedback.length) throw createError({ statusCode: 400, message: '这道题还没有 AI 面试记录，没有反馈可以参考' })
    request = { mode: 'feedback', feedback }
  }

  const ai = authorTarget(event)
  const [guide, context] = await Promise.all([loadWritingGuide(), authoringContext(body.categoryId, body.questionId)])
  const messages = buildReviseMessages({
    guide,
    question: { title: body.title, difficulty: body.difficulty },
    context,
    content: body.contentMd,
    request,
  })
  return streamAuthoring(event, admin.id, ai, messages)
})
