import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { createEmptyCard, fsrs, type Card, type Grade } from 'ts-fsrs'
import type { ReviewGrade, StoredCard, StudyStatus } from '#shared/types/handbook'

/**
 * 间隔重复调度器（FSRS）。面试题的复习以天为单位就够了，所以关掉分钟级的学习步骤；
 * 准备面试的周期一般是几个月，最长间隔限制在 120 天左右
 * （ts-fsrs 会保证四档评分的间隔依次拉开，所以"会了""很熟"最多比上限多一两天）
 */
const scheduler = fsrs({ enable_short_term: false, maximum_interval: 120 })

/** 题目页上多久之内改评分算"改主意"，撤回上一次再重新计算，避免来回点击把复习次数刷高 */
const UNDO_WINDOW_MS = 10 * 60 * 1000

export type ReviewSource = 'review' | 'page' | 'interview' | 'mock' | 'agent' | 'mcp'

export const gradeFromStatus: Record<StudyStatus, ReviewGrade> = { weak: 1, fuzzy: 2, mastered: 3 }

/** AI 面试得分换算成复习评分：4 分及以下不会，5～7 模糊，8～9 会了，10 很熟 */
export const gradeFromScore = (score: number): ReviewGrade => (score <= 4 ? 1 : score <= 7 ? 2 : score <= 9 ? 3 : 4)

export const statusFromGrade = (grade: ReviewGrade): StudyStatus => (grade === 1 ? 'weak' : grade === 2 ? 'fuzzy' : 'mastered')

type CardRow = typeof tables.reviewCards.$inferSelect

function rowToCard(row: Omit<CardRow, 'userId' | 'questionId'>): Card {
  return {
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsedDays,
    scheduled_days: row.scheduledDays,
    learning_steps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.lastReview ?? undefined,
  }
}

function cardToRow(card: Card) {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review ?? null,
  }
}

const toStored = (card: Card): StoredCard => {
  const row = cardToRow(card)
  return { ...row, due: row.due.toISOString(), lastReview: row.lastReview?.toISOString() ?? null }
}

const fromStored = (s: StoredCard): Card =>
  rowToCard({ ...s, due: new Date(s.due), lastReview: s.lastReview ? new Date(s.lastReview) : null })

export async function getReviewCard(userId: number, questionId: number): Promise<Card | null> {
  const [row] = await useDb()
    .select()
    .from(tables.reviewCards)
    .where(and(eq(tables.reviewCards.userId, userId), eq(tables.reviewCards.questionId, questionId)))
  return row ? rowToCard(row) : null
}

/** 记一次复习：按评分重新安排下次复习时间。没有卡片时新建，相当于把这道题加入复习计划 */
export async function reviewQuestion(
  userId: number,
  questionId: number,
  grade: ReviewGrade,
  source: ReviewSource,
  now = new Date(),
): Promise<Card> {
  const db = useDb()
  let card: Card | null = await getReviewCard(userId, questionId)

  if (source === 'page' && card) {
    const [last] = await db
      .select()
      .from(tables.reviewLogs)
      .where(and(eq(tables.reviewLogs.userId, userId), eq(tables.reviewLogs.questionId, questionId)))
      .orderBy(desc(tables.reviewLogs.id))
      .limit(1)
    if (last && last.source === 'page' && now.getTime() - last.createdAt.getTime() < UNDO_WINDOW_MS) {
      card = last.prevCard ? fromStored(last.prevCard) : null
      await db.delete(tables.reviewLogs).where(eq(tables.reviewLogs.id, last.id))
    }
  }

  const before = card
  const next = scheduler.next(before ?? createEmptyCard(now), now, grade as Grade).card
  const values = cardToRow(next)
  await db
    .insert(tables.reviewCards)
    .values({ userId, questionId, ...values })
    .onDuplicateKeyUpdate({ set: values })
  await db.insert(tables.reviewLogs).values({
    userId,
    questionId,
    rating: grade,
    source,
    prevCard: before ? toStored(before) : null,
    createdAt: now,
  })
  return next
}

