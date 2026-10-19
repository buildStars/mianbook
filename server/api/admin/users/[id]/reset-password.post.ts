/**
 * 给用户发重置密码的验证码邮件，用户在"忘记密码"页面输入验证码后自己设置新密码。
 * 管理员看不到也设不了用户的密码；原密码在用户重置之前一直有效
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const user = await adminTargetUser(idParam(event))
  if (!mailConfigured()) throw createError({ statusCode: 400, message: '站点还没有配置发信邮箱，不能发重置密码邮件' })
  if (user.disabledAt) throw createError({ statusCode: 400, message: '账号已停用，先启用再发重置密码邮件' })
  const sent = await issueEmailCode(event, user.email, 'reset', { byAdmin: true })
  return { ...sent, to: user.email }
})
