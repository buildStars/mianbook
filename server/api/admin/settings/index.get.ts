/** 后台设置页：当前生效的 AI 配置、.env 里的默认值，以及哪些项在后台改过 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  await loadSettings()
  const env = aiEnvConfig()
  const current = aiConfig()
  return {
    ai: {
      baseUrl: env.baseUrl,
      /** 只告诉前端有没有配置，不返回 Key 本身 */
      keyConfigured: Boolean(env.apiKey),
      model: current.model,
      dailyLimit: current.dailyLimit,
      extraHosts: current.extraHosts,
      allowUserKey: current.allowUserKey,
      pricing: current.pricing,
      defaults: { model: env.model, dailyLimit: env.dailyLimit, extraHosts: env.extraHosts },
      overridden: aiOverrides(),
    },
    contentSync: Boolean(contentRoot()),
  }
})
