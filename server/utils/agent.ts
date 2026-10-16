import { and, eq } from 'drizzle-orm'
import type {
  AgentAskedItem,
  AgentMessage,
  AgentSessionDetail,
  AgentSessionSummary,
  AgentState,
  ToolCall,
} from '#shared/types/agent'
import {
  ACTION_TEXT,
  AGENT_TOOLS,
  MAX_FOLLOW_UPS,
  MAX_STEPS,
  answerMessage,
  buildAgentSystem,
  buildTimeline,
  compactHistory,
  parseToolArgs,
  toolItem,
  toolLabel,
  type ToolName,
} from './agent-core'
import type { AiTarget, ChatUsage } from './ai'

type SessionRow = typeof tables.agentSessions.$inferSelect

export async function getAgentSession(userId: number, id: number): Promise<SessionRow> {
  const [row] = await useDb()
    .select()
    .from(tables.agentSessions)
    .where(and(eq(tables.agentSessions.id, id), eq(tables.agentSessions.userId, userId)))
  if (!row) throw createError({ statusCode: 404, message: '面试不存在' })
  return row
}

const mainItems = (state: AgentState) => state.asked.filter((a) => a.followUp === null)

/** 正在等候选人回答的题：出了题，还没打分也没跳过 */
export function awaitingItem(state: AgentState): AgentAskedItem | null {
  const item = state.current === null ? null : state.asked[state.current]
  return item && item.score === null && !item.skipped ? item : null
}

