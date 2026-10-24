import { and, count, countDistinct, desc, eq, gte, isNotNull, like, or, sql, type SQLWrapper } from 'drizzle-orm'
import type { AdminTraffic } from '#shared/types/admin'

const DAY = 86_400_000

/** 不是题目页的路径在后台显示的名字 */
const PAGE_TITLES: Record<string, string> = {
  '/': '首页',
  '/mock': '模拟面试',
  '/ask': '问手册',
  '/review': '今日复习',
  '/progress': '我的进度',
  '/report': '学习周报',
  '/connect': '接入 AI 工具',
  '/login': '登录',
  '/register': '注册',
  '/forgot-password': '重置密码',
}

/**
 * 后台"访问"页的汇总：最近 days 天（含今天），按浏览器时区（tz = getTimezoneOffset()）分天。
 * 时间都存的 UTC，分天在 SQL 里加减时区偏移
 */
export async function trafficReport(days: number, tz: number): Promise<AdminTraffic> {
  const db = useDb()
  const pv = tables.pageViews
  const since = endOfLocalDay(tz, new Date(), -days)
  // tz 已经校验过是整数，直接拼进 SQL
  const localDay = (col: SQLWrapper) => sql<string>`DATE_FORMAT(DATE_SUB(${col}, INTERVAL ${sql.raw(String(Math.trunc(tz)))} MINUTE), '%Y-%m-%d')`
  const inRange = gte(pv.createdAt, since)

  const outline = await getOutline()
  const titles = new Map(outline.flatMap((p) => p.categories.flatMap((c) => c.questions.map((q) => [q.path, q.title] as const))))
  const questionPath = outline.length ? or(...outline.map((p) => like(pv.path, `/${p.slug}/%`))) : sql`false`

  const [daily, signupDaily, [totals], [questionVisitors], [signups], activated, returning, topPages, referrers, utmSources, devices] =
    await Promise.all([
      db
        .select({ day: localDay(pv.createdAt), views: count(), visitors: countDistinct(pv.visitorId) })
        .from(pv)
        .where(inRange)
        .groupBy(sql`1`),
      db
        .select({ day: localDay(tables.users.createdAt), total: count() })
        .from(tables.users)
        .where(gte(tables.users.createdAt, since))
        .groupBy(sql`1`),
      db.select({ views: count(), visitors: countDistinct(pv.visitorId) }).from(pv).where(inRange),
      db.select({ total: countDistinct(pv.visitorId) }).from(pv).where(and(inRange, questionPath)),
      db.select({ total: count() }).from(tables.users).where(gte(tables.users.createdAt, since)),
      db.execute(sql`
        SELECT COUNT(*) AS total FROM users u
        WHERE u.created_at >= ${since}
          AND (EXISTS (SELECT 1 FROM interviews i WHERE i.user_id = u.id)
            OR EXISTS (SELECT 1 FROM agent_sessions a WHERE a.user_id = u.id))`),
      db.execute(sql`
        SELECT COUNT(*) AS total FROM (
          SELECT visitor_id FROM page_views WHERE created_at >= ${since}
          GROUP BY visitor_id HAVING COUNT(DISTINCT ${localDay(sql`created_at`)}) >= 2
        ) t`),
      db
        .select({ path: pv.path, views: count(), visitors: countDistinct(pv.visitorId) })
        .from(pv)
        .where(inRange)
        .groupBy(pv.path)
        .orderBy(desc(count()))
        .limit(10),
      db
        .select({ host: pv.referrerHost, visitors: countDistinct(pv.visitorId) })
        .from(pv)
        .where(and(inRange, eq(pv.entry, true)))
        .groupBy(pv.referrerHost)
        .orderBy(desc(countDistinct(pv.visitorId)))
        .limit(10),
      db
        .select({ source: pv.utmSource, visitors: countDistinct(pv.visitorId) })
        .from(pv)
        .where(and(inRange, isNotNull(pv.utmSource)))
        .groupBy(pv.utmSource)
        .orderBy(desc(countDistinct(pv.visitorId)))
        .limit(10),
      db.select({ device: pv.device, visitors: countDistinct(pv.visitorId) }).from(pv).where(inRange).groupBy(pv.device),
    ])

  const firstRow = (result: unknown) => Number((result as [{ total: number | string }[]])[0]?.[0]?.total ?? 0)
  const byDay = new Map(daily.map((d) => [d.day, d]))
  const signupByDay = new Map(signupDaily.map((d) => [d.day, d.total]))
  const dates = Array.from({ length: days }, (_, i) => localDate(new Date(since.getTime() + i * DAY), tz))
  const activatedTotal = firstRow(activated)
  const visitors = totals?.visitors ?? 0

  return {
    days,
    daily: dates.map((date) => ({
      date,
      visitors: byDay.get(date)?.visitors ?? 0,
      views: byDay.get(date)?.views ?? 0,
      signups: signupByDay.get(date) ?? 0,
    })),
    totals: {
      visitors,
      views: totals?.views ?? 0,
      signups: signups?.total ?? 0,
      activated: activatedTotal,
      returning: firstRow(returning),
    },
    funnel: [
      { label: '访客', value: visitors },
      { label: '看过题目', value: questionVisitors?.total ?? 0 },
      { label: '注册', value: signups?.total ?? 0 },
      { label: '做过 AI 面试', value: activatedTotal },
    ],
    topPages: topPages.map((p) => ({ ...p, title: titles.get(p.path) ?? PAGE_TITLES[p.path] ?? p.path })),
    referrers: referrers.map((r) => ({ host: r.host, visitors: r.visitors })),
    utmSources: utmSources.map((u) => ({ source: u.source ?? '', visitors: u.visitors })),
    devices: {
      mobile: devices.find((d) => d.device === 'mobile')?.visitors ?? 0,
      desktop: devices.find((d) => d.device === 'desktop')?.visitors ?? 0,
    },
  }
}
