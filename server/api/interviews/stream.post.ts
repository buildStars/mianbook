import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { InterviewTurn } from '#shared/types/handbook'
import type { ChatUsage } from '../../utils/ai'

const schema = z.object({
  questionId: z.number().int().positive(),
  interviewId: z.number().int().positive().optional(),
  answer: z.string().trim().min(2, '回答太短了').max(3000, '回答最多 3000 字'),
})

/**
 * AI 模拟面试：评价一轮回答，以 SSE 流式返回点评。
 * 事件：delta（点评片段）、done（得分、追问、面试 id）、error（出错原因）
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidated(event, schema)

  // 用户在浏览器里填了自己的 Key 就用它，不受每日次数限制；否则用站点的 Key
  const config = aiConfig()
  const target = userTarget(event) ?? siteTarget()
  const ownKey = target.source === 'user'
  if (!ownKey && !target.apiKey) {
    throw createError({ statusCode: 503, message: '站点没有配置 AI 服务，请在 AI 设置里填写你自己的 API Key' })
  }
  const used = ownKey ? 0 : await aiUsageToday(user.id)
  if (!ownKey && used >= config.dailyLimit) {
    throw createError({
      statusCode: 429,
      message: `24 小时内的 AI 面试次数已用完（${config.dailyLimit} 次），可以稍后再来，或在 AI 设置里填写自己的 API Key`,
    })
  }

  const db = useDb()
  const [question] = await db
    .select({ id: tables.questions.id, title: tables.questions.title, contentMd: tables.questions.contentMd })
    .from(tables.questions)
    .where(and(eq(tables.questions.id, body.questionId), eq(tables.questions.status, 'published')))
  if (!question) throw createError({ statusCode: 404, message: '题目不存在' })

  let interview: typeof tables.interviews.$inferSelect | undefined
  if (body.interviewId) {
    ;[interview] = await db
      .select()
      .from(tables.interviews)
      .where(
        and(
          eq(tables.interviews.id, body.interviewId),
          eq(tables.interviews.userId, user.id),
          eq(tables.interviews.questionId, question.id),
        ),
      )
    if (!interview) throw createError({ statusCode: 404, message: '面试记录不存在' })
    if (interview.rounds >= MAX_ROUNDS || !interview.turns.at(-1)?.followUp) {
      throw createError({ statusCode: 400, message: '这次面试已经结束，可以重新开始一次' })
    }
  }

  const turns = interview?.turns ?? []
  const round = turns.length + 1
  const messages = buildInterviewMessages({
    title: question.title.replace(/`/g, ''),
    reference: question.contentMd,
    turns,
    answer: body.answer,
  })

  const stream = createEventStream(event)
  const controller = new AbortController()
  // 用户点"停止"或关闭页面时，同时中断对大模型的请求，避免继续消耗 token
  stream.onClosed(() => controller.abort())

  const send = (name: string, data: unknown) => stream.push({ event: name, data: JSON.stringify(data) })

  ;(async () => {
    let text = ''
    let usage: ChatUsage | undefined
    try {
      for await (const part of streamChat(target, messages, controller.signal)) {
        if (part.delta) {
          text += part.delta
          await send('delta', { text: part.delta })
        }
        if (part.usage) usage = part.usage
      }
      if (!text.trim()) throw new AiError(502, 'AI 没有返回内容，请重试')

      const { score, followUp } = parseFeedback(text, round >= MAX_ROUNDS)
      const turn: InterviewTurn = { answer: body.answer, feedback: text, score, followUp, at: new Date().toISOString() }
      const nextTurns = [...turns, turn]

      let interviewId = interview?.id
      if (interviewId) {
        await db
          .update(tables.interviews)
          .set({ turns: nextTurns, rounds: nextTurns.length, score })
          .where(eq(tables.interviews.id, interviewId))
      } else {
        const [created] = await db
          .insert(tables.interviews)
          .values({ userId: user.id, questionId: question.id, turns: nextTurns, rounds: 1, score })
          .$returningId()
        interviewId = created!.id
      }

      // 低分的题自动标记为"不会"或"模糊"，方便之后复习
      let studyStatus = null
      const suggested = statusFromScore(score)
      if (suggested) {
        const current = await getStudyRecord(user.id, question.id)
        const saved = await saveStudyRecord(user.id, question.id, {
          status: suggested,
          starred: current?.starred ?? false,
          note: current?.note ?? null,
        })
        studyStatus = saved?.status ?? null
      }

      await send('done', {
        interviewId,
        round,
        score,
        followUp,
        finished: !followUp,
        studyStatus,
        remaining: ownKey ? null : Math.max(0, config.dailyLimit - used - 1),
      })
    } catch (error) {
      if (!controller.signal.aborted) await send('error', { message: describeAiError(error, target) })
    } finally {
      // 只要大模型已经开始输出，就算一次调用（中途停止也消耗了 token）
      if (text) {
        await db
          .insert(tables.aiCalls)
          .values({
            userId: user.id,
            // 用自己 Key 的调用单独记一类，不占站点的每日次数
            kind: ownKey ? 'interview-own' : 'interview',
            promptTokens: usage?.prompt_tokens ?? null,
            completionTokens: usage?.completion_tokens ?? null,
          })
          .catch(() => {})
      }
      await stream.close()
    }
  })()

  return stream.send()
})
