import { eq } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  email: z.string().trim().toLowerCase().max(191).email('邮箱格式不正确'),
  purpose: z.literal('register'),
})

/** 发送注册验证码 */
export default defineEventHandler(async (event) => {
  const body = await readValidated(event, schema)
  if (!emailCodeRequired()) throw createError({ statusCode: 400, message: '注册不需要验证码' })

  const [existing] = await useDb().select({ id: tables.users.id }).from(tables.users).where(eq(tables.users.email, body.email))
  if (existing) throw createError({ statusCode: 409, message: '这个邮箱已经注册过了，可以直接登录' })

  return issueEmailCode(event, body.email, body.purpose)
})
