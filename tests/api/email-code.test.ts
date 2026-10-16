import crypto from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { Client, db, latestCode, latestMail, randomEmail } from './helpers'

const password = () => crypto.randomBytes(12).toString('hex')

/** 一个和真实验证码不同的 6 位数字 */
const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0')

/** 直接往库里插发送记录，用来模拟一小时内已经发过很多次 */
async function insertCodes(rows: number, fields: { email?: string; ip?: string; minutesAgo: number }) {
  for (let i = 0; i < rows; i++) {
    await db().query(
      `INSERT INTO email_codes (email, purpose, code_hash, ip, expires_at, created_at)
       VALUES (?, 'register', ?, ?, UTC_TIMESTAMP() + INTERVAL 10 MINUTE, UTC_TIMESTAMP() - INTERVAL ? MINUTE)`,
      [fields.email ?? randomEmail('filler'), '0'.repeat(64), fields.ip ?? null, fields.minutesAgo],
    )
  }
}

async function admin() {
  const c = new Client()
  const u = await c.register('mailadmin')
  await db().query("UPDATE users SET role = 'admin' WHERE id = ?", [u.id])
  return { c, email: u.email }
}

describe('注册邮箱验证码', () => {
  it('配置了发信时，注册页需要验证码', async () => {
    const { data } = await new Client().json('/api/auth/options')
    expect(data).toEqual({ emailCode: true })
  })

  it('收到验证码后才能注册，邮箱标记为已验证', async () => {
    const c = new Client()
    const email = randomEmail('verify')
    const sent = await c.requestCode(email)
    expect(sent.status).toBe(200)
    expect(sent.data).toEqual({ cooldown: 60, expiresInMinutes: 10 })

    const mail = latestMail(email)
    const code = latestCode(email)
    expect(mail.from).toContain('noreply@example.test')
    expect(mail.text).toContain(code)
    expect(mail.html).toContain(code)

    // 库里只存哈希
    const [[row]] = await db().query<any[]>('SELECT code_hash, ip FROM email_codes WHERE email = ?', [email])
    expect(row.code_hash).toHaveLength(64)
    expect(row.code_hash).not.toContain(code)
    expect(row.ip).toBe(c.ip)

    const body = { email, name: 'verify', password: password() }
    const wrong = await c.json('/api/auth/register', { body: { ...body, code: wrongCode(code) } })
    expect(wrong).toMatchObject({ status: 400, data: { message: '验证码不正确' } })

    const ok = await c.json('/api/auth/register', { body: { ...body, code } })
    expect(ok.status).toBe(200)
    const [[user]] = await db().query<any[]>('SELECT email_verified_at FROM users WHERE email = ?', [email])
    expect(user.email_verified_at).not.toBeNull()
    expect((await c.json('/api/_auth/session')).data?.user?.email).toBe(email)

    // 同一个邮箱不能再注册，也不能再要验证码
    expect((await new Client().json('/api/auth/register', { body: { ...body, code } })).status).toBe(409)
    expect(await new Client().requestCode(email)).toMatchObject({ status: 409, data: { message: '这个邮箱已经注册过了，可以直接登录' } })
  })

  it('没填验证码、格式不对、没获取过验证码时不能注册', async () => {
    const email = randomEmail('nocode')
    const body = { email, name: 'nocode', password: password() }
    const c = new Client()
    expect(await c.json('/api/auth/register', { body })).toMatchObject({ status: 400, data: { message: '请填写邮箱验证码' } })
    expect(await c.json('/api/auth/register', { body: { ...body, code: '12ab56' } })).toMatchObject({ status: 400, data: { message: '验证码是 6 位数字' } })
    expect(await c.json('/api/auth/register', { body: { ...body, code: '123456' } })).toMatchObject({ status: 400, data: { message: '请先获取邮箱验证码' } })
    const [[count]] = await db().query<any[]>('SELECT COUNT(*) AS n FROM users WHERE email = ?', [email])
    expect(count.n).toBe(0)
  })

  it('验证码过期后不能用', async () => {
    const c = new Client()
    const email = randomEmail('expired')
    await c.requestCode(email)
    const code = latestCode(email)
    await db().query('UPDATE email_codes SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE WHERE email = ?', [email])
    const res = await c.json('/api/auth/register', { body: { email, name: 'expired', password: password(), code } })
    expect(res).toMatchObject({ status: 400, data: { message: '验证码已过期，请重新获取' } })
  })

  it('输错 5 次后验证码作废，重新获取后可以注册', async () => {
    const c = new Client()
    const email = randomEmail('guess')
    await c.requestCode(email)
    const code = latestCode(email)
    const body = { email, name: 'guess', password: password() }
    for (let i = 0; i < 5; i++) {
      expect((await c.json('/api/auth/register', { body: { ...body, code: wrongCode(code) } })).data.message).toBe('验证码不正确')
    }
    // 第 6 次即使填对也不行，防止暴力枚举
    expect(await c.json('/api/auth/register', { body: { ...body, code } })).toMatchObject({
      status: 400,
      data: { message: '验证码输错次数太多，请重新获取' },
    })

    // 跳过冷却时间，重新获取
    await db().query('UPDATE email_codes SET created_at = UTC_TIMESTAMP() - INTERVAL 2 MINUTE WHERE email = ?', [email])
    expect((await c.requestCode(email)).status).toBe(200)
    const fresh = latestCode(email)
    expect((await c.json('/api/auth/register', { body: { ...body, code: fresh } })).status).toBe(200)
  })

  it('60 秒内不能重复发送，返回需要等待的秒数', async () => {
    const c = new Client()
    const email = randomEmail('cooldown')
    expect((await c.requestCode(email)).status).toBe(200)
    const again = await c.requestCode(email)
    expect(again.status).toBe(429)
    expect(again.data.message).toMatch(/秒后再试/)
    expect(again.data.data.retryAfter).toBeGreaterThan(0)
    expect(again.data.data.retryAfter).toBeLessThanOrEqual(60)
  })

  it('同一个邮箱一小时最多发 5 次', async () => {
    const email = randomEmail('hourly')
    await insertCodes(5, { email, minutesAgo: 10 })
    const res = await new Client().requestCode(email)
    expect(res).toMatchObject({ status: 429, data: { message: '这个邮箱获取验证码的次数太多了，请一小时后再试' } })
  })

  it('同一个 IP 一小时最多 10 次、一天最多 30 次，换个 IP 不受影响', async () => {
    const c = new Client()
    await insertCodes(10, { ip: c.ip, minutesAgo: 10 })
    expect(await c.requestCode(randomEmail('ip'))).toMatchObject({ status: 429, data: { message: '请求太频繁，请一小时后再试' } })
    expect((await new Client().requestCode(randomEmail('ip'))).status).toBe(200)

    const d = new Client()
    await insertCodes(30, { ip: d.ip, minutesAgo: 120 })
    expect(await d.requestCode(randomEmail('ip'))).toMatchObject({ status: 429, data: { message: '今天的请求次数已用完，请明天再试' } })
  })

  it('邮箱格式不对时不发送', async () => {
    const res = await new Client().requestCode('not-an-email')
    expect(res.status).toBe(400)
  })
})

