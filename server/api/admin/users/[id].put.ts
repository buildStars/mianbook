import { count, eq, sql } from 'drizzle-orm'
import type { MySqlUpdateSetSource } from 'drizzle-orm/mysql-core'
import { z } from 'zod'

const schema = z
  .object({
    role: z.enum(['admin', 'user']).optional(),
    /** 单独设的 24 小时 AI 次数：null 跟随全站设置，0 表示不能用站点的 AI */
    aiDailyLimit: z.number().int('次数要填整数').min(0, '次数不能小于 0').max(10_000, '次数最多 10000').nullable().optional(),
    disabled: z.boolean().optional(),
  })
  .refine((b) => b.role !== undefined || b.aiDailyLimit !== undefined || b.disabled !== undefined, '没有要修改的内容')

/** 修改用户：角色、单独的 AI 次数、停用或启用。返回修改后的列表行 */
export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const id = idParam(event)
  const body = await readValidated(event, schema)
  const target = await adminTargetUser(id)
  const db = useDb()
  const self = id === admin.id

  if (body.role === 'user' && target.role === 'admin') {
    if (self) throw createError({ statusCode: 400, message: '不能取消自己的管理员身份' })
    const [row] = await db.select({ total: count() }).from(tables.users).where(eq(tables.users.role, 'admin'))
    if ((row?.total ?? 0) <= 1) throw createError({ statusCode: 400, message: '至少要保留一个管理员' })
  }
  if (body.disabled && self) throw createError({ statusCode: 400, message: '不能停用自己的账号' })

  const patch: MySqlUpdateSetSource<typeof tables.users> = {}
  if (body.role !== undefined) patch.role = body.role
  if (body.aiDailyLimit !== undefined) patch.aiDailyLimit = body.aiDailyLimit
  if (body.disabled === true && !target.disabledAt) {
    patch.disabledAt = new Date()
    // 停用时所有设备下线；会话版本也加 1，重新启用后旧的登录不会恢复
    patch.sessionVersion = sql`${tables.users.sessionVersion} + 1`
  }
  if (body.disabled === false) patch.disabledAt = null
  if (Object.keys(patch).length) await db.update(tables.users).set(patch).where(eq(tables.users.id, id))
  if (body.disabled !== undefined) forgetSessionVersion(id)

  const [row] = await adminUserRows(id)
  return row!
})
