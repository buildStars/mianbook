import { z } from 'zod'
import type { ChatUsage } from '../../../utils/ai'

const schema = z.object({
  action: z.enum(['start', 'answer', 'skip', 'finish']),
  answer: z.string().trim().min(2, '回答太短了').max(3000, '回答最多 3000 字').optional(),
})

/**
 * Agent 面试的一轮：开始、回答、跳过或要求结束。模型在这一轮里可以连续调用工具，SSE 事件：
 * delta（文字片段）、tool_start / tool_end（工具调用开始和结果）、done（这一轮结束）、error
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const id = idParam(event)
  const body = await readValidated(event, schema)
  const row = await getAgentSession(user.id, id)
  const turn = turnMessage(row, body)
  const { target, ownKey, remaining } = await resolveAi(event, user.id)

  const stream = createEventStream(event)
  const controller = new AbortController()
  stream.onClosed(() => controller.abort())
  const send = (name: string, data: unknown) => stream.push({ event: name, data: JSON.stringify(data) })

  ;(async () => {
    let produced = false
    let usage: ChatUsage | undefined
    try {
      const result = await runAgentTurn({
        row: { ...row, state: turn.state },
        userMessage: turn.userMessage,
        pendingAnswer: turn.pendingAnswer,
        target,
        signal: controller.signal,
        emit: send,
      })
      produced = result.produced
      usage = result.usage
      await send('done', { finished: result.finished, truncated: result.truncated, remaining })
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error && 'statusCode' in error ? error.message : describeAiError(error, target)
        await send('error', { message })
      }
    } finally {
      // 一轮里不管调了几次模型，都只算一次
      if (produced) await recordAiCall(user.id, 'agent', ownKey, usage)
      await stream.close()
    }
  })()

  return stream.send()
})
