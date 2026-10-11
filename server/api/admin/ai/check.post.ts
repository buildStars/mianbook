import { z } from 'zod'

const schema = z.object({
  /** 想试的模型；不传时检查当前生效的模型 */
  model: z.string().trim().max(128).regex(/^[\w.:/@-]*$/).optional(),
}).optional()

/** 检查站点的 AI 配置：Key 是否有效，并实际调用一次模型；保存设置前可以先试新模型 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readValidated(event, schema)
  const target = siteTarget()
  const model = body?.model || target.model
  const base = { baseUrl: target.baseUrl, model, configured: Boolean(target.apiKey) }
  if (!target.apiKey) return { ...base, ok: false, message: '还没有在 .env 里配置 NUXT_AI_API_KEY', models: [] as string[] }

  let models: string[] = []
  try {
    models = await listModels(target)
  } catch {
    // 有的服务商没有 /models 接口，不影响使用
  }
  try {
    await pingModel({ ...target, model })
    return { ...base, ok: true, message: `连接正常，${model} 可以使用`, models }
  } catch (error) {
    return { ...base, ok: false, message: describeAiError(error, { ...target, model }), models }
  }
})
