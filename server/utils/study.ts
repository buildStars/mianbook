import { and, eq } from 'drizzle-orm'
import type { StudyRecord, StudyStatus } from '#shared/types/handbook'

export async function getStudyRecord(userId: number, questionId: number) {
  const [row] = await useDb()
    .select()
    .from(tables.studyRecords)
    .where(and(eq(tables.studyRecords.userId, userId), eq(tables.studyRecords.questionId, questionId)))
  return row ?? null
}

/** 写入一条学习记录；状态、收藏、笔记都为空时删除这条记录 */
export async function saveStudyRecord(
  userId: number,
  questionId: number,
  next: { status: StudyStatus | null; starred: boolean; note: string | null },
): Promise<StudyRecord | null> {
  const db = useDb()
  const note = next.note?.trim() ? next.note : null
  if (!next.status && !next.starred && !note) {
    await db
      .delete(tables.studyRecords)
      .where(and(eq(tables.studyRecords.userId, userId), eq(tables.studyRecords.questionId, questionId)))
    return null
  }
  const updatedAt = new Date()
  const values = { status: next.status, starred: next.starred, note, updatedAt }
  await db
    .insert(tables.studyRecords)
    .values({ userId, questionId, ...values })
    .onDuplicateKeyUpdate({ set: values })
  return { ...values, updatedAt: updatedAt.toISOString() }
}
