import { count, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = idParam(event)
  const db = useDb()
  const [row] = await db.select({ total: count() }).from(tables.categories).where(eq(tables.categories.partId, id))
  if (row?.total) throw createError({ statusCode: 400, message: '请先删除或移走这个部分下的分类' })
  await db.delete(tables.parts).where(eq(tables.parts.id, id))
  invalidateContent()
  return { ok: true, sync: await writeOutlineFile() }
})
