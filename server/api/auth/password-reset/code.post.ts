import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({ email: z.string().trim().toLowerCase().max(191).email('邮箱格式不正确') })

/**
 * 发送重置密码的验证码。邮箱没注册时也返回同样的结果、只是不发信，
 * 避免这个接口被用来探测哪些邮箱注册过
 */
export default defineEventHandler(async (event) => {
  const { email } = await readValidated(event, schema)
  if (!mailConfigured()) throw createError({ statusCode: 400, message: '站点还没有配置发信邮箱，暂时不能自助重置密码，请联系管理员' })
  const [user] = await useDb().select({ id: tables.users.id }).from(tables.users).where(eq(tables.users.email, email))
  if (!user) return { cooldown: Number(useRuntimeConfig().auth.codeCooldownSeconds) || 60, expiresInMinutes: 10 }
  return issueEmailCode(event, email, 'reset')
})
