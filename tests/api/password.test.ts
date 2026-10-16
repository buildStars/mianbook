import { describe, expect, it } from 'vitest'
import { Client, latestCode, latestMail, randomEmail, randomIp } from './helpers'

/** 换一个 IP 但不带登录状态的客户端 */
const fresh = (ip = randomIp()) => Object.assign(new Client(), { ip })

describe('登录防暴力破解', () => {
  it('同一账号同一 IP 输错 5 次后锁 15 分钟，密码对了也不行；换个 IP 不受影响', async () => {
    const u = await new Client().register('brute')
    const attacker = fresh()
    for (let i = 0; i < 5; i++) {
      expect(await attacker.login(u.email, 'wrong-password')).toMatchObject({ status: 401, data: { message: '邮箱或密码不正确' } })
    }
    const locked = await attacker.login(u.email, u.password)
    expect(locked.status).toBe(429)
    expect(locked.data.message).toMatch(/^密码错误次数太多，请 1[45] 分钟后再试/)
    expect(locked.data.data.retryAfter).toBeGreaterThan(800)
    expect((await fresh().login(u.email, u.password)).status).toBe(200)
  })

  it('登录成功后清掉这个 IP 之前的失败次数', async () => {
    const u = await new Client().register('clear')
    const c = fresh()
    for (let i = 0; i < 4; i++) expect((await c.login(u.email, 'nope-nope')).status).toBe(401)
    expect((await c.login(u.email, u.password)).status).toBe(200)
    for (let i = 0; i < 4; i++) expect((await c.login(u.email, 'nope-nope')).status).toBe(401)
    expect((await c.login(u.email, u.password)).status).toBe(200)
  })

  it('同一 IP 对很多账号试密码（撞库）：20 次失败后这个 IP 暂时不能登录', async () => {
    const ip = randomIp()
    for (let i = 0; i < 20; i++) expect((await fresh(ip).login(randomEmail('stuff'), 'password123')).status).toBe(401)
    expect(await fresh(ip).login(randomEmail('stuff'), 'password123')).toMatchObject({ status: 429, data: { message: expect.stringMatching(/^尝试次数太多/) } })
  })

  it('换很多 IP 猜同一个账号：一小时 30 次失败后临时锁定，重置密码可以解锁', async () => {
    const owner = new Client()
    const u = await owner.register('locked')
    for (let i = 0; i < 30; i++) expect((await fresh().login(u.email, `guess-${i}`)).status).toBe(401)
    const locked = await fresh().login(u.email, u.password)
    expect(locked.status).toBe(429)
    expect(locked.data.message).toContain('已临时锁定')

    await owner.json('/api/auth/password-reset/code', { body: { email: u.email } })
    const reset = await fresh().json('/api/auth/password-reset', { body: { email: u.email, code: latestCode(u.email), password: 'brand-new-pass' } })
    expect(reset.status).toBe(200)
    expect((await fresh().login(u.email, 'brand-new-pass')).status).toBe(200)
  })
})

describe('忘记密码', () => {
  it('登录页知道可以重置密码', async () => {
    expect((await new Client().json('/api/auth/options')).data).toMatchObject({ passwordReset: true })
  })

  it('注册过和没注册的邮箱返回一样的结果，只有注册过的才收到邮件', async () => {
    const u = await new Client().register('resetmail')
    const a = await fresh().json('/api/auth/password-reset/code', { body: { email: u.email } })
    const ghost = randomEmail('ghost')
    const b = await fresh().json('/api/auth/password-reset/code', { body: { email: ghost } })
    expect(a).toEqual({ status: 200, data: { cooldown: 60, expiresInMinutes: 10 } })
    expect(b).toEqual(a)
    expect(latestMail(u.email).subject).toMatch(/^\d{6} 是你的重置密码验证码/)
    expect(() => latestMail(ghost)).toThrow()
    // 没注册的邮箱拿不到验证码，重置时的提示和"没获取过验证码"一样
    expect(await fresh().json('/api/auth/password-reset', { body: { email: ghost, code: '123456', password: 'whatever-123' } })).toMatchObject({
      status: 400,
      data: { message: '请先获取邮箱验证码' },
    })
  })

  it('重置后旧密码失效、其他设备的登录失效，当前设备直接登录', async () => {
    const phone = new Client()
    const u = await phone.register('reset')
    expect((await phone.request('/api/progress')).status).toBe(200)

    const laptop = fresh()
    await laptop.json('/api/auth/password-reset/code', { body: { email: u.email } })
    const code = latestCode(u.email)
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0')
    expect(await laptop.json('/api/auth/password-reset', { body: { email: u.email, code: wrong, password: 'new-password-1' } })).toMatchObject({
      status: 400,
      data: { message: '验证码不正确' },
    })
    expect((await laptop.json('/api/auth/password-reset', { body: { email: u.email, code, password: 'short' } })).status).toBe(400)

    const done = await laptop.json('/api/auth/password-reset', { body: { email: u.email, code, password: 'new-password-1' } })
    expect(done).toMatchObject({ status: 200, data: { id: u.id, email: u.email } })
    expect((await laptop.json('/api/_auth/session')).data.user.email).toBe(u.email)

    // 手机上之前的登录失效了
    expect((await phone.request('/api/progress')).status).toBe(401)
    expect((await phone.json('/api/_auth/session')).data.user).toBeUndefined()

    expect((await fresh().login(u.email, u.password)).status).toBe(401)
    expect((await fresh().login(u.email, 'new-password-1')).status).toBe(200)
    // 验证码只能用一次
    expect((await fresh().json('/api/auth/password-reset', { body: { email: u.email, code, password: 'another-pass-2' } })).status).toBe(400)
  })
})
