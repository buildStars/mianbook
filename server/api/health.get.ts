import { sql } from 'drizzle-orm'

/** 健康检查：服务和数据库都正常时返回 200，部署脚本和 Docker 用它判断服务是否起来了 */
export default defineEventHandler(async () => {
  await useDb().execute(sql`select 1`)
  return { ok: true }
})
