export default defineEventHandler(async (event) => {
  const { apiKey, model, dailyLimit, extraHosts, allowUserKey } = aiConfig()
  const session = await getUserSession(event)
  // 管理员单独给这个用户设过次数时，按单独设的显示
  const [quota, used] = session.user
    ? await Promise.all([userDailyLimit(session.user.id), aiUsageToday(session.user.id)])
    : [{ limit: dailyLimit, custom: false }, 0]
  return {
    /** 站点是否配置了 Key；没配置时用户仍可以填自己的 Key */
    enabled: Boolean(apiKey),
    model,
    dailyLimit: quota.limit,
    remaining: Math.max(0, quota.limit - used),
    /** 管理员关闭了这个用户使用站点 AI 的权限（单独设成了 0 次） */
    blocked: quota.custom && quota.limit === 0,
    /** 用户自带 Key 时，除预设服务商外额外允许的域名 */
    extraHosts,
    /** 后台是否允许用户填自己的 Key */
    allowUserKey,
  }
})