describe('后台注册设置', () => {
  let a: Awaited<ReturnType<typeof admin>>

  afterAll(async () => {
    // 恢复默认：配置了发信就需要验证码
    await a?.c.json('/api/admin/settings/auth', { method: 'PUT', body: { requireEmailCode: true } })
  })

  it('显示发信状态，可以关闭和重新开启注册验证码', async () => {
    a = await admin()
    const { data } = await a.c.json('/api/admin/settings')
    expect(data.auth).toMatchObject({ emailCode: true, mail: { configured: true, mode: 'outbox' } })
    expect(JSON.stringify(data.auth)).not.toMatch(/pass/i)

    const off = await a.c.json('/api/admin/settings/auth', { method: 'PUT', body: { requireEmailCode: false } })
    expect(off).toMatchObject({ status: 200, data: { emailCode: false } })
    expect((await new Client().json('/api/auth/options')).data).toEqual({ emailCode: false })

    // 关闭后不用验证码也能注册，邮箱不算已验证；也不再发验证码
    const email = randomEmail('noverify')
    const reg = await new Client().json('/api/auth/register', { body: { email, name: 'nv', password: password() } })
    expect(reg.status).toBe(200)
    const [[user]] = await db().query<any[]>('SELECT email_verified_at FROM users WHERE email = ?', [email])
    expect(user.email_verified_at).toBeNull()
    expect((await new Client().requestCode(randomEmail('off'))).status).toBe(400)

    const users = (await a.c.json('/api/admin/users')).data as any[]
    expect(users.find((u) => u.email === email)?.emailVerified).toBe(false)
    expect(users.find((u) => u.email === a.email)?.emailVerified).toBe(true)

    const on = await a.c.json('/api/admin/settings/auth', { method: 'PUT', body: { requireEmailCode: true } })
    expect(on.data).toEqual({ emailCode: true })
    expect((await new Client().json('/api/auth/options')).data).toEqual({ emailCode: true })
  })

  it('给管理员发测试邮件', async () => {
    a ??= await admin()
    const res = await a.c.json('/api/admin/mail/test', { method: 'POST' })
    expect(res).toMatchObject({ status: 200, data: { ok: true, to: a.email } })
    expect(latestMail(a.email).subject).toMatch(/^测试邮件/)
  })

  it('普通用户不能改注册设置、不能发测试邮件', async () => {
    const c = new Client()
    await c.register('plain')
    expect((await c.request('/api/admin/settings/auth', { method: 'PUT', body: { requireEmailCode: false } })).status).toBe(403)
    expect((await c.request('/api/admin/mail/test', { method: 'POST', body: {} })).status).toBe(403)
    expect((await new Client().json('/api/auth/options')).data).toEqual({ emailCode: true })
  })
})
