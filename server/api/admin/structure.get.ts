import { asc, count } from 'drizzle-orm'

/** 后台用的目录结构：所有部分和分类（包括空分类），附带题目数量 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const db = useDb()
  const [parts, cats, counts] = await Promise.all([
    db.select().from(tables.parts).orderBy(asc(tables.parts.sort), asc(tables.parts.id)),
    db.select().from(tables.categories).orderBy(asc(tables.categories.sort), asc(tables.categories.id)),
    db
      .select({ categoryId: tables.questions.categoryId, total: count() })
      .from(tables.questions)
      .groupBy(tables.questions.categoryId),
  ])
  const countMap = new Map(counts.map((c) => [c.categoryId, c.total]))
  return parts.map((p) => ({
    ...p,
    categories: cats
      .filter((c) => c.partId === p.id)
      .map((c) => ({ ...c, questionCount: countMap.get(c.id) ?? 0 })),
  }))
})
