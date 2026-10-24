import crypto from 'node:crypto'
import { and, count, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { MailMessage } from './mailer'

export type CodePurpose = 'register' | 'reset'

const CODE_TTL_MINUTES = 10
const MAX_ATTEMPTS = 5
const HOUR = 3_600_000
const DAY = 24 * HOUR

/** 注册是否需要邮箱验证码：配置了发信，并且后台没有关掉 */
export function emailCodeRequired(): boolean {
  return mailConfigured() && authSettings().requireEmailCode !== false
}

/** 用户的 IP；在反向代理后面时取 X-Forwarded-For（Caddy 会覆盖掉客户端自己伪造的值） */
export function clientIp(event: H3Event): string | null {
  const { auth } = useRuntimeConfig()
  return getRequestIP(event, { xForwardedFor: Boolean(auth.trustProxy) }) ?? null
}

/** 只存验证码的哈希；用会话密钥做 HMAC，数据库泄露也还原不出验证码 */
function hashCode(purpose: CodePurpose, email: string, code: string) {
  const secret = String(useRuntimeConfig().session.password || '')
  return crypto.createHmac('sha256', secret).update(`${purpose}:${email}:${code}`).digest('hex')
}

const tooMany = (message: string, retryAfter: number) =>
  createError({ statusCode: 429, message, data: { message, retryAfter: Math.max(1, Math.ceil(retryAfter)) } })

/**
 * 生成并发送验证码。按邮箱、IP 和全站总量限制频率，防止被拿来刷邮件或批量注册。
 * 返回多少秒后可以再次发送
 */
export async function issueEmailCode(
  event: H3Event,
  email: string,
  purpose: CodePurpose,
  /** byAdmin：管理员在后台替用户发起的重置，邮件里换成对应的说明 */
  options: { byAdmin?: boolean } = {},
) {
  const { auth } = useRuntimeConfig()
  const db = useDb()
  const t = tables.emailCodes
  const now = Date.now()
  const ip = clientIp(event)
  const cooldown = Number(auth.codeCooldownSeconds) || 60

  const [[last], [perEmail], [perIpHour], [perIpDay], [total]] = await Promise.all([
    // 冷却按用途分开算（刚注册完也能马上申请重置密码）；每小时的总量不分用途
    db.select({ createdAt: t.createdAt }).from(t).where(and(eq(t.email, email), eq(t.purpose, purpose))).orderBy(desc(t.id)).limit(1),
    db.select({ n: count() }).from(t).where(and(eq(t.email, email), gte(t.createdAt, new Date(now - HOUR)))),
    ip ? db.select({ n: count() }).from(t).where(and(eq(t.ip, ip), gte(t.createdAt, new Date(now - HOUR)))) : [{ n: 0 }],
    ip ? db.select({ n: count() }).from(t).where(and(eq(t.ip, ip), gte(t.createdAt, new Date(now - DAY)))) : [{ n: 0 }],
    db.select({ n: count() }).from(t).where(gte(t.createdAt, new Date(now - DAY))),
  ])

  const sinceLast = last ? (now - last.createdAt.getTime()) / 1000 : Infinity
  if (sinceLast < cooldown) throw tooMany(`发送太频繁，${Math.ceil(cooldown - sinceLast)} 秒后再试`, cooldown - sinceLast)
  if ((perEmail?.n ?? 0) >= Number(auth.codePerEmailHourly)) throw tooMany('这个邮箱获取验证码的次数太多了，请一小时后再试', 3600)
  if ((perIpHour?.n ?? 0) >= Number(auth.codePerIpHourly)) throw tooMany('请求太频繁，请一小时后再试', 3600)
  if ((perIpDay?.n ?? 0) >= Number(auth.codePerIpDaily)) throw tooMany('今天的请求次数已用完，请明天再试', 3600)
  // 全站总量：保护发信邮箱不因为发得太多被服务商限制
  if ((total?.n ?? 0) >= Number(auth.codeDailyTotal)) throw tooMany('今天的注册人数太多了，请明天再试', 3600)

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const [created] = await db
    .insert(t)
    .values({ email, purpose, codeHash: hashCode(purpose, email, code), ip, expiresAt: new Date(now + CODE_TTL_MINUTES * 60_000) })
    .$returningId()

  try {
    await sendMail(codeMail(email, code, purpose, options.byAdmin))
  } catch (error) {
    // 没发出去的验证码不占发送次数
    await db.delete(t).where(eq(t.id, created!.id))
    throw createError({ statusCode: 502, message: error instanceof MailError ? error.message : '邮件发送失败，请稍后再试' })
  }

  // 顺手清理两天前的记录
  db.delete(t)
    .where(lt(t.createdAt, new Date(now - 2 * DAY)))
    .catch(() => {})
  return { cooldown, expiresInMinutes: CODE_TTL_MINUTES }
}

/** 校验验证码，正确时标记为已使用；错误或过期时抛出 400 */
export async function consumeEmailCode(email: string, purpose: CodePurpose, code: string) {
  const db = useDb()
  const t = tables.emailCodes
  const [row] = await db
    .select()
    .from(t)
    .where(and(eq(t.email, email), eq(t.purpose, purpose), isNull(t.usedAt)))
    .orderBy(desc(t.id))
    .limit(1)
  if (!row) throw createError({ statusCode: 400, message: '请先获取邮箱验证码' })
  if (row.expiresAt.getTime() < Date.now()) throw createError({ statusCode: 400, message: '验证码已过期，请重新获取' })
  if (row.attempts >= MAX_ATTEMPTS) {
    throw createError({ statusCode: 400, message: '验证码输错次数太多，请重新获取' })
  }
  const expected = Buffer.from(row.codeHash, 'hex')
  const actual = Buffer.from(hashCode(purpose, email, code), 'hex')
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    await db.update(t).set({ attempts: sql`${t.attempts} + 1` }).where(eq(t.id, row.id))
    throw createError({ statusCode: 400, message: '验证码不正确' })
  }
  // 条件更新，同一个验证码并发提交时只有一个能用上
  const [result] = await db
    .update(t)
    .set({ usedAt: new Date() })
    .where(and(eq(t.id, row.id), isNull(t.usedAt)))
  if (!result.affectedRows) throw createError({ statusCode: 400, message: '验证码已使用，请重新获取' })
}

