/** 给当前管理员的邮箱发一封测试邮件，确认发信配置可用 */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  if (!mailConfigured()) throw createError({ statusCode: 400, message: '还没有配置发信邮箱：在 .env 里填写 NUXT_MAIL_HOST、NUXT_MAIL_USER、NUXT_MAIL_PASS' })
  const site = String(useRuntimeConfig().public.siteName || '全栈面试手册')
  try {
    await sendMail({
      to: admin.email,
      subject: `测试邮件 · ${site}`,
      text: `这是一封测试邮件。收到它说明${site}的发信配置可以正常使用，注册验证码也能发出去。`,
    })
  } catch (error) {
    // 管理员需要知道具体原因（比如授权码错误、端口被封）才能排查
    const detail = error instanceof MailError && error.detail ? `：${error.detail}` : ''
    throw createError({ statusCode: 502, message: `邮件发送失败${detail}` })
  }
  return { ok: true, to: admin.email }
})
