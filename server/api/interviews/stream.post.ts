import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { CustomQuestion, InterviewTurn, MockItem } from '#shared/types/handbook'
import type { ChatUsage } from '../../utils/ai'

const schema = z.object({
  /** 题库里的题；整场面试里按简历生成的题不传 */
  questionId: z.number().int().positive().optional(),
  interviewId: z.number().int().positive().optional(),
  /** 整场模拟面试的 id；单题面试不传 */
  sessionId: z.number().int().positive().optional(),
  answer: z.string().trim().min(2, '回答太短了').max(3000, '回答最多 3000 字'),
})

/**
 * AI 模拟面试：评价一轮回答，以 SSE 流式返回点评。
 * 事件：delta（点评片段）、done（得分、追问、面试 id）、error（出错原因）
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const body = await readValidated(event, schema)
  const db = useDb()

  // 整场模拟面试：只能回答当前这道题，轮数按设置的追问次数决定
  const session = body.sessionId ? await getMockSession(user.id, body.sessionId) : null
  let maxRounds = MAX_ROUNDS
  let custom: CustomQuestion | undefined
  if (session) {
    const item = session.items[session.currentIndex]
    if (session.status !== 'active') throw createError({ statusCode: 400, message: '这场面试已经结束' })
    if (!item) throw createError({ statusCode: 400, message: '请回答当前这道题' })
    if (item.done) throw createError({ statusCode: 400, message: '这道题已经答完了，请进入下一题' })
    if (item.custom) {
      custom = item.custom
    } else {
      if (item.questionId !== body.questionId) throw createError({ statusCode: 400, message: '请回答当前这道题' })
      if ((item.interviewId ?? undefined) !== body.interviewId) throw createError({ statusCode: 400, message: '面试记录不匹配，请刷新页面' })
    }
    maxRounds = 1 + session.config.followUps
  } else if (!body.questionId) {
    throw createError({ statusCode: 400, message: '缺少题目' })
  }

  const { target, ownKey, remaining } = await resolveAi(event, user.id)

  // 题目：题库里的题读参考答案；按简历生成的题用考察要点代替参考答案
  let question: { id: number; title: string; contentMd: string } | undefined
  if (!custom) {
    ;[question] = await db
      .select({ id: tables.questions.id, title: tables.questions.title, contentMd: tables.questions.contentMd })
      .from(tables.questions)
      .where(and(eq(tables.questions.id, body.questionId!), eq(tables.questions.status, 'published')))
    if (!question) throw createError({ statusCode: 404, message: '题目不存在' })
  }

  let interview: typeof tables.interviews.$inferSelect | undefined
  if (!custom && body.interviewId) {
    ;[interview] = await db
      .select()
      .from(tables.interviews)
      .where(
        and(
          eq(tables.interviews.id, body.interviewId),
          eq(tables.interviews.userId, user.id),
          eq(tables.interviews.questionId, question!.id),
        ),
      )
    if (!interview) throw createError({ statusCode: 404, message: '面试记录不存在' })
    if (interview.rounds >= maxRounds || !interview.turns.at(-1)?.followUp) {
      throw createError({ statusCode: 400, message: '这次面试已经结束，可以重新开始一次' })
    }
  }

  const turns = custom ? (session!.items[session!.currentIndex]!.turns ?? []) : (interview?.turns ?? [])
  if (custom && turns.length && !turns.at(-1)?.followUp) throw createError({ statusCode: 400, message: '这道题已经答完了' })
  const round = turns.length + 1
  const lastRound = round >= maxRounds
  const messages = buildInterviewMessages({
    title: (custom?.title ?? question!.title).replace(/`/g, ''),
    reference: custom ? custom.points.map((p) => `- ${p}`).join('\n') : question!.contentMd,
    turns,
    answer: body.answer,
    maxRounds,
    kind: custom ? 'project' : 'bank',
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

      const { score, followUp } = parseFeedback(text, lastRound)
      const turn: InterviewTurn = { answer: body.answer, feedback: text, score, followUp, at: new Date().toISOString() }
      const nextTurns = [...turns, turn]
      const finished = !followUp

      // 按简历生成的题：记录只存在这场面试里，不进复习计划
      if (custom) {
        const items: MockItem[] = session!.items.map((it, i) =>
          i === session!.currentIndex ? { ...it, turns: nextTurns, scores: [...it.scores, score], done: finished } : it,
        )
        await saveItems(session!.id, items)
        await send('done', { interviewId: null, round, score, followUp, finished, studyStatus: null, remaining })
        return
      }

      let interviewId = interview?.id
      if (interviewId) {
        await db
          .update(tables.interviews)
          .set({ turns: nextTurns, rounds: nextTurns.length, score })
          .where(eq(tables.interviews.id, interviewId))
      } else {
        const [created] = await db
          .insert(tables.interviews)
          .values({ userId: user.id, questionId: question!.id, turns: nextTurns, rounds: 1, score, sessionId: session?.id ?? null })
          .$returningId()
        interviewId = created!.id
      }

      // 第一轮的得分反映"会不会这道题"，计入复习计划；追问考的是深度，不计入
      if (round === 1 && score !== null) {
        await reviewQuestion(user.id, question!.id, gradeFromScore(score), session ? 'mock' : 'interview')
      }

      // 低分的题自动标记为"不会"或"模糊"，方便之后复习
      let studyStatus = null
      const suggested = statusFromScore(score)
      if (suggested) {
        const current = await getStudyRecord(user.id, question!.id)
        const saved = await saveStudyRecord(user.id, question!.id, {
          status: suggested,
          starred: current?.starred ?? false,
          note: current?.note ?? null,
        })
        studyStatus = saved?.status ?? null
      }

      if (session) {
        const items: MockItem[] = session.items.map((it, i) =>
          i === session.currentIndex ? { ...it, interviewId: interviewId!, scores: [...it.scores, score], done: finished } : it,
        )
        await saveItems(session.id, items)
      }

      await send('done', { interviewId, round, score, followUp, finished, studyStatus, remaining })
    } catch (error) {
      if (!controller.signal.aborted) await send('error', { message: describeAiError(error, target) })
    } finally {
      // 只要大模型已经开始输出，就算一次调用（中途停止也消耗了 token）
      if (text) await recordAiCall(user.id, 'interview', ownKey, usage)
      await stream.close()
    }
  })()

  return stream.send()
})
