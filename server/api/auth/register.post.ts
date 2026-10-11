import { count, eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  email: z.string().trim().toLowerCase().max(191).email('邮箱格式不正确'),
  name: z.string().trim().min(1, '请填写昵称').max(32, '昵称最多 32 个字'),
  password: z.string().min(8, '密码至少 8 位').max(72, '密码最多 72 位'),
})

export default defineEventHandler(async (event) => {
  const body = await readValidated(event, schema)
  const db = useDb()

  const [existing] = await db.select({ id: tables.users.id }).from(tables.users).where(eq(tables.users.email, body.email))
  if (existing) throw createError({ statusCode: 409, message: '这个邮箱已经注册过了' })

  // 第一个注册的账号自动成为管理员
  const [stats] = await db.select({ total: count() }).from(tables.users)
  const role: 'admin' | 'user' = stats?.total === 0 ? 'admin' : 'user'

  const [created] = await db
    .insert(tables.users)
    .values({ email: body.email, name: body.name, passwordHash: await hashPassword(body.password), role })
    .$returningId()
  const user = { id: created!.id, name: body.name, email: body.email, role }
  await setUserSession(event, { user })
  return user
})
