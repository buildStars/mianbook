import { z } from 'zod'

const schema = z.object({
  q: z.string().trim().min(1, '问题不能为空').max(300, '问题太长了'),
  limit: z.number().int().min(1).max(6).default(4),
})

/**
 * TalkCue 的题库检索（见 server/utils/talkcue.ts）：只给 TalkCue 的服务端从内网调用，
 * 用 NUXT_TALKCUE_TOKEN 鉴权，没配置时、或者请求是从公网经 Caddy 进来的，这个接口都不存在。
 * 面试中每个问题都要等它，所以不重排（重排一次约 0.5 秒）；向量接口出错、只剩关键词检索时
 * 判断不了相关度，直接返回空，TalkCue 照常回答
 */
export default defineEventHandler(async (event) => {
  const { talkcue, public: pub } = useRuntimeConfig(event)
  // 只走内网：经过 Caddy 的请求都带 X-Forwarded-For，TalkCue 从 Docker 网络直连 app:3000 时没有
  if (!talkcue.token || getHeader(event, 'x-forwarded-for')) throw createError({ statusCode: 404 })
  if (!talkcueAuthorized(getHeader(event, 'authorization'), talkcue.token)) {
    throw createError({ statusCode: 401, message: '令牌不对' })
  }
  const { q, limit } = await readValidated(event, schema)
  const result = await searchHandbook(q, { rerank: false, limit: 6, perQuestion: 2 })
  const hits =
    result.mode === 'hybrid'
      ? talkcueHits(result.hits, pub.siteUrl, { limit, minSimilarity: Number(talkcue.minSimilarity) || TALKCUE_MIN_SIMILARITY })
      : []
  return { hits, mode: result.mode, tookMs: result.tookMs, warning: result.warning }
})
