import { and, count, eq, gte, lt, min } from 'drizzle-orm'

/**
 * 登录防暴力破解：按三个维度统计最近的失败次数，超过就暂时拒绝登录（被拒绝的请求不再计数，锁定不会越锁越久）。
 * - 同一账号 + 同一 IP：防对一个账号连续猜密码
 * - 同一 IP：防用一个 IP 对很多账号撞库
 * - 同一账号：防换很多 IP 猜同一个账号。阈值放得高，避免别人故意输错就能把你锁住
 */
const MINUTE = 60_000
const RULES = [
  { scope: 'account-ip', limit: 5, windowMs: 15 * MINUTE },
  { scope: 'ip', limit: 20, windowMs: 15 * MINUTE },
  { scope: 'account', limit: 30, windowMs: 60 * MINUTE },
] as const

const MESSAGES: Record<(typeof RULES)[number]['scope'], (minutes: number) => string> = {
  'account-ip': (m) => `密码错误次数太多，请 ${m} 分钟后再试，或者用"忘记密码"重置`,
  ip: (m) => `尝试次数太多，请 ${m} 分钟后再试`,
  account: (m) => `这个账号最近登录失败的次数太多，已临时锁定，请 ${m} 分钟后再试，或者用"忘记密码"重置`,
}

/** 超过任一限制时抛出 429，带上需要等待的秒数 */
export async function assertLoginAllowed(email: string, ip: string | null) {
  const db = useDb()
  const t = tables.failedLogins
  const now = Date.now()
  const where = {
    'account-ip': (since: Date) => and(eq(t.email, email), ip ? eq(t.ip, ip) : undefined, gte(t.createdAt, since)),
    ip: (since: Date) => (ip ? and(eq(t.ip, ip), gte(t.createdAt, since)) : undefined),
    account: (since: Date) => and(eq(t.email, email), gte(t.createdAt, since)),
  }
  for (const rule of RULES) {
    const condition = where[rule.scope](new Date(now - rule.windowMs))
    if (!condition) continue
    const [row] = await db.select({ n: count(), oldest: min(t.createdAt) }).from(t).where(condition)
    if ((row?.n ?? 0) >= rule.limit) {
      // 最早那次失败移出窗口后就能再试
      const oldest = row?.oldest ? new Date(row.oldest).getTime() : now
      const retryAfter = Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000))
      const message = MESSAGES[rule.scope](Math.ceil(retryAfter / 60))
      throw createError({ statusCode: 429, message, data: { message, retryAfter } })
    }
  }
}

export async function recordLoginFailure(email: string, ip: string | null) {
  const db = useDb()
  await db.insert(tables.failedLogins).values({ email, ip })
  // 偶尔顺手清理一天前的记录
  if (Math.random() < 0.05) {
    db.delete(tables.failedLogins)
      .where(lt(tables.failedLogins.createdAt, new Date(Date.now() - 24 * 60 * MINUTE)))
      .catch(() => {})
  }
}

/** 登录成功或重置密码后清掉失败记录；不传 ip 时清掉这个账号的全部记录 */
export async function clearLoginFailures(email: string, ip?: string | null) {
  const t = tables.failedLogins
  await useDb()
    .delete(t)
    .where(and(eq(t.email, email), ip ? eq(t.ip, ip) : undefined))
}

let dummyHash: Promise<string> | null = null

/**
 * 账号不存在时也做一次同样耗时的密码校验，让"账号不存在"和"密码错误"的响应时间一样，
 * 防止通过响应快慢判断邮箱有没有注册
 */
export async function verifyAgainstDummy(password: string) {
  dummyHash ??= hashPassword('dummy-password-for-timing')
  await verifyPassword(await dummyHash, password)
}
