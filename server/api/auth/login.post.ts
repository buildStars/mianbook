import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  email: z.string().trim().toLowerCase().email('邮箱格式不正确'),
  password: z.string().min(1, '请输入密码').max(200, '密码太长了'),
})

export default defineEventHandler(async (event) => {
  const body = await readValidated(event, schema)
  const ip = clientIp(event)
  // 失败次数太多时直接拒绝，不再校验密码
  await assertLoginAllowed(body.email, ip)

  const [row] = await useDb().select().from(tables.users).where(eq(tables.users.email, body.email))
  const ok = row ? await verifyPassword(row.passwordHash, body.password) : (await verifyAgainstDummy(body.password), false)

  // 账号不存在和密码错误返回同样的提示，避免被用来探测邮箱是否注册
  if (!row || !ok) {
    await recordLoginFailure(body.email, ip)
    throw createError({ statusCode: 401, message: '邮箱或密码不正确' })
  }
  // 密码对了才告诉对方账号已停用，不知道密码的人看到的和密码错误一样
  if (row.disabledAt) throw createError({ statusCode: 403, message: '这个账号已被管理员停用，如有疑问请联系管理员' })

  await clearLoginFailures(body.email, ip)
  return startUserSession(event, row)
})
