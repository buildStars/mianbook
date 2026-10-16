import { count, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { ApiTokenView } from '#shared/types/token'

const schema = z.object({
  name: z.string().trim().min(1, '给令牌起个名字，比如"笔记本上的 Claude Code"').max(64, '名字最多 64 个字'),
  scope: z.enum(['read', 'write']),
  /** 多少天后过期；0 表示不过期 */
  expiresInDays: z.union([z.literal(0), z.literal(30), z.literal(90), z.literal(365)]).default(90),
})

const MAX_TOKENS = 10

/** 创建访问令牌：明文只在这里返回一次，数据库里只存哈希 */
export default defineEventHandler(async (event): Promise<ApiTokenView & { token: string }> => {
  const { user } = await requireUserSession(event)
  const body = await readValidated(event, schema)
  const db = useDb()
  const t = tables.apiTokens
  const [existing] = await db.select({ n: count() }).from(t).where(eq(t.userId, user.id))
  if ((existing?.n ?? 0) >= MAX_TOKENS) throw createError({ statusCode: 400, message: `最多 ${MAX_TOKENS} 个令牌，请先撤销不用的` })

  const { token, hash, prefix } = generateApiToken()
  const expiresAt = body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null
  const [created] = await db
    .insert(t)
    .values({ userId: user.id, name: body.name, tokenHash: hash, prefix, scope: body.scope, expiresAt })
    .$returningId()
  const [row] = await db.select().from(t).where(eq(t.id, created!.id))
  return { ...toTokenView(row!), token }
})