export function agentSummary(row: SessionRow): AgentSessionSummary {
  const scores = mainItems(row.state)
    .map((a) => a.score)
    .filter((s): s is number => s !== null)
  return {
    id: row.id,
    goal: row.goal,
    status: row.status,
    maxQuestions: row.maxQuestions,
    asked: mainItems(row.state).length,
    score: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function agentDetail(row: SessionRow): AgentSessionDetail {
  const awaiting = awaitingItem(row.state)
  return {
    ...agentSummary(row),
    timeline: buildTimeline(row.messages),
    awaiting: awaiting ? { questionId: awaiting.questionId, title: awaiting.title, followUp: awaiting.followUp } : null,
  }
}

// ---------- 工具的实现 ----------

interface ToolContext {
  userId: number
  state: AgentState
  maxQuestions: number
  /** 这一轮候选人回答了正在问的题，还没打分。打分只能在回答之后、每次回答只能打一次 */
  pendingAnswer: boolean
  finished: boolean
}

async function getLearningProfile(ctx: ToolContext) {
  const profile = await learningProfile(ctx.userId)
  return { ...profile, ...(profile.note ? { note: '候选人还没有学习记录，按面试目标出题，从基础题开始' } : {}) }
}

async function searchQuestionsTool(ctx: ToolContext, args: { query?: string; category?: string; difficulty?: number; limit?: number }) {
  const asked = new Set(ctx.state.asked.map((a) => a.questionId))
  const found = await findQuestions(ctx.userId, args, asked)
  if (found.error) return { error: found.error }
  return {
    ...found,
    questions: found.questions.map(({ path: _path, ...q }) => ({ ...q, askedInThisInterview: asked.has(q.id) })),
  }
}

async function getReference(args: { question_id: number }) {
  const [q] = await useDb()
    .select({ id: tables.questions.id, title: tables.questions.title, contentMd: tables.questions.contentMd })
    .from(tables.questions)
    .where(and(eq(tables.questions.id, args.question_id), eq(tables.questions.status, 'published')))
  if (!q) return { error: `题目 ${args.question_id} 不存在` }
  return { questionId: q.id, title: q.title, reference: compactReference(q.contentMd).slice(0, 4000) }
}

async function askQuestion(ctx: ToolContext, args: { question_id: number; follow_up?: string }) {
  const meta = await questionMeta()
  const m = meta.get(args.question_id)
  if (!m) return { error: `题目 ${args.question_id} 不存在，请从 search_questions 的结果里选` }
  const current = ctx.state.current === null ? null : ctx.state.asked[ctx.state.current]!
  const waiting = awaitingItem(ctx.state)
  if (waiting && ctx.pendingAnswer) return { error: '候选人已经回答了当前的题，请先调用 record_assessment 打分' }
  if (waiting) return { error: '当前的题候选人还没有回答，请等候选人回答' }

  if (args.follow_up) {
    if (!current || current.questionId !== args.question_id) return { error: '只能对正在问的题追问；要问新题时不要填 follow_up' }
    const lastMain = ctx.state.asked.findLastIndex((x) => x.followUp === null)
    const followUps = ctx.state.asked.slice(lastMain + 1).length
    if (followUps >= MAX_FOLLOW_UPS) return { error: `这道题已经追问了 ${MAX_FOLLOW_UPS} 次，请换下一道题` }
  } else {
    const mains = mainItems(ctx.state)
    if (mains.length >= ctx.maxQuestions) return { error: `已经问满 ${ctx.maxQuestions} 道主问题，请调用 finish_interview 结束面试` }
    if (mains.some((a) => a.questionId === args.question_id)) return { error: '这道题已经问过了，请换一道' }
  }

  ctx.state.asked.push({
    questionId: args.question_id,
    title: m.title,
    category: m.category,
    difficulty: m.difficulty,
    followUp: args.follow_up ?? null,
    score: null,
    strengths: [],
    gaps: [],
    skipped: false,
  })
  ctx.state.current = ctx.state.asked.length - 1
  const index = mainItems(ctx.state).length
  return {
    ok: true,
    questionId: args.question_id,
    title: m.title,
    category: m.category,
    difficulty: m.difficulty,
    path: m.path,
    index,
    followUp: args.follow_up ?? null,
    remainingQuestions: ctx.maxQuestions - index,
  }
}

async function recordAssessment(ctx: ToolContext, args: { question_id: number; score: number; strengths: string[]; gaps: string[] }) {
  const item = ctx.state.current === null ? null : ctx.state.asked[ctx.state.current]!
  if (!item) return { error: '还没有出题，不能打分' }
  if (item.questionId !== args.question_id) return { error: `只能给正在问的题打分，当前是题目 ${item.questionId}「${item.title}」` }
  if (item.score !== null) return { error: '这一轮已经打过分了' }
  if (!ctx.pendingAnswer) return { error: '候选人还没有回答这道题，等候选人回答后再打分' }

  const score = Math.max(0, Math.min(10, Math.round(args.score)))
  Object.assign(item, { score, strengths: args.strengths, gaps: args.gaps })
  ctx.pendingAnswer = false

  // 主问题的得分反映"会不会这道题"，写进复习计划；低分的题标记为不会或模糊。追问考的是深度，不计入
  let nextReview: string | null = null
  if (item.followUp === null) {
    const card = await reviewQuestion(ctx.userId, item.questionId, gradeFromScore(score), 'agent')
    nextReview = card.due.toISOString().slice(0, 10)
    const status = statusFromScore(score)
    if (status) {
      const current = await getStudyRecord(ctx.userId, item.questionId)
      await saveStudyRecord(ctx.userId, item.questionId, { status, starred: current?.starred ?? false, note: current?.note ?? null })
    }
  }
  return { saved: true, questionId: item.questionId, title: item.title, score, strengths: args.strengths, gaps: args.gaps, nextReview }
}

function finishInterview(ctx: ToolContext, args: { summary: string; next_steps: string[] }) {
  ctx.state.summary = { text: args.summary, nextSteps: args.next_steps }
  ctx.state.current = null
  ctx.finished = true
  return { finished: true, note: '面试已结束，用一句话和候选人道别，不要再调用工具' }
}

/** 执行一次工具调用；参数不对或不满足条件时返回 error，让模型自己修正 */
export async function executeTool(ctx: ToolContext, call: ToolCall): Promise<Record<string, unknown>> {
  if (ctx.finished && call.function.name !== 'finish_interview') return { error: '面试已经结束' }
  const parsed = parseToolArgs(call.function.name, call.function.arguments)
  if (!parsed.ok) return { error: parsed.error }
  const name: ToolName = parsed.name
  switch (name) {
    case 'get_learning_profile':
      return getLearningProfile(ctx)
    case 'search_questions':
      return searchQuestionsTool(ctx, parsed.args)
    case 'get_question_reference':
      return getReference(parsed.args)
    case 'ask_question':
      return askQuestion(ctx, parsed.args)
    case 'record_assessment':
      return recordAssessment(ctx, parsed.args)
    case 'finish_interview':
      return ctx.finished ? { error: '面试已经结束' } : finishInterview(ctx, parsed.args)
  }
}

// ---------- 一轮对话 ----------

/** 同一场面试同时只能跑一轮，防止重复提交把状态写乱 */
const running = new Set<number>()

export interface AgentTurnResult {
  usage: ChatUsage
  /** 模型有没有输出过内容（输出过就算一次调用） */
  produced: boolean
  /** 步数用完还没结束 */
  truncated: boolean
  finished: boolean
}

/**
 * 跑一轮：把候选人的消息交给模型，模型可以连续调用工具（查记录、找题、看参考答案、打分、出题），
 * 直到它输出不带工具调用的回复，或者用完步数。每一步的文字和工具调用都通过 emit 推给页面
 */
export async function runAgentTurn(input: {
  row: SessionRow
  userMessage: string | null
  pendingAnswer: boolean
  target: AiTarget
  signal: AbortSignal
  emit: (event: string, data: unknown) => Promise<void>
}): Promise<AgentTurnResult> {
  const { row, target, signal, emit } = input
  if (running.has(row.id)) throw createError({ statusCode: 409, message: '上一轮还没结束，请稍等' })
  running.add(row.id)

  const messages: AgentMessage[] = [...row.messages]
  if (input.userMessage) messages.push({ role: 'user', content: input.userMessage })
  const ctx: ToolContext = {
    userId: row.userId,
    state: structuredClone(row.state),
    maxQuestions: row.maxQuestions,
    pendingAnswer: input.pendingAnswer,
    finished: false,
  }
  const usage: ChatUsage = { prompt_tokens: 0, completion_tokens: 0 }
  let produced = false
  let truncated = true

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const request: AgentMessage[] = [{ role: 'system', content: buildAgentSystem(row.maxQuestions) }, ...compactHistory(messages)]
      let text = ''
      let calls: ToolCall[] = []
      for await (const part of streamChatWithTools(target, request, AGENT_TOOLS, signal)) {
        if (part.delta) {
          text += part.delta
          produced = true
          await emit('delta', { text: part.delta })
        }
        if (part.toolCalls) {
          calls = part.toolCalls
          produced = true
        }
        if (part.usage) {
          usage.prompt_tokens! += part.usage.prompt_tokens ?? 0
          usage.completion_tokens! += part.usage.completion_tokens ?? 0
        }
      }
      messages.push({ role: 'assistant', content: text, ...(calls.length ? { tool_calls: calls } : {}) })
      if (!calls.length) {
        truncated = false
        break
      }
      // 一步里最多执行 4 个工具调用，多出来的直接告诉模型
      for (const [i, call] of calls.entries()) {
        await emit('tool_start', { id: call.id, tool: call.function.name, label: toolLabel(call.function.name, {}) })
        let result: Record<string, unknown>
        try {
          result = i < 4 ? await executeTool(ctx, call) : { error: '一次最多调用 4 个工具' }
        } catch (error) {
          console.error('[agent] 工具执行出错', call.function.name, error)
          result = { error: '工具执行出错，请换一种做法' }
        }
        const content = JSON.stringify(result)
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content })
        await emit('tool_end', { item: toolItem(call, content) })
      }
    }
  } finally {
    // 出错或用户中途停止时，也把已经完成的步骤存下来
    await useDb()
      .update(tables.agentSessions)
      .set({ messages, state: ctx.state, status: ctx.finished ? 'finished' : 'active' })
      .where(eq(tables.agentSessions.id, row.id))
    running.delete(row.id)
  }
  return { usage, produced, truncated, finished: ctx.finished }
}

