import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  email: z.string().trim().toLowerCase().max(191).email('邮箱格式不正确'),
  code: z.string().trim().regex(/^\d{6}$/, '验证码是 6 位数字'),
  password: z.string().min(8, '密码至少 8 位').max(72, '密码最多 72 位'),
})

/** 用邮箱验证码重置密码：其他设备上的登录全部失效，当前设备直接登录 */
export default defineEventHandler(async (event) => {
  const body = await readValidated(event, schema)
  const db = useDb()
  const [row] = await db.select().from(tables.users).where(eq(tables.users.email, body.email))
  // 没注册的邮箱拿不到验证码，按"没有获取验证码"处理，提示和注册过的邮箱一样
  if (!row) throw createError({ statusCode: 400, message: '请先获取邮箱验证码' })
  await consumeEmailCode(body.email, 'reset', body.code)

  await db.update(tables.users).set({ passwordHash: await hashPassword(body.password) }).where(eq(tables.users.id, row.id))
  const sessionVersion = await bumpSessionVersion(row.id, row.sessionVersion)
  // 重置成功说明是本人，清掉之前的登录失败记录，解除锁定
  await clearLoginFailures(body.email)
  return startUserSession(event, { ...row, sessionVersion })
})
