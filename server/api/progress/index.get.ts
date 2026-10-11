import { eq } from 'drizzle-orm'
import type { StudyRecordMap } from '#shared/types/handbook'

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event)
  const rows = await useDb().select().from(tables.studyRecords).where(eq(tables.studyRecords.userId, user.id))
  const records: StudyRecordMap = {}
  for (const r of rows) {
    records[r.questionId] = {
      status: r.status,
      starred: r.starred,
      note: r.note,
      updatedAt: r.updatedAt.toISOString(),
    }
  }
  return records
})
