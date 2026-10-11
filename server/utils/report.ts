import { and, eq, gte, lt, isNotNull, min } from 'drizzle-orm'
import type { ReportSuggestion, WeekStats, WeeklyReport } from '#shared/types/handbook'

const DAY = 86_400_000
const WEEKS_IN_TREND = 8

/**
 * 用户所在时区的一周（周一 0 点到下周一 0 点）。
 * tzOffset 是浏览器 getTimezoneOffset() 的值（东八区为 -480）；offset 0 是本周，-1 是上周
 */
export function weekRange(tzOffset: number, now: Date, offset = 0) {
  const local = new Date(now.getTime() - tzOffset * 60_000)
  const sinceMonday = (local.getUTCDay() + 6) % 7
  const mondayLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - sinceMonday + offset * 7)
  const start = new Date(mondayLocal + tzOffset * 60_000)
  return {
    start,
    end: new Date(start.getTime() + 7 * DAY),
    /** 这一周 7 天的本地日期 */
    days: Array.from({ length: 7 }, (_, i) => new Date(mondayLocal + i * DAY).toISOString().slice(0, 10)),
  }
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null)

interface Raw {
  events: { type: string; questionId: number | null; value: number | null; createdAt: Date }[]
  logs: { questionId: number; rating: number; createdAt: Date }[]
  interviews: { questionId: number; score: number | null; createdAt: Date }[]
  mocks: { score: number | null; finishedAt: Date }[]
  firstSeen: Map<number, Date>
}

/** 按时间段汇总一周的数字 */
function statsBetween(raw: Raw, start: Date, end: Date, tzOffset: number): WeekStats {
  const inRange = (d: Date) => d >= start && d < end
  const events = raw.events.filter((e) => inRange(e.createdAt))
  const logs = raw.logs.filter((l) => inRange(l.createdAt))
  const interviews = raw.interviews.filter((i) => inRange(i.createdAt))
  const mocks = raw.mocks.filter((m) => inRange(m.finishedAt))
  const reads = events.filter((e) => e.type === 'read')

  const days = new Set<string>()
  for (const d of [...reads.map((e) => e.createdAt), ...logs.map((l) => l.createdAt), ...interviews.map((i) => i.createdAt)]) {
    days.add(localDate(d, tzOffset))
  }

  return {
    studySeconds: reads.reduce((s, e) => s + (e.value ?? 0), 0),
    activeDays: days.size,
    questionsRead: new Set(reads.map((e) => e.questionId)).size,
    reviews: logs.length,
    newQuestions: [...raw.firstSeen.values()].filter(inRange).length,
    interviews: interviews.length,
    interviewAvg: avg(interviews.map((i) => i.score).filter((s): s is number => s !== null)),
    mockFinished: mocks.length,
    mockAvg: avg(mocks.map((m) => m.score).filter((s): s is number => s !== null)),
    reveals: events.filter((e) => e.type === 'reveal').length,
    voiceSeconds: events.filter((e) => e.type === 'voice').reduce((s, e) => s + (e.value ?? 0), 0),
  }
}

