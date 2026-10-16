import { eq } from 'drizzle-orm'
import type { ChatUsage } from '../../../utils/ai'

/**
 * 面试结束后生成 AI 总结，以 SSE 流式返回。
 * 只把题目、得分和当时点评里指出的问题交给模型，不再发送候选人的原始回答
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const row = await getMockSession(user.id, idParam(event))
  if (row.status !== 'finished') throw createError({ statusCode: 400, message: '面试结束后才能生成总结' })
  if (!row.items.some((i) => i.done)) throw createError({ statusCode: 400, message: '这场面试没有作答的题，无法生成总结' })

  const { target, remaining } = await resolveAi(event, user.id)
  const detail = await sessionDetail(row)
  const messages = buildReportMessages({
    track: detail.title,
    items: detail.items.map((item) => ({
      title: plainQuestionTitle(item.question.title),
      category: item.question.category,
      skipped: item.skipped,
      scores: item.scores,
      feedbacks: item.turns.map((t) => t.feedback),
    })),
  })

  const stream = createEventStream(event)
  const controller = new AbortController()
  stream.onClosed(() => controller.abort())
  const send = (name: string, data: unknown) => stream.push({ event: name, data: JSON.stringify(data) })

  ;(async () => {
    let text = ''
    let usage: ChatUsage | undefined
    let failure: unknown
    const call = startAiCall(user.id, 'report', target)
    try {
      for await (const part of streamChat(target, messages, controller.signal)) {
        if (part.delta) {
          call.firstToken()
          text += part.delta
          await send('delta', { text: part.delta })
        }
        if (part.usage) usage = part.usage
      }
      if (!text.trim()) throw new AiError(502, 'AI 没有返回内容，请重试')
      await useDb().update(tables.mockSessions).set({ report: text }).where(eq(tables.mockSessions.id, row.id))
      await send('done', { remaining })
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

const plainQuestionTitle = (title: string) => title.replace(/`/g, '')
