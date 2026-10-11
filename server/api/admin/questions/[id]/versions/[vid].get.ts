import { and, eq } from 'drizzle-orm'
import type { QuestionVersionDetail } from '#shared/types/admin'

export default defineEventHandler(async (event): Promise<QuestionVersionDetail> => {
  await requireAdmin(event)
  const id = idParam(event)
  const vid = idParam(event, 'vid')
  const v = tables.questionVersions
  const [row] = await useDb()
    .select({ version: v, editor: tables.users.name })
    .from(v)
    .leftJoin(tables.users, eq(tables.users.id, v.editorId))
    .where(and(eq(v.id, vid), eq(v.questionId, id)))
  if (!row) throw createError({ statusCode: 404, message: '版本不存在' })
  const r = row.version
  return {
    id: r.id,
    title: r.title,
    difficulty: r.difficulty,
    tags: r.tags,
    status: r.status,
    contentMd: r.contentMd,
    editor: row.editor,
    createdAt: r.createdAt.toISOString(),
  }
})