/** 根据数据给出下周建议，规则简单直接，不调用大模型 */
function suggest(r: Omit<WeeklyReport, 'suggestions'>): ReportSuggestion[] {
  const out: ReportSuggestion[] = []
  const { current: c, previous: p } = r
  const nothing = !c.studySeconds && !c.reviews && !c.interviews
  if (r.week.offset === 0 && r.dueToday) {
    out.push({ text: `今天有 ${r.dueToday} 道题到期，先把复习清掉，记忆最牢。`, link: { to: '/review', label: '去复习' } })
  }
  if (nothing) {
    out.push({ text: '这周还没有学习记录。从今日复习或者一场模拟面试开始都行，每天 15 分钟比周末突击有效得多。', link: { to: '/mock', label: '开始模拟面试' } })
    return out
  }
  if (c.activeDays < 4) {
    out.push({ text: `这周学了 ${c.activeDays} 天。间隔重复靠的是"隔几天再见一次"，尽量每天打开一下，哪怕只复习几道。` })
  }
  if (c.studySeconds && !c.interviews) {
    out.push({ text: '这周只读没练。挑几道读过的题让 AI 考一下，说出来才知道哪里没懂。', link: { to: '/mock', label: '来一场模拟面试' } })
  }
  const weak = r.categories.filter((x) => x.avgScore !== null && x.avgScore < 6).sort((a, b) => a.avgScore! - b.avgScore!)[0]
  if (weak) {
    out.push({
      text: `「${weak.title}」本周 AI 面试平均 ${weak.avgScore} 分，是最弱的一块，建议针对它练一场。`,
      link: { to: `/mock?categories=${weak.id}`, label: '针对练一场' },
    })
  }
  if (r.stuck.length) {
    out.push({ text: `有 ${r.stuck.length} 道题本周反复卡住，下面列出来了，建议重读解析后用自己的话复述一遍。` })
  }
  if (c.reveals >= 5 && c.interviews === 0) {
    out.push({ text: `自测模式里直接看了 ${c.reveals} 次答案。下次先在心里完整答一遍，再展开对照。` })
  }
  if (p.studySeconds && c.studySeconds >= p.studySeconds * 1.2) {
    out.push({ text: `学习时长比上周多了 ${Math.round((c.studySeconds / p.studySeconds - 1) * 100)}%，保持住。` })
  }
  if (c.interviewAvg !== null && p.interviewAvg !== null && c.interviewAvg > p.interviewAvg) {
    out.push({ text: `AI 面试平均分从 ${p.interviewAvg} 涨到了 ${c.interviewAvg}。` })
  }
  return out
}

