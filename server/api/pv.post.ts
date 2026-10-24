import { z } from 'zod'

const schema = z.object({
  /** 浏览器 localStorage 里的随机串 */
  visitorId: z.string().regex(/^[\w-]{16,32}$/),
  path: z.string().max(1000),
  entry: z.boolean().optional(),
  /** document.referrer，只在一次访问的第一页带上；服务端只留外站域名 */
  referrer: z.string().max(1000).optional(),
  utmSource: z.string().max(200).optional(),
  device: z.enum(['mobile', 'desktop']),
})

/** 每个 IP 每分钟最多记 120 次 */
const allow = createMinuteLimiter(120)

/**
 * 记一次页面访问（见 app/plugins/analytics.client.ts）。
 * 爬虫、管理员自己、后台页面不记；不记的情况也返回 204，前端不用区分
 */
export default defineEventHandler(async (event) => {
  const body = await readValidated(event, schema)
  setResponseStatus(event, 204)

  const path = trackablePath(body.path)
  if (!path || isBotUserAgent(getRequestHeader(event, 'user-agent'))) return null
  if (!allow(clientIp(event) ?? body.visitorId)) return null
  const session = await getUserSession(event)
  if (session.user && (await isAdminUser(session.user.id))) return null

  const siteHosts = [new URL(useRuntimeConfig().public.siteUrl).hostname, getRequestHost(event).split(':')[0]!]
  await useDb()
    .insert(tables.pageViews)
    .values({
      visitorId: body.visitorId,
      userId: session.user?.id ?? null,
      path,
      entry: Boolean(body.entry),
      referrerHost: body.entry ? referrerHostOf(body.referrer, siteHosts) : null,
      utmSource: cleanUtmSource(body.utmSource),
      device: body.device,
    })
  return null
})
