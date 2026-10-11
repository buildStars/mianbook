import { desc, eq } from 'drizzle-orm'
import type { QuestionVersionSummary } from '#shared/types/admin'

/** 题目的修改历史，从新到旧；每个版本带上和前一个版本相比增删的行数 */
export default defineEventHandler(async (event): Promise<QuestionVersionSummary[]> => {
  await requireAdmin(event)
  const id = idParam(event)
  const v = tables.questionVersions
  const [rows, current] = await Promise.all([
    useDb()
      .select({ version: v, editor: tables.users.name })
      .from(v)
      .leftJoin(tables.users, eq(tables.users.id, v.editorId))
      .where(eq(v.questionId, id))
      .orderBy(desc(v.createdAt), desc(v.id)),
    questionSnapshot(id),
  ])
  if (!current) throw createError({ statusCode: 404, message: '题目不存在' })

  return rows.map(({ version: r, editor }, i) => {
    const older = rows[i + 1]?.version
    const stats = older ? diffStats(diffLines(older.contentMd, r.contentMd)) : null
    return {
      id: r.id,
      title: r.title,
      difficulty: r.difficulty,
      tags: r.tags,
      status: r.status,
      editor,
      createdAt: r.createdAt.toISOString(),
      added: stats?.added ?? null,
      removed: stats?.removed ?? null,
      current:
        r.title === current.title &&
        r.difficulty === current.difficulty &&
        r.status === current.status &&
        r.contentMd === current.contentMd &&
        JSON.stringify(r.tags) === JSON.stringify(current.tags),
    }
  })
})
