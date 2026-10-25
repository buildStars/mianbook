import { z } from 'zod'
import type { PracticeReviewDoneEvent } from '#shared/types/practice'
import type { ChatUsage } from '../../utils/ai'

const schema = z.object({
  /** 练习对应的题目路径 */
  path: z.string().max(200),
  code: z.string().trim().min(1, '还没写代码').max(8000, '代码太长了（最多 8000 字）'),
  passed: z.number().int().min(0).max(100),
  total: z.number().int().min(0).max(100),
  failures: z
    .array(z.object({ name: z.string().max(200), message: z.string().max(500) }))
    .max(20)
    .default([]),
})

/**
 * 默写练习的 AI 点评：对照要求、参考答案和测试结果点评用户手写的代码，占一次 AI 次数。
 * SSE 事件：delta（点评片段）、done（剩余次数）、error
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidated(event, schema)
  const [spec, practice] = await Promise.all([practiceSpec(body.path), getPractice(body.path)])
  if (!spec || !practice) throw createError({ statusCode: 404, message: '这道题还没有默写练习' })
  const { target, remaining } = await resolveAi(event, user.id)

  const stream = createEventStream(event)
  const controller = new AbortController()
  stream.onClosed(() => controller.abort())
  const send = (name: string, data: unknown) => stream.push({ event: name, data: JSON.stringify(data) })

  ;(async () => {
    let text = ''
    let usage: ChatUsage | undefined
    let failure: unknown
    const call = startAiCall(user.id, 'practice', target)
    try {
      const messages = buildPracticeReviewMessages({
        title: practice.title,
        task: spec.task,
        solution: spec.solution,
        code: body.code,
        passed: body.passed,
        total: body.total,
        failures: body.failures,
      })
      for await (const part of streamChat(target, messages, controller.signal, { maxTokens: 900 })) {
        if (part.delta) {
          call.firstToken()
          text += part.delta
          await send('delta', { text: part.delta })
        }
        if (part.usage) usage = part.usage
      }
      if (!text.trim()) throw new AiError(502, 'AI 没有返回内容，请重试')
      await send('done', { remaining } satisfies PracticeReviewDoneEvent)
    } catch (error) {
      failure = error
      if (!controller.signal.aborted) await send('error', { message: describeAiError(error, target) })
    } finally {
      await call.finish({ usage, error: failure, aborted: controller.signal.aborted, produced: Boolean(text) })
      await stream.close()
    }
  })()

  return stream.send()
})
