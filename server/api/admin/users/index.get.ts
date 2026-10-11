import { and, asc, count, eq, gte, max, notLike } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDb()
  const t = tables
  const since30 = new Date(Date.now() - 30 * 86_400_000)
  const [users, records, interviews, aiCalls, ...lastSeen] = await Promise.all([
    db
      .select({ id: t.users.id, email: t.users.email, name: t.users.name, role: t.users.role, createdAt: t.users.createdAt })
      .from(t.users)
      .orderBy(asc(t.users.id)),
    db
      .select({ userId: t.studyRecords.userId, total: count() })
      .from(t.studyRecords)
      .where(eq(t.studyRecords.status, 'mastered'))
      .groupBy(t.studyRecords.userId),
    db.select({ userId: t.interviews.userId, total: count() }).from(t.interviews).groupBy(t.interviews.userId),
    // 最近 30 天用站点 Key 的调用次数，用户自己的 Key 不算
    db
      .select({ userId: t.aiCalls.userId, total: count() })
      .from(t.aiCalls)
      .where(and(gte(t.aiCalls.createdAt, since30), notLike(t.aiCalls.kind, '%-own')))
      .groupBy(t.aiCalls.userId),
    // 最近一次阅读、标记、复习、面试、调用 AI 的时间，取最晚的一个
    db.select({ userId: t.studyRecords.userId, at: max(t.studyRecords.updatedAt) }).from(t.studyRecords).groupBy(t.studyRecords.userId),
    db.select({ userId: t.events.userId, at: max(t.events.createdAt) }).from(t.events).groupBy(t.events.userId),
    db.select({ userId: t.reviewLogs.userId, at: max(t.reviewLogs.createdAt) }).from(t.reviewLogs).groupBy(t.reviewLogs.userId),
    db.select({ userId: t.interviews.userId, at: max(t.interviews.updatedAt) }).from(t.interviews).groupBy(t.interviews.userId),
    db.select({ userId: t.aiCalls.userId, at: max(t.aiCalls.createdAt) }).from(t.aiCalls).groupBy(t.aiCalls.userId),
  ])
  const mastered = new Map(records.map((r) => [r.userId, r.total]))
  const interviewCount = new Map(interviews.map((r) => [r.userId, r.total]))
  const aiCount = new Map(aiCalls.map((r) => [r.userId, r.total]))
  const lastActive = new Map<number, Date>()
  for (const r of lastSeen.flat()) {
    const at = r.at ? new Date(r.at) : null
    if (at && (!lastActive.has(r.userId) || at > lastActive.get(r.userId)!)) lastActive.set(r.userId, at)
  }
  return users.map((u) => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
    mastered: mastered.get(u.id) ?? 0,
    interviews: interviewCount.get(u.id) ?? 0,
    aiCalls30d: aiCount.get(u.id) ?? 0,
    lastActiveAt: lastActive.get(u.id)?.toISOString() ?? null,
  }))
})
