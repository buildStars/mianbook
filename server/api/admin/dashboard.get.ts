import { and, avg, count, countDistinct, desc, eq, gte, inArray, isNotNull, sql, sum, type SQL } from 'drizzle-orm'
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core'
import { z } from 'zod'
import type { AdminDashboard, AiKind, DashboardQuestionRef } from '#shared/types/admin'

const schema = z.object({
  /** 浏览器 getTimezoneOffset() 的值，东八区为 -480 */
  tz: z.coerce.number().int().min(-840).max(840).default(0),
})

const DAY = 86_400_000
const BOARD_SIZE = 8
const KINDS: AiKind[] = ['interview', 'report', 'resume', 'author']

const round1 = (n: number | string | null | undefined) => (n == null ? null : Math.round(Number(n) * 10) / 10)

/** 运营看板：AI 用量和费用、活跃度、学习数据、内容概况、题目难度榜 */
export default defineEventHandler(async (event): Promise<AdminDashboard> => {
  await requireAdmin(event)
  const { tz } = queryValidated(event, schema)
  const db = useDb()
  const t = tables
  const now = new Date()

  // tz 已经校验过是整数，直接拼进 SQL，保证 select 和 group by 里的表达式一字不差
  const localDay = (col: AnyMySqlColumn) =>
    sql<string>`date_format(date_sub(${col}, interval ${sql.raw(String(tz))} minute), '%Y-%m-%d')`

  const since14 = endOfLocalDay(tz, now, -14)
  const since7 = new Date(now.getTime() - 7 * DAY)
  const since30 = new Date(now.getTime() - 30 * DAY)
  const days = Array.from({ length: 14 }, (_, i) => localDate(new Date(since14.getTime() + i * DAY), tz))

  const aiDay = localDay(t.aiCalls.createdAt)
  /** 某天有过阅读、复习、面试、调用 AI 中任意一种行为，就算当天活跃 */
  const activeDays = (userId: AnyMySqlColumn, at: AnyMySqlColumn) => ({
    fields: { userId: sql<number>`${userId}`, day: localDay(at) },
    where: gte(at, since30),
  })
  const active = [
    activeDays(t.events.userId, t.events.createdAt),
    activeDays(t.reviewLogs.userId, t.reviewLogs.createdAt),
    activeDays(t.interviews.userId, t.interviews.updatedAt),
    activeDays(t.aiCalls.userId, t.aiCalls.createdAt),
  ]
  // JSON 里的 null 用 json_value 取出来是 SQL 的 NULL，不会被当成 0 分
  const firstScore = sql<number>`json_value(${t.interviews.turns}, '$[0].score' returning signed)`

  const [
    aiRows,
    activeRows,
    newUserRows,
    [userTotal],
    [reads],
    [reviews],
    [interviews],
    [mockStarted],
    [mockFinished],
    [content],
    [categoryTotal],
    recent,
    lowScore,
    forgotten,
    popular,
  ] = await Promise.all([
    db
      .select({
        day: aiDay,
        kind: t.aiCalls.kind,
        calls: count(),
        prompt: sum(t.aiCalls.promptTokens).mapWith(Number),
        completion: sum(t.aiCalls.completionTokens).mapWith(Number),
        untracked: sql<number>`sum(${t.aiCalls.promptTokens} is null)`.mapWith(Number),
      })
      .from(t.aiCalls)
      .where(gte(t.aiCalls.createdAt, since14))
      .groupBy(aiDay, t.aiCalls.kind),
    Promise.all([
      db.selectDistinct(active[0]!.fields).from(t.events).where(active[0]!.where),
      db.selectDistinct(active[1]!.fields).from(t.reviewLogs).where(active[1]!.where),
      db.selectDistinct(active[2]!.fields).from(t.interviews).where(active[2]!.where),
      db.selectDistinct(active[3]!.fields).from(t.aiCalls).where(active[3]!.where),
    ]).then((lists) => lists.flat()),
    db
      .select({ day: localDay(t.users.createdAt), total: count() })
      .from(t.users)
      .where(gte(t.users.createdAt, since14))
      .groupBy(localDay(t.users.createdAt)),
    db.select({ total: count() }).from(t.users),
    db
      .select({ total: count(), seconds: sum(t.events.value).mapWith(Number) })
      .from(t.events)
      .where(and(eq(t.events.type, 'read'), gte(t.events.createdAt, since7))),
    db.select({ total: count() }).from(t.reviewLogs).where(gte(t.reviewLogs.createdAt, since7)),
    db
      .select({ total: count(), avg: avg(t.interviews.score) })
      .from(t.interviews)
      .where(gte(t.interviews.createdAt, since7)),
    db.select({ total: count() }).from(t.mockSessions).where(gte(t.mockSessions.createdAt, since7)),
    db
      .select({ total: count(), avg: avg(t.mockSessions.score) })
      .from(t.mockSessions)
      .where(and(eq(t.mockSessions.status, 'finished'), gte(t.mockSessions.finishedAt, since7))),
    db
      .select({
        total: count(),
        published: sql<number>`sum(${t.questions.status} = 'published')`.mapWith(Number),
      })
      .from(t.questions),
    db.select({ total: count() }).from(t.categories),
    db
      .select({ id: t.questions.id, updatedAt: t.questions.updatedAt })
      .from(t.questions)
      .orderBy(desc(t.questions.updatedAt), desc(t.questions.id))
      .limit(6),
    db
      .select({ id: t.interviews.questionId, avg: avg(firstScore), count: count() })
      .from(t.interviews)
      .where(isNotNull(firstScore))
      .groupBy(t.interviews.questionId)
      .having(sql`count(*) >= 2`)
      .orderBy(sql`2 asc`, sql`3 desc`)
      .limit(BOARD_SIZE),
    db
      .select({ id: t.reviewLogs.questionId, count: count(), users: countDistinct(t.reviewLogs.userId) })
      .from(t.reviewLogs)
      .where(and(eq(t.reviewLogs.rating, 1), gte(t.reviewLogs.createdAt, since30)))
      .groupBy(t.reviewLogs.questionId)
      .orderBy(sql`2 desc`, sql`3 desc`)
      .limit(BOARD_SIZE),
    db
      .select({
        id: sql<number>`${t.events.questionId}`,
        users: countDistinct(t.events.userId),
        seconds: sum(t.events.value).mapWith(Number),
      })
      .from(t.events)
      .where(and(eq(t.events.type, 'read'), isNotNull(t.events.questionId), gte(t.events.createdAt, since30)))
      .groupBy(t.events.questionId)
      .orderBy(sql`2 desc`, sql`3 desc`)
      .limit(BOARD_SIZE),
  ])

  // 榜单和最近修改里出现的题目，一次查出标题和网址
  const refIds = [...new Set([...recent, ...lowScore, ...forgotten, ...popular].map((r) => Number(r.id)))]
  const refs = await questionRefs(refIds)
  const ref = (id: number) => refs.get(Number(id))
  const withRef = <T extends { id: number }>(rows: T[]) =>
    rows.flatMap((r) => {
      const q = ref(r.id)
      return q ? [{ ...r, ...q }] : []
    })

  // AI 用量
  const { model, apiKey, pricing } = aiConfig()
  const daily = days.map((date) => ({ date, site: 0, own: 0, promptTokens: 0, completionTokens: 0 }))
  const byKind = new Map(KINDS.map((kind) => [kind, { kind, site: 0, own: 0 }]))
  let untracked = 0
  for (const r of aiRows) {
    const own = r.kind.endsWith('-own')
    const kind = r.kind.replace(/-own$/, '') as AiKind
    const d = daily.find((x) => x.date === r.day)
    if (d) {
      if (own) d.own += r.calls
      else {
        d.site += r.calls
        d.promptTokens += r.prompt || 0
        d.completionTokens += r.completion || 0
      }
    }
    const k = byKind.get(kind)
    if (k) k[own ? 'own' : 'site'] += r.calls
    if (!own) untracked += r.untracked || 0
  }
  const sumOf = (rows: typeof daily, key: 'site' | 'own' | 'promptTokens' | 'completionTokens') => rows.reduce((s, d) => s + d[key], 0)
  const promptTokens = sumOf(daily, 'promptTokens')
  const completionTokens = sumOf(daily, 'completionTokens')
  const cost = pricing
    ? {
        amount: Math.round(((promptTokens * pricing.input + completionTokens * pricing.output) / 1e6) * 100) / 100,
        currency: pricing.currency,
      }
    : null

  // 活跃度
  const activeByDay = new Map<string, Set<number>>()
  for (const r of activeRows) {
    if (!activeByDay.has(r.day)) activeByDay.set(r.day, new Set())
    activeByDay.get(r.day)!.add(Number(r.userId))
  }
  const today = days.at(-1)!
  const lastDays = (n: number) => {
    const set = new Set<number>()
    for (let i = 0; i < n; i++) {
      const date = localDate(new Date(now.getTime() - i * DAY), tz)
      for (const id of activeByDay.get(date) ?? []) set.add(id)
    }
    return set.size
  }
  const newUsers = new Map(newUserRows.map((r) => [r.day, r.total]))

  // 需要处理的事项
  const drafts = (content?.total ?? 0) - (content?.published ?? 0)
  const alerts: AdminDashboard['alerts'] = []
  if (!apiKey) alerts.push({ level: 'warn', text: '站点没有配置 AI Key，用户只能用自己的 Key 做模拟面试', to: '/admin/ai', action: '去配置' })
  if (drafts) alerts.push({ level: 'info', text: `有 ${drafts} 道题还是草稿，前台看不到`, to: '/admin/questions?status=draft', action: '查看草稿' })
  if (!contentRoot()) alerts.push({ level: 'info', text: '没有找到 content 目录，后台的修改只保存在数据库里，记得定期 npm run db:export 备份' })
  if (apiKey && !pricing && sumOf(daily, 'site')) {
    alerts.push({ level: 'info', text: '填写模型价格后，可以估算站点 Key 的花费', to: '/admin/ai', action: '填写价格' })
  }

  return {
    days,
    ai: {
      configured: Boolean(apiKey),
      model,
      daily,
      byKind: [...byKind.values()],
      site7d: sumOf(daily.slice(7), 'site'),
      sitePrev7d: sumOf(daily.slice(0, 7), 'site'),
      own14d: sumOf(daily, 'own'),
      promptTokens,
      completionTokens,
      untracked,
      cost,
    },
    activity: {
      daily: days.map((date) => ({ date, active: activeByDay.get(date)?.size ?? 0, newUsers: newUsers.get(date) ?? 0 })),
      dau: activeByDay.get(today)?.size ?? 0,
      wau: lastDays(7),
      mau: lastDays(30),
      users: userTotal?.total ?? 0,
      newUsers7d: days.slice(7).reduce((s, d) => s + (newUsers.get(d) ?? 0), 0),
    },
    learning: {
      reads: reads?.total ?? 0,
      readSeconds: reads?.seconds ?? 0,
      reviews: reviews?.total ?? 0,
      interviews: interviews?.total ?? 0,
      interviewAvg: round1(interviews?.avg),
      mockStarted: mockStarted?.total ?? 0,
      mockFinished: mockFinished?.total ?? 0,
      mockAvg: round1(mockFinished?.avg),
    },
    content: {
      total: content?.total ?? 0,
      published: content?.published ?? 0,
      drafts,
      categories: categoryTotal?.total ?? 0,
      recent: withRef(recent.map((r) => ({ id: r.id, updatedAt: r.updatedAt.toISOString() }))),
    },
    board: {
      lowScore: withRef(lowScore.map((r) => ({ id: r.id, avg: round1(r.avg) ?? 0, count: r.count }))),
      forgotten: withRef(forgotten),
      popular: withRef(popular.map((r) => ({ id: Number(r.id), users: r.users, seconds: r.seconds || 0 }))),
    },
    alerts,
  }
})

async function questionRefs(ids: number[]): Promise<Map<number, Omit<DashboardQuestionRef, 'id'>>> {
  if (!ids.length) return new Map()
  const { questions: q, categories: c, parts: p } = tables
  const where: SQL = inArray(q.id, ids)
  const rows = await useDb()
    .select({ id: q.id, title: q.title, status: q.status, slug: q.slug, cat: c.slug, part: p.slug })
    .from(q)
    .innerJoin(c, eq(q.categoryId, c.id))
    .innerJoin(p, eq(c.partId, p.id))
    .where(where)
  return new Map(rows.map((r) => [r.id, { title: r.title, status: r.status, path: `/${r.part}/${r.cat}/${r.slug}` }]))
}
