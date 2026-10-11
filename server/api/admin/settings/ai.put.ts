import { z } from 'zod'
import type { AiSettings } from '../../../utils/settings'

const host = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, '域名格式不对')

const schema = z.object({
  model: z.string().trim().min(1, '请填写模型名').max(128).regex(/^[\w.:/@-]+$/, '模型名格式不对'),
  dailyLimit: z.number().int().min(0, '不能小于 0').max(10_000),
  extraHosts: z.array(host).max(20),
  allowUserKey: z.boolean(),
  pricing: z
    .object({
      input: z.number().min(0).max(10_000),
      output: z.number().min(0).max(10_000),
      currency: z.enum(['CNY', 'USD']),
    })
    .nullable(),
})

/** 保存后台可改的 AI 设置，立即生效；接口地址和 API Key 仍然只能在 .env 里改 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readValidated(event, schema)
  const env = aiEnvConfig()
  const extraHosts = [...new Set(body.extraHosts)]
  // 只存和 .env 不一样的项，这样以后改 .env 的默认值，没在后台改过的项会跟着变
  const next: AiSettings = {}
  if (body.model !== env.model) next.model = body.model
  if (body.dailyLimit !== env.dailyLimit) next.dailyLimit = body.dailyLimit
  if (extraHosts.join(',') !== env.extraHosts.join(',')) next.extraHosts = extraHosts
  if (!body.allowUserKey) next.allowUserKey = false
  if (body.pricing) next.pricing = body.pricing
  await saveAiSettings(next)
  return { ok: true, overridden: next }
})
