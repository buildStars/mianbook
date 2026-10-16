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
  const { target, remaining } = await resolveAi(event, user.id)

  const stream = createEventStream(event)
  const controller = new AbortController()
  stream.onClosed(() => controller.abort())
  const send = (name: string, data: unknown) => stream.push({ event: name, data: JSON.stringify(data) })

  ;(async () => {
    let produced = false
    let usage: ChatUsage | undefined
    let failure: unknown
    const call = startAiCall(user.id, 'agent', target)
    try {
      const result = await runAgentTurn({
        row: { ...row, state: turn.state },
        userMessage: turn.userMessage,
        pendingAnswer: turn.pendingAnswer,
        target,
        signal: controller.signal,
        // 第一段文字或第一个工具调用就算首字
        emit: (name, data) => {
          if (name === 'delta' || name === 'tool_start') {
            produced = true
            call.firstToken()
          }
          return send(name, data)
        },
      })
      usage = result.usage
      await send('done', { finished: result.finished, truncated: result.truncated, remaining })
    } catch (error) {
      failure = error
      if (!controller.signal.aborted) {
        const message = error instanceof Error && 'statusCode' in error ? error.message : describeAiError(error, target)
        await send('error', { message })
      }
    } finally {
      // 一轮里不管调了几次模型，都只记一次；还没调用模型就被拒绝的（比如上一轮还没结束）不记
      const rejected = !produced && failure instanceof Error && 'statusCode' in failure
      if (!rejected) await call.finish({ usage, error: failure, aborted: controller.signal.aborted, produced })
      await stream.close()
    }
  })()

  return stream.send()
})
