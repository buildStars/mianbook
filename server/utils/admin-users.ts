import { and, asc, count, eq, gte, max, notLike } from 'drizzle-orm'
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core'
import type { AdminUserRow } from '#shared/types/admin'

/** 后台用户列表；传 id 时只查这一个用户（详情抽屉用） */
export async function adminUserRows(id?: number): Promise<AdminUserRow[]> {
  const db = useDb()
  const t = tables
  const only = (column: AnyMySqlColumn) => (id === undefined ? undefined : eq(column, id))
  const since30 = new Date(Date.now() - 30 * 86_400_000)
  const [users, records, interviews, aiCalls, aiUsed, ...lastSeen] = await Promise.all([
    db
      .select({
        id: t.users.id,
        email: t.users.email,
        name: t.users.name,
        role: t.users.role,
        createdAt: t.users.createdAt,
        emailVerifiedAt: t.users.emailVerifiedAt,
        disabledAt: t.users.disabledAt,
        aiDailyLimit: t.users.aiDailyLimit,
      })
      .from(t.users)
      .where(only(t.users.id))
      .orderBy(asc(t.users.id)),
    db
      .select({ userId: t.studyRecords.userId, total: count() })
      .from(t.studyRecords)
      .where(and(eq(t.studyRecords.status, 'mastered'), only(t.studyRecords.userId)))
      .groupBy(t.studyRecords.userId),
    db.select({ userId: t.interviews.userId, total: count() }).from(t.interviews).where(only(t.interviews.userId)).groupBy(t.interviews.userId),
    // 最近 30 天用站点 Key 的调用次数，用户自己的 Key 不算
    db
      .select({ userId: t.aiCalls.userId, total: count() })
      .from(t.aiCalls)
      .where(and(gte(t.aiCalls.createdAt, since30), notLike(t.aiCalls.kind, '%-own'), only(t.aiCalls.userId)))
      .groupBy(t.aiCalls.userId),
    // 24 小时内计入次数的调用，和限流用同一个条件
    db
      .select({ userId: t.aiCalls.userId, total: count() })
      .from(t.aiCalls)
      .where(and(countedAiCalls(aiWindowStart()), only(t.aiCalls.userId)))
      .groupBy(t.aiCalls.userId),
    // 最近一次阅读、标记、复习、面试、调用 AI 的时间，取最晚的一个
    db
      .select({ userId: t.studyRecords.userId, at: max(t.studyRecords.updatedAt) })
      .from(t.studyRecords)
      .where(only(t.studyRecords.userId))
      .groupBy(t.studyRecords.userId),
    db.select({ userId: t.events.userId, at: max(t.events.createdAt) }).from(t.events).where(only(t.events.userId)).groupBy(t.events.userId),
    db
      .select({ userId: t.reviewLogs.userId, at: max(t.reviewLogs.createdAt) })
      .from(t.reviewLogs)
      .where(only(t.reviewLogs.userId))
      .groupBy(t.reviewLogs.userId),
    db
      .select({ userId: t.interviews.userId, at: max(t.interviews.updatedAt) })
      .from(t.interviews)
      .where(only(t.interviews.userId))
      .groupBy(t.interviews.userId),
    db.select({ userId: t.aiCalls.userId, at: max(t.aiCalls.createdAt) }).from(t.aiCalls).where(only(t.aiCalls.userId)).groupBy(t.aiCalls.userId),
  ])
  const mastered = new Map(records.map((r) => [r.userId, r.total]))
  const interviewCount = new Map(interviews.map((r) => [r.userId, r.total]))
  const aiCount = new Map(aiCalls.map((r) => [r.userId, r.total]))
  const aiUsedCount = new Map(aiUsed.map((r) => [r.userId, r.total]))
  const lastActive = new Map<number, Date>()
  for (const r of lastSeen.flat()) {
    const at = r.at ? new Date(r.at) : null
    if (at && (!lastActive.has(r.userId) || at > lastActive.get(r.userId)!)) lastActive.set(r.userId, at)
  }
  const { dailyLimit } = aiConfig()
  return users.map(({ emailVerifiedAt, disabledAt, aiDailyLimit, ...u }) => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
    emailVerified: Boolean(emailVerifiedAt),
    disabledAt: disabledAt?.toISOString() ?? null,
    mastered: mastered.get(u.id) ?? 0,
    interviews: interviewCount.get(u.id) ?? 0,
    aiCalls30d: aiCount.get(u.id) ?? 0,
    aiUsed24h: aiUsedCount.get(u.id) ?? 0,
    aiLimit: aiDailyLimit ?? dailyLimit,
    aiLimitCustom: aiDailyLimit,
    lastActiveAt: lastActive.get(u.id)?.toISOString() ?? null,
  }))
}

/** 后台操作的目标用户；不存在时返回 404 */
export async function adminTargetUser(id: number) {
  const [row] = await useDb()
    .select({
      id: tables.users.id,
      email: tables.users.email,
      name: tables.users.name,
      role: tables.users.role,
      disabledAt: tables.users.disabledAt,
    })
    .from(tables.users)
    .where(eq(tables.users.id, id))
  if (!row) throw createError({ statusCode: 404, message: '用户不存在' })
  return row
}
