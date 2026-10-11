import { count, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = idParam(event)
  const db = useDb()
  const [row] = await db.select({ total: count() }).from(tables.questions).where(eq(tables.questions.categoryId, id))
  if (row?.total) throw createError({ statusCode: 400, message: '这个分类下还有题目，请先删除或移动题目' })
  await db.delete(tables.categories).where(eq(tables.categories.id, id))
  invalidateContent()
  return { ok: true }
})