export async function buildWeeklyReport(userId: number, tzOffset: number, offset: number, now = new Date()): Promise<WeeklyReport> {
  const db = useDb()
  const week = weekRange(tzOffset, now, offset)
  const prev = weekRange(tzOffset, now, offset - 1)
  const from = weekRange(tzOffset, now, offset - WEEKS_IN_TREND + 1).start

  const [events, logs, interviewRows, mocks, firsts, outline, summary] = await Promise.all([
    db
      .select({ type: tables.events.type, questionId: tables.events.questionId, value: tables.events.value, createdAt: tables.events.createdAt })
      .from(tables.events)
      .where(and(eq(tables.events.userId, userId), gte(tables.events.createdAt, from), lt(tables.events.createdAt, week.end))),
    db
      .select({ questionId: tables.reviewLogs.questionId, rating: tables.reviewLogs.rating, createdAt: tables.reviewLogs.createdAt })
      .from(tables.reviewLogs)
      .where(and(eq(tables.reviewLogs.userId, userId), gte(tables.reviewLogs.createdAt, from), lt(tables.reviewLogs.createdAt, week.end))),
    db
      .select({ questionId: tables.interviews.questionId, turns: tables.interviews.turns, createdAt: tables.interviews.createdAt })
      .from(tables.interviews)
      .where(and(eq(tables.interviews.userId, userId), gte(tables.interviews.createdAt, from), lt(tables.interviews.createdAt, week.end))),
    db
      .select({ score: tables.mockSessions.score, finishedAt: tables.mockSessions.finishedAt })
      .from(tables.mockSessions)
      .where(
        and(
          eq(tables.mockSessions.userId, userId),
          isNotNull(tables.mockSessions.finishedAt),
          gte(tables.mockSessions.finishedAt, from),
          lt(tables.mockSessions.finishedAt, week.end),
        ),
      ),
    // 每道题第一次进入复习计划的时间，用来算"新学的题"
    db
      .select({ questionId: tables.reviewLogs.questionId, first: min(tables.reviewLogs.createdAt) })
      .from(tables.reviewLogs)
      .where(eq(tables.reviewLogs.userId, userId))
      .groupBy(tables.reviewLogs.questionId),
    getOutline(),
    reviewSummary(userId, tzOffset),
  ])

  const raw: Raw = {
    events,
    logs,
    interviews: interviewRows.map((r) => ({ questionId: r.questionId, score: r.turns[0]?.score ?? null, createdAt: r.createdAt })),
    mocks: mocks.map((m) => ({ score: m.score, finishedAt: m.finishedAt! })),
    firstSeen: new Map(firsts.filter((f) => f.first).map((f) => [f.questionId, new Date(f.first as unknown as string | Date)])),
  }

  const info = new Map<number, { title: string; path: string; categoryId: number; category: string }>()
  for (const part of outline)
    for (const cat of part.categories)
      for (const q of cat.questions) info.set(q.id, { title: q.title, path: q.path, categoryId: cat.id, category: cat.title })

  const inWeek = (d: Date) => d >= week.start && d < week.end
  const daily = week.days.map((date) => ({ date, seconds: 0, reviews: 0, interviews: 0 }))
  const dayIndex = (d: Date) => week.days.indexOf(localDate(d, tzOffset))
  for (const e of raw.events) if (e.type === 'read' && inWeek(e.createdAt)) daily[dayIndex(e.createdAt)]!.seconds += e.value ?? 0
  for (const l of raw.logs) if (inWeek(l.createdAt)) daily[dayIndex(l.createdAt)]!.reviews++
  for (const i of raw.interviews) if (inWeek(i.createdAt)) daily[dayIndex(i.createdAt)]!.interviews++

  const trend = Array.from({ length: WEEKS_IN_TREND }, (_, k) => {
    const w = weekRange(tzOffset, now, offset - WEEKS_IN_TREND + 1 + k)
    const s = statsBetween(raw, w.start, w.end, tzOffset)
    return { start: w.days[0]!, seconds: s.studySeconds, interviewAvg: s.interviewAvg }
  })

  // 按分类汇总本周
  const cats = new Map<number, { id: number; title: string; seconds: number; scores: number[]; interviews: number; again: number }>()
  const cat = (questionId: number | null) => {
    const q = questionId === null ? undefined : info.get(questionId)
    if (!q) return null
    if (!cats.has(q.categoryId)) cats.set(q.categoryId, { id: q.categoryId, title: q.category, seconds: 0, scores: [], interviews: 0, again: 0 })
    return cats.get(q.categoryId)!
  }
  for (const e of raw.events) {
    const c = e.type === 'read' && inWeek(e.createdAt) ? cat(e.questionId) : null
    if (c) c.seconds += e.value ?? 0
  }
  for (const i of raw.interviews)
    if (inWeek(i.createdAt)) {
      const c = cat(i.questionId)
      if (!c) continue
      c.interviews++
      if (i.score !== null) c.scores.push(i.score)
    }
  for (const l of raw.logs) {
    const c = inWeek(l.createdAt) && l.rating === 1 ? cat(l.questionId) : null
    if (c) c.again++
  }
  const categories = [...cats.values()]
    .map(({ scores, ...c }) => ({ ...c, avgScore: avg(scores) }))
    .sort((a, b) => b.seconds - a.seconds || b.interviews - a.interviews)

  // 本周最卡的题：AI 面试第一轮 4 分及以下，或者复习时两次以上"不会"
  const stuckMap = new Map<number, { lowest: number | null; again: number }>()
  for (const i of raw.interviews)
    if (inWeek(i.createdAt) && i.score !== null && i.score <= 4) {
      const s = stuckMap.get(i.questionId) ?? { lowest: null, again: 0 }
      s.lowest = s.lowest === null ? i.score : Math.min(s.lowest, i.score)
      stuckMap.set(i.questionId, s)
    }
  const againCount = new Map<number, number>()
  for (const l of raw.logs) if (inWeek(l.createdAt) && l.rating === 1) againCount.set(l.questionId, (againCount.get(l.questionId) ?? 0) + 1)
  for (const [qid, n] of againCount)
    if (n >= 2) {
      const s = stuckMap.get(qid) ?? { lowest: null, again: 0 }
      s.again = n
      stuckMap.set(qid, s)
    }
  const stuck = [...stuckMap.entries()]
    .filter(([qid]) => info.has(qid))
    .sort(([, a], [, b]) => (a.lowest ?? 11) - (b.lowest ?? 11) || b.again - a.again)
    .slice(0, 5)
    .map(([qid, s]) => {
      const q = info.get(qid)!
      const reasons = [s.lowest !== null ? `AI 面试 ${s.lowest} 分` : '', s.again ? `${s.again} 次答"不会"` : ''].filter(Boolean)
      return { id: qid, title: q.title, path: q.path, category: q.category, reason: reasons.join('，') }
    })

  const base = {
    week: { start: week.days[0]!, end: week.days[6]!, offset },
    current: statsBetween(raw, week.start, week.end, tzOffset),
    previous: statsBetween(raw, prev.start, prev.end, tzOffset),
    daily,
    trend,
    categories,
    stuck,
    streak: summary.streak,
    dueToday: summary.dueToday,
  }
  return { ...base, suggestions: suggest(base) }
}