/** 解析一轮请求：开始、回答、跳过、结束，返回要追加的用户消息 */
export function turnMessage(
  row: SessionRow,
  body: { action: 'start' | 'answer' | 'skip' | 'finish'; answer?: string },
): { userMessage: string | null; pendingAnswer: boolean; state: AgentState } {
  if (row.status === 'finished') throw createError({ statusCode: 400, message: '这场面试已经结束' })
  const started = row.messages.length > 1
  const state = structuredClone(row.state)
  const waiting = awaitingItem(state)
  switch (body.action) {
    case 'start':
      if (started) throw createError({ statusCode: 400, message: '面试已经开始了' })
      return { userMessage: null, pendingAnswer: false, state }
    case 'answer':
      if (!started) throw createError({ statusCode: 400, message: '面试还没开始' })
      if (!body.answer) throw createError({ statusCode: 400, message: '请填写回答' })
      return { userMessage: answerMessage(body.answer), pendingAnswer: Boolean(waiting), state }
    case 'skip':
      if (!waiting) throw createError({ statusCode: 400, message: '现在没有可以跳过的题' })
      waiting.skipped = true
      return { userMessage: ACTION_TEXT.skip, pendingAnswer: false, state }
    case 'finish':
      if (!started) throw createError({ statusCode: 400, message: '面试还没开始' })
      return { userMessage: ACTION_TEXT.finish, pendingAnswer: false, state }
  }
}

