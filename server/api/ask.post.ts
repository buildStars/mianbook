import { z } from 'zod'
import type { AskDoneEvent, AskSourcesEvent } from '#shared/types/ask'
import type { ChatUsage } from '../utils/ai'

const schema = z.object({
  question: z.string().trim().min(2, '问题太短了').max(500, '问题最多 500 字'),
  /** 同一个对话里之前的问答，只保存在浏览器里 */
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(6000) }))
    .max(12)
    .default([]),
})

const NO_HIT = '手册里没有找到和这个问题相关的内容。可以换个说法，或者用更具体的关键词再问一次。'

/**
 * 问手册：检索手册里相关的段落，让大模型根据这些段落回答并标注出处。SSE 事件：
 * sources（检索到的资料，先发，页面可以马上显示）、delta（回答片段）、done（引用的编号、剩余次数）、error
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidated(event, schema)
  const { target, remaining } = await resolveAi(event, user.id)

  const found = await searchHandbook(retrievalQuery(body.question, body.history), { limit: 6, perQuestion: 2 })
  const sources = found.hits.map((h, i) => ({
    n: i + 1,
    questionId: h.chunk.questionId,
    title: h.chunk.title,
    path: h.chunk.path,
    category: h.chunk.category,
    heading: h.chunk.heading,
    snippet: h.chunk.text.slice(0, 140),
  }))

  const stream = createEventStream(event)
  const controller = new AbortController()
  stream.onClosed(() => controller.abort())
  const send = (name: string, data: unknown) => stream.push({ event: name, data: JSON.stringify(data) })

  ;(async () => {
    let text = ''
    let usage: ChatUsage | undefined
    let failure: unknown
    // 没检索到资料时不调用模型，也就不记录
    let call: ReturnType<typeof startAiCall> | null = null
    try {
      await send('sources', { sources } satisfies AskSourcesEvent)
      // 一段资料都没找到时不调用大模型，也不占次数
      if (!sources.length) {
        await send('delta', { text: NO_HIT })
        await send('done', { citations: [], remaining: remaining === null ? null : remaining + 1 } satisfies AskDoneEvent)
        return
      }
      const messages = buildAskMessages({
        question: body.question,
        history: body.history,
        sources: found.hits.map((h, i) => ({ n: i + 1, title: h.chunk.title, heading: h.chunk.heading, text: h.chunk.text })),
      })
      call = startAiCall(user.id, 'ask', target)
      for await (const part of streamChat(target, messages, controller.signal, { maxTokens: 1200 })) {
        if (part.delta) {
          call.firstToken()
          text += part.delta
          await send('delta', { text: part.delta })
        }
        if (part.usage) usage = part.usage
      }
      if (!text.trim()) throw new AiError(502, 'AI 没有返回内容，请重试')
      await send('done', { citations: extractCitations(text, sources.length), remaining } satisfies AskDoneEvent)
    } catch (error) {
      failure = error
      if (!controller.signal.aborted) await send('error', { message: describeAiError(error, target) })
    } finally {
      await call?.finish({ usage, error: failure, aborted: controller.signal.aborted, produced: Boolean(text) })
      await stream.close()
    }
  })()

  return stream.send()
})
