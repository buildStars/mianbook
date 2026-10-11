import { count, gte, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDb()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [[questions], [users], [records], [interviews], [aiCalls]] = await Promise.all([
    db
      .select({
        total: count(),
        published: sql<number>`sum(${tables.questions.status} = 'published')`.mapWith(Number),
      })
      .from(tables.questions),
    db.select({ total: count() }).from(tables.users),
    db.select({ total: count() }).from(tables.studyRecords),
    db.select({ total: count() }).from(tables.interviews),
    db.select({ total: count() }).from(tables.aiCalls).where(gte(tables.aiCalls.createdAt, since)),
  ])
  return {
    questions: questions?.total ?? 0,
    published: questions?.published ?? 0,
    users: users?.total ?? 0,
    studyRecords: records?.total ?? 0,
    interviews: interviews?.total ?? 0,
    aiCalls24h: aiCalls?.total ?? 0,
  }
})
