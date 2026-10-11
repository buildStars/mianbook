import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  await useDb().delete(tables.studyRecords).where(eq(tables.studyRecords.userId, user.id))
  return { ok: true }
})
