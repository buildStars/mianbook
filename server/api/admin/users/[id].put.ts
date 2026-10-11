import { count, eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({ role: z.enum(['admin', 'user']) })

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = idParam(event)
  const { role } = await readValidated(event, schema)
  const db = useDb()

  if (role === 'user') {
    if (id === admin.id) throw createError({ statusCode: 400, message: '不能取消自己的管理员身份' })
    const [row] = await db.select({ total: count() }).from(tables.users).where(eq(tables.users.role, 'admin'))
    if ((row?.total ?? 0) <= 1) throw createError({ statusCode: 400, message: '至少要保留一个管理员' })
  }
  await db.update(tables.users).set({ role }).where(eq(tables.users.id, id))
  return { id, role }
})
