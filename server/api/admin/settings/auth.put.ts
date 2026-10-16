import { z } from 'zod'

const schema = z.object({ requireEmailCode: z.boolean() })

/** 注册是否需要邮箱验证码；发信出问题时可以临时关掉 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readValidated(event, schema)
  await saveAuthSettings({ ...authSettings(), requireEmailCode: body.requireEmailCode })
  return { emailCode: emailCodeRequired() }
})
