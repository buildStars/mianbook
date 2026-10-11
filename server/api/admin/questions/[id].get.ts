import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = idParam(event)
  const db = useDb()
  const [row] = await db
    .select({
      question: tables.questions,
      categorySlug: tables.categories.slug,
      partSlug: tables.parts.slug,
    })
    .from(tables.questions)
    .innerJoin(tables.categories, eq(tables.questions.categoryId, tables.categories.id))
    .innerJoin(tables.parts, eq(tables.categories.partId, tables.parts.id))
    .where(eq(tables.questions.id, id))
  if (!row) throw createError({ statusCode: 404, message: '题目不存在' })

  const q = row.question
  return {
    id: q.id,
    categoryId: q.categoryId,
    slug: q.slug,
    title: q.title,
    difficulty: q.difficulty,
    tags: q.tags,
    contentMd: q.contentMd,
    sort: q.sort,
    status: q.status,
    path: `/${row.partSlug}/${row.categorySlug}/${q.slug}`,
    updatedAt: q.updatedAt.toISOString(),
  }
})
