/** 检查 AI 配置：Key 是否有效、配置的模型是否在可用列表里 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { baseUrl, apiKey, model, dailyLimit } = aiConfig()
  const base = { baseUrl, model, dailyLimit, configured: Boolean(apiKey) }
  if (!apiKey) return { ...base, ok: false, message: '还没有配置 NUXT_AI_API_KEY', models: [] as string[] }
  try {
    const models = await listModels(siteTarget())
    const found = models.includes(model)
    return {
      ...base,
      ok: found,
      message: found ? '连接正常，模型可用' : `连接正常，但可用模型里没有 ${model}，请修改 NUXT_AI_MODEL`,
      models,
    }
  } catch (error) {
    return { ...base, ok: false, message: describeAiError(error), models: [] as string[] }
  }
})
