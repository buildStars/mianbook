import { z } from 'zod'

const schema = z.object({
  days: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).default(30),
  /** 浏览器 getTimezoneOffset() 的值，东八区为 -480 */
  tz: z.coerce.number().int().min(-840).max(840).default(0),
})

/** 后台"访问"页：访客、浏览量、注册转化、热门页面和来源 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { days, tz } = await queryValidated(event, schema)
  return trafficReport(days, tz)
})
