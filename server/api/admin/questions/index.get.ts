import { and, asc, count, eq, like, type SQL } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  categoryId: z.coerce.number().int().positive().optional(),
  status: z.enum(['draft', 'published']).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = queryValidated(event, schema)
  const db = useDb()
  const { questions: q, categories: c, parts: p } = tables

  const conditions: SQL[] = []
  if (query.categoryId) conditions.push(eq(q.categoryId, query.categoryId))
  if (query.status) conditions.push(eq(q.status, query.status))
  if (query.q) conditions.push(like(q.title, `%${query.q.replace(/[%_\\]/g, '\\$&')}%`))
  const where = conditions.length ? and(...conditions) : undefined

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: q.id,
        slug: q.slug,
        title: q.title,
        difficulty: q.difficulty,
        tags: q.tags,
        status: q.status,
        sort: q.sort,
        updatedAt: q.updatedAt,
        categoryId: c.id,
        categorySlug: c.slug,
        categoryTitle: c.title,
        partSlug: p.slug,
        partTitle: p.title,
      })
      .from(q)
      .innerJoin(c, eq(q.categoryId, c.id))
      .innerJoin(p, eq(c.partId, p.id))
      .where(where)
      .orderBy(asc(p.sort), asc(c.sort), asc(q.sort), asc(q.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(q).where(where),
  ])

  return {
    total: total?.total ?? 0,
    items: rows.map((r) => ({
      ...r,
      path: `/${r.partSlug}/${r.categorySlug}/${r.slug}`,
      updatedAt: r.updatedAt.toISOString(),
    })),
  }
})
