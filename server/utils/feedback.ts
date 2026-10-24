import crypto from 'node:crypto'
import { and, count, desc, eq, gte, type SQL } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { AdminFeedbackRow } from '#shared/types/admin'

/** 提交频率：同一个 IP 每小时 10 条、每天 30 条；全站每天最多 300 条，防止被刷 */
export const FEEDBACK_LIMITS = { ipHourly: 10, ipDaily: 30, dailyTotal: 300 }

/** IP 只存 HMAC：能判断是不是同一个人在刷，又不保存原始 IP */
export function feedbackIpHash(event: H3Event): string | null {
  const ip = clientIp(event)
  if (!ip) return null
  const secret = String(useRuntimeConfig().session.password || '')
  return crypto.createHmac('sha256', secret).update(`feedback:${ip}`).digest('hex')
}

/** 超过频率限制时抛 429 */
export async function checkFeedbackRate(ipHash: string | null) {
  const db = useDb()
  const t = tables.questionFeedback
  const now = Date.now()
  const countSince = async (since: number, where?: SQL) => {
    const [row] = await db
      .select({ total: count() })
      .from(t)
      .where(and(gte(t.createdAt, new Date(since)), where))
    return row?.total ?? 0
  }
  const tooMany = () => createError({ statusCode: 429, message: '提交得太频繁了，稍后再试' })
  if (ipHash) {
    if ((await countSince(now - 3600_000, eq(t.ipHash, ipHash))) >= FEEDBACK_LIMITS.ipHourly) throw tooMany()
    if ((await countSince(now - 86400_000, eq(t.ipHash, ipHash))) >= FEEDBACK_LIMITS.ipDaily) throw tooMany()
  }
  if ((await countSince(now - 86400_000)) >= FEEDBACK_LIMITS.dailyTotal) throw tooMany()
}

/** 待处理的反馈条数，后台概览和导航用 */
export async function openFeedbackCount(): Promise<number> {
  const [row] = await useDb().select({ total: count() }).from(tables.questionFeedback).where(eq(tables.questionFeedback.status, 'open'))
  return row?.total ?? 0
}

/** 后台反馈列表：带题目标题、链接和提交人，最新的在前 */
export async function adminFeedbackRows(status?: FeedbackStatus): Promise<AdminFeedbackRow[]> {
  const t = tables
  const rows = await useDb()
    .select({
      id: t.questionFeedback.id,
      kind: t.questionFeedback.kind,
      content: t.questionFeedback.content,
      status: t.questionFeedback.status,
      createdAt: t.questionFeedback.createdAt,
      handledAt: t.questionFeedback.handledAt,
      questionId: t.questions.id,
      questionTitle: t.questions.title,
      questionSlug: t.questions.slug,
      questionStatus: t.questions.status,
      categorySlug: t.categories.slug,
      categoryTitle: t.categories.title,
      partSlug: t.parts.slug,
      userId: t.users.id,
      userName: t.users.name,
      userEmail: t.users.email,
    })
    .from(t.questionFeedback)
    .innerJoin(t.questions, eq(t.questions.id, t.questionFeedback.questionId))
    .innerJoin(t.categories, eq(t.categories.id, t.questions.categoryId))
    .innerJoin(t.parts, eq(t.parts.id, t.categories.partId))
    .leftJoin(t.users, eq(t.users.id, t.questionFeedback.userId))
    .where(status ? eq(t.questionFeedback.status, status) : undefined)
    .orderBy(desc(t.questionFeedback.id))
    .limit(300)
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    content: r.content,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    handledAt: r.handledAt?.toISOString() ?? null,
    question: {
      id: r.questionId,
      title: r.questionTitle,
      path: `/${r.partSlug}/${r.categorySlug}/${r.questionSlug}`,
      category: r.categoryTitle,
      published: r.questionStatus === 'published',
    },
    user: r.userId ? { id: r.userId, name: r.userName ?? '', email: r.userEmail ?? '' } : null,
  }))
}
