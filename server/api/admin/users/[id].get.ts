import { and, count, desc, eq, gte, lte, sql, sum } from 'drizzle-orm'
import type { AdminUserDetail, AiKind } from '#shared/types/admin'
import { AI_KINDS } from '#shared/utils/ai-kinds'

/** 后台用户详情：学习情况、最近 30 天的 AI 用量、登录锁定、访问令牌。不返回笔记和回答的内容 */
export default defineEventHandler(async (event): Promise<AdminUserDetail> => {
  await requireAdmin(event)
  const id = idParam(event)
  const [user] = await adminUserRows(id)
  if (!user) throw createError({ statusCode: 404, message: '用户不存在' })

  const db = useDb()
  const t = tables
  const s = t.studyRecords
  const since30 = new Date(Date.now() - 30 * 86_400_000)
  const [[study], [cards], [due], [mocks], [agents], aiRows, recent, tokens, login] = await Promise.all([
    db
      .select({
        mastered: sql<number>`sum(${s.status} = 'mastered')`.mapWith(Number),
        fuzzy: sql<number>`sum(${s.status} = 'fuzzy')`.mapWith(Number),
        weak: sql<number>`sum(${s.status} = 'weak')`.mapWith(Number),
        starred: sql<number>`sum(${s.starred})`.mapWith(Number),
        notes: sql<number>`sum(${s.note} is not null and ${s.note} <> '')`.mapWith(Number),
      })
      .from(s)
      .where(eq(s.userId, id)),
    db.select({ n: count() }).from(t.reviewCards).where(eq(t.reviewCards.userId, id)),
    db
      .select({ n: count() })
      .from(t.reviewCards)
      .where(and(eq(t.reviewCards.userId, id), lte(t.reviewCards.due, new Date()))),
    db
      .select({ n: count(), finished: sql<number>`sum(${t.mockSessions.status} = 'finished')`.mapWith(Number) })
      .from(t.mockSessions)
      .where(eq(t.mockSessions.userId, id)),
    db.select({ n: count() }).from(t.agentSessions).where(eq(t.agentSessions.userId, id)),
    db
      .select({
        kind: t.aiCalls.kind,
        calls: count(),
        errors: sql<number>`sum(${t.aiCalls.status} = 'error')`.mapWith(Number),
        prompt: sum(t.aiCalls.promptTokens).mapWith(Number),
        completion: sum(t.aiCalls.completionTokens).mapWith(Number),
      })
      .from(t.aiCalls)
      .where(and(eq(t.aiCalls.userId, id), gte(t.aiCalls.createdAt, since30)))
      .groupBy(t.aiCalls.kind),
    db
      .select({
        id: t.aiCalls.id,
        at: t.aiCalls.createdAt,
        kind: t.aiCalls.kind,
        model: t.aiCalls.model,
        status: t.aiCalls.status,
        latencyMs: t.aiCalls.latencyMs,
        prompt: t.aiCalls.promptTokens,
        completion: t.aiCalls.completionTokens,
        error: t.aiCalls.error,
      })
      .from(t.aiCalls)
      .where(eq(t.aiCalls.userId, id))
      .orderBy(desc(t.aiCalls.createdAt), desc(t.aiCalls.id))
      .limit(10),
    db.select().from(t.apiTokens).where(eq(t.apiTokens.userId, id)).orderBy(desc(t.apiTokens.id)),
    loginFailureStatus(user.email),
  ])

  // 按功能汇总；用户自己的 Key 记为 xxx-own，token 和费用只算站点 Key 的
  const byKind = new Map(AI_KINDS.map((kind) => [kind, { kind, site: 0, own: 0, errors: 0 }]))
  let promptTokens = 0
  let completionTokens = 0
  for (const r of aiRows) {
    const own = r.kind.endsWith('-own')
    const k = byKind.get(r.kind.replace(/-own$/, '') as AiKind)
    if (!k) continue
    k[own ? 'own' : 'site'] += r.calls
    k.errors += r.errors || 0
    if (!own) {
      promptTokens += r.prompt || 0
      completionTokens += r.completion || 0
    }
  }
  const kinds = [...byKind.values()].filter((k) => k.site + k.own > 0)
  const { pricing, dailyLimit } = aiConfig()

  return {
    user,
    defaultLimit: dailyLimit,
    mailConfigured: mailConfigured(),
    study: {
      mastered: study?.mastered || 0,
      fuzzy: study?.fuzzy || 0,
      weak: study?.weak || 0,
      starred: study?.starred || 0,
      notes: study?.notes || 0,
      cards: cards?.n ?? 0,
      due: due?.n ?? 0,
    },
    practice: { interviews: user.interviews, mocks: mocks?.n ?? 0, mocksFinished: mocks?.finished || 0, agents: agents?.n ?? 0 },
    ai: {
      site: kinds.reduce((n, k) => n + k.site, 0),
      own: kinds.reduce((n, k) => n + k.own, 0),
      errors: kinds.reduce((n, k) => n + k.errors, 0),
      byKind: kinds,
      promptTokens,
      completionTokens,
      // 单个用户的费用很小，保留 4 位小数
      cost: pricing
        ? {
            amount: Math.round(((promptTokens * pricing.input + completionTokens * pricing.output) / 1e6) * 10_000) / 10_000,
            currency: pricing.currency,
          }
        : null,
      recent: recent.map((r) => ({
        id: r.id,
        at: r.at.toISOString(),
        kind: r.kind,
        model: r.model,
        status: r.status,
        latencyMs: r.latencyMs,
        tokens: r.prompt === null && r.completion === null ? null : (r.prompt ?? 0) + (r.completion ?? 0),
        error: r.error,
      })),
    },
    login,
    tokens: tokens.map(toTokenView),
  }
})