function codeMail(to: string, code: string, purpose: CodePurpose, byAdmin = false): MailMessage {
  const site = String(useRuntimeConfig().public.siteName || '面书')
  const label = purpose === 'reset' ? '重置密码验证码' : '注册验证码'
  const intro = byAdmin
    ? `管理员为你在${site}的账号发起了重置密码，验证码是：`
    : `你正在${purpose === 'reset' ? `重置${site}的密码` : `注册${site}`}，验证码是：`
  const notes = byAdmin
    ? [
        `请打开${site}的登录页，点"忘记密码"，输入这个邮箱和验证码，再设置新密码。${CODE_TTL_MINUTES} 分钟内有效，只能使用一次。`,
        '如果你没有找过管理员，忽略这封邮件即可，原来的密码仍然可以使用。',
      ]
    : [`${CODE_TTL_MINUTES} 分钟内有效，只能使用一次。`, '如果这不是你本人的操作，请忽略这封邮件，不要把验证码告诉别人。']
  return {
    to,
    subject: `${code} 是你的${label} · ${site}`,
    text: [`${intro}${code}`, ...notes].join('\n\n'),
    html: `<div style="font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#1c1b19;background:#faf9f6">
  <div style="display:inline-block;width:36px;height:36px;line-height:36px;text-align:center;border-radius:8px;background:#c8372d;color:#fff;font-weight:700;font-size:20px">面</div>
  <p style="margin:24px 0 8px;font-size:15px">${intro}</p>
  <p style="margin:0 0 20px;font-size:34px;font-weight:700;letter-spacing:8px;color:#1f3fd6">${code}</p>
  <p style="margin:0;font-size:13px;color:#56524c;line-height:1.8">${notes.join('<br>')}</p>
</div>`,
  }
}
