import { asc, count, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDb()
  const [users, records, interviews] = await Promise.all([
    db
      .select({
        id: tables.users.id,
        email: tables.users.email,
        name: tables.users.name,
        role: tables.users.role,
        createdAt: tables.users.createdAt,
      })
      .from(tables.users)
      .orderBy(asc(tables.users.id)),
    db
      .select({ userId: tables.studyRecords.userId, total: count() })
      .from(tables.studyRecords)
      .where(eq(tables.studyRecords.status, 'mastered'))
      .groupBy(tables.studyRecords.userId),
    db
      .select({ userId: tables.interviews.userId, total: count() })
      .from(tables.interviews)
      .groupBy(tables.interviews.userId),
  ])
  const mastered = new Map(records.map((r) => [r.userId, r.total]))
  const interviewCount = new Map(interviews.map((r) => [r.userId, r.total]))
  return users.map((u) => ({
    ...u,
    createdAt: u.createdAt.toISOString(),
    mastered: mastered.get(u.id) ?? 0,
    interviews: interviewCount.get(u.id) ?? 0,
  }))
})