/** 每个评分对应的下次复习间隔（天），显示在复习按钮上 */
export function previewIntervals(card: Card, now = new Date()): Record<ReviewGrade, number> {
  const preview = scheduler.repeat(card, now)
  const days = (g: ReviewGrade) => Math.max(1, Math.round((preview[g as Grade].card.due.getTime() - now.getTime()) / 86_400_000))
  return { 1: days(1), 2: days(2), 3: days(3), 4: days(4) }
}

/**
 * 用户所在时区"今天"结束的时刻。tzOffset 是浏览器 getTimezoneOffset() 的值（分钟，东八区为 -480）
 */
export function endOfLocalDay(tzOffset: number, now = new Date(), plusDays = 0): Date {
  const local = new Date(now.getTime() - tzOffset * 60_000)
  local.setUTCHours(24 * (plusDays + 1), 0, 0, 0)
  return new Date(local.getTime() + tzOffset * 60_000)
}

/** 本地日期字符串 YYYY-MM-DD */
export const localDate = (d: Date, tzOffset: number) => new Date(d.getTime() - tzOffset * 60_000).toISOString().slice(0, 10)

export async function reviewSummary(userId: number, tzOffset: number) {
  const db = useDb()
  const now = new Date()
  const todayEnd = endOfLocalDay(tzOffset, now)
  const weekEnd = endOfLocalDay(tzOffset, now, 6)
  const todayStart = new Date(todayEnd.getTime() - 86_400_000)

  const [[totals], dueRows, logRows] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`,
        dueToday: sql<number>`sum(${tables.reviewCards.due} < ${todayEnd})`,
      })
      .from(tables.reviewCards)
      .where(eq(tables.reviewCards.userId, userId)),
    db
      .select({ due: tables.reviewCards.due })
      .from(tables.reviewCards)
      .where(and(eq(tables.reviewCards.userId, userId), lt(tables.reviewCards.due, weekEnd))),
    // 连续天数最多往回看一年
    db
      .select({ createdAt: tables.reviewLogs.createdAt, questionId: tables.reviewLogs.questionId })
      .from(tables.reviewLogs)
      .where(and(eq(tables.reviewLogs.userId, userId), gte(tables.reviewLogs.createdAt, new Date(now.getTime() - 366 * 86_400_000)))),
  ])

  const forecast = Array.from({ length: 7 }, (_, i) => ({
    date: localDate(new Date(todayStart.getTime() + i * 86_400_000), tzOffset),
    count: 0,
  }))
  for (const { due } of dueRows) {
    const i = Math.max(0, Math.floor((due.getTime() - todayStart.getTime()) / 86_400_000))
    if (i < 7) forecast[i]!.count++
  }

  const days = new Set(logRows.map((r) => localDate(r.createdAt, tzOffset)))
  const doneToday = new Set(logRows.filter((r) => r.createdAt >= todayStart).map((r) => r.questionId)).size
  let streak = 0
  // 今天还没复习不算断，从昨天往前数
  let cursor = days.has(forecast[0]!.date) ? todayStart : new Date(todayStart.getTime() - 86_400_000)
  while (days.has(localDate(cursor, tzOffset))) {
    streak++
    cursor = new Date(cursor.getTime() - 86_400_000)
  }

  return {
    dueToday: Number(totals?.dueToday ?? 0),
    total: Number(totals?.total ?? 0),
    doneToday,
    streak,
    forecast,
  }
}

/** 今天到期的卡片，逾期最久的排在前面 */
export function dueCards(userId: number, tzOffset: number, limit: number) {
  return useDb()
    .select()
    .from(tables.reviewCards)
    .where(and(eq(tables.reviewCards.userId, userId), lt(tables.reviewCards.due, endOfLocalDay(tzOffset))))
    .orderBy(tables.reviewCards.due)
    .limit(limit)
}

export { rowToCard }
