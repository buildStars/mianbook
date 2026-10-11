import { z } from 'zod'

const schema = z.object({
  categoryId: z.number().int().positive('请先选择分类'),
  title: z.string().trim().min(2, '请先填写题目').max(255),
  difficulty: z.number().int().min(1).max(3),
  /** 希望覆盖的要点，可选 */
  notes: z.string().trim().max(2000).optional(),
  /** 编辑已有题目时传，参考题和已有题目列表里排除它自己 */
  questionId: z.number().int().positive().optional(),
})

/** 后台 AI 起草题目正文，按写作规范和同分类的题目生成，SSE 流式返回 */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const body = await readValidated(event, schema)
  const ai = authorTarget(event)
  const [guide, context] = await Promise.all([loadWritingGuide(), authoringContext(body.categoryId, body.questionId)])
  const messages = buildDraftMessages({
    guide,
    question: { title: body.title, difficulty: body.difficulty },
    context,
    notes: body.notes,
    example: context.example,
  })
  return streamAuthoring(event, admin.id, ai, messages)
})
