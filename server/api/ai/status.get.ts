export default defineEventHandler(async (event) => {
  const { apiKey, model, dailyLimit, extraHosts } = aiConfig()
  const session = await getUserSession(event)
  const used = session.user ? await aiUsageToday(session.user.id) : 0
  return {
    /** 站点是否配置了 Key；没配置时用户仍可以填自己的 Key */
    enabled: Boolean(apiKey),
    model,
    dailyLimit,
    remaining: Math.max(0, dailyLimit - used),
    /** 用户自带 Key 时，除预设服务商外额外允许的域名 */
    extraHosts,
  }
})
