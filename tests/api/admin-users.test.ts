import fs from 'node:fs'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { Client, baseUrl, db, latestCode, latestMail, questionId, randomIp } from './helpers'

async function admin() {
  const c = new Client()
  const u = await c.register('uadmin')
  await db().query("UPDATE users SET role = 'admin' WHERE id = ?", [u.id])
  return { c, ...u }
}

/** 换一个 IP 但不带登录状态的客户端 */
const fresh = () => Object.assign(new Client(), { ip: randomIp() })

/** 用户在网站上创建访问令牌 */
async function createToken(c: Client) {
  const res = await c.json('/api/tokens', { body: { name: '测试令牌', scope: 'read', expiresInDays: 90 } })
  expect(res.status).toBe(200)
  return res.data as { id: number; token: string; prefix: string }
}

/** 用访问令牌调一次 MCP 的 ping */
const ping = (token: string) =>
  fetch(`${baseUrl()}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  })

/** 发件箱里发给这个邮箱的邮件数 */
const mailCount = (email: string) =>
  fs.readdirSync(inject('outboxDir')).filter((f) => f.endsWith(`-${email.replace(/[^\w.@-]/g, '_')}.json`)).length

const interview = async (c: Client) =>
  c.answer({ questionId: await questionId('02-closure', 'javascript'), answer: '闭包是函数和它定义时所在的词法环境的组合' })

let a: Awaited<ReturnType<typeof admin>>
beforeAll(async () => {
  a = await admin()
})

const put = (id: number, body: unknown) => a.c.json(`/api/admin/users/${id}`, { method: 'PUT', body })
const rowOf = async (id: number) => ((await a.c.json('/api/admin/users')).data as any[]).find((r) => r.id === id)

describe('后台：单独设置用户的 AI 次数', () => {
  it('列表里显示 24 小时用量和生效的上限；自己的 Key、出错、后台写题、24 小时以前的都不算', async () => {
    const u = await new Client().register('quota')
    await db().query('INSERT INTO ai_calls (user_id, kind, status) VALUES ?', [
      [
        [u.id, 'interview', 'ok'],
        [u.id, 'ask', 'aborted'],
        [u.id, 'interview-own', 'ok'],
        [u.id, 'interview', 'error'],
        [u.id, 'author', 'ok'],
      ],
    ])
    await db().query('INSERT INTO ai_calls (user_id, kind, created_at) VALUES (?, ?, UTC_TIMESTAMP() - INTERVAL 25 HOUR)', [u.id, 'interview'])
    expect(await rowOf(u.id)).toMatchObject({ aiUsed24h: 2, aiLimit: inject('dailyLimit'), aiLimitCustom: null, disabledAt: null })
  })

  it('单独设成 2 次：用户看到的剩余次数跟着变，用完后返回 429', async () => {
    const c = new Client()
    const u = await c.register('quota2')
    const saved = await put(u.id, { aiDailyLimit: 2 })
    expect(saved).toMatchObject({ status: 200, data: { id: u.id, aiLimit: 2, aiLimitCustom: 2 } })
    expect((await c.json('/api/ai/status')).data).toMatchObject({ dailyLimit: 2, remaining: 2, blocked: false })

    const first = await interview(c)
    expect(first.done?.remaining).toBe(1)
    await db().query('INSERT INTO ai_calls (user_id, kind) VALUES (?, ?)', [u.id, 'ask'])
    const over = await interview(c)
    expect(over.status).toBe(429)
    expect(over.error?.message).toContain('（2 次）')
    expect((await rowOf(u.id)).aiUsed24h).toBe(2)
  })

  it('设成 0 次：不能用站点的 AI，提示是管理员关闭的；改回跟随全站后恢复', async () => {
    const c = new Client()
    const u = await c.register('quota0')
    await put(u.id, { aiDailyLimit: 0 })
    expect((await c.json('/api/ai/status')).data).toMatchObject({ dailyLimit: 0, remaining: 0, blocked: true })
    const blocked = await interview(c)
    expect(blocked.status).toBe(403)
    expect(blocked.error?.message).toContain('管理员关闭了你使用站点 AI 的权限')

    expect((await put(u.id, { aiDailyLimit: null })).data).toMatchObject({ aiLimit: inject('dailyLimit'), aiLimitCustom: null })
    expect((await c.json('/api/ai/status')).data).toMatchObject({ dailyLimit: inject('dailyLimit'), blocked: false })
    expect((await interview(c)).done).not.toBeNull()
  })

  it('次数要是 0 到 10000 的整数，请求里至少要改一项', async () => {
    const u = await new Client().register('quotabad')
    for (const aiDailyLimit of [-1, 1.5, 10_001, '5']) expect((await put(u.id, { aiDailyLimit })).status).toBe(400)
    expect(await put(u.id, {})).toMatchObject({ status: 400, data: { message: '没有要修改的内容' } })
    expect((await put(999_999_999, { aiDailyLimit: 3 })).status).toBe(404)
  })
})

describe('后台：停用和启用账号', () => {
  it('停用后马上下线，不能登录、不能重置密码，访问令牌也不能用；启用后恢复，旧的登录不会回来', async () => {
    const c = new Client()
    const u = await c.register('disable')
    const token = await createToken(c)
    expect((await ping(token.token)).status).toBe(200)
    const oldCookie = c.cookie

    const res = await put(u.id, { disabled: true })
    expect(res.status).toBe(200)
    expect(res.data.disabledAt).not.toBeNull()
    expect((await c.request('/api/tokens')).status).toBe(401)

    // 密码错误时和普通账号一样，密码对了才说明已停用
    expect(await fresh().login(u.email, 'wrong-password')).toMatchObject({ status: 401, data: { message: '邮箱或密码不正确' } })
    expect(await fresh().login(u.email, u.password)).toMatchObject({ status: 403, data: { message: expect.stringContaining('已被管理员停用') } })

    const denied = await ping(token.token)
    expect(denied.status).toBe(401)
    expect((await denied.json()).error.message).toContain('已被管理员停用')

    // 自助重置：返回结果和没注册的邮箱一样，不发信；后台也不能给停用的账号发
    const before = mailCount(u.email)
    expect((await fresh().json('/api/auth/password-reset/code', { body: { email: u.email } })).status).toBe(200)
    expect(mailCount(u.email)).toBe(before)
    expect((await a.c.json(`/api/admin/users/${u.id}/reset-password`, { method: 'POST' })).status).toBe(400)

    // 再停用一次不会改停用时间
    expect((await put(u.id, { disabled: true })).data.disabledAt).toBe(res.data.disabledAt)

    expect((await put(u.id, { disabled: false })).data.disabledAt).toBeNull()
    expect((await fresh().login(u.email, u.password)).status).toBe(200)
    expect((await ping(token.token)).status).toBe(200)
    const replay = Object.assign(new Client(), { cookie: oldCookie })
    expect((await replay.request('/api/tokens')).status).toBe(401)
  })

  it('停用前发出的重置验证码，停用后也不能用', async () => {
    const u = await new Client().register('disreset')
    await fresh().json('/api/auth/password-reset/code', { body: { email: u.email } })
    const code = latestCode(u.email)
    await put(u.id, { disabled: true })
    const reset = await fresh().json('/api/auth/password-reset', { body: { email: u.email, code, password: 'brand-new-pass' } })
    expect(reset).toMatchObject({ status: 403, data: { message: expect.stringContaining('已被管理员停用') } })
    expect((await fresh().login(u.email, 'brand-new-pass')).status).toBe(401)
  })

  it('不能停用自己，也不能取消自己的管理员身份', async () => {
    const [[me]] = await db().query<any[]>('SELECT id FROM users WHERE email = ?', [a.email])
    expect(await put(me.id, { disabled: true })).toMatchObject({ status: 400, data: { message: '不能停用自己的账号' } })
    expect(await put(me.id, { role: 'user' })).toMatchObject({ status: 400, data: { message: '不能取消自己的管理员身份' } })
    expect((await a.c.request('/api/admin/users')).status).toBe(200)
  })
})

describe('后台：账号操作', () => {
  it('强制下线：所有设备的登录失效，可以重新登录，访问令牌不受影响；不能让自己下线', async () => {
    const c1 = new Client()
    const u = await c1.register('kick')
    const c2 = fresh()
    expect((await c2.login(u.email, u.password)).status).toBe(200)
    const token = await createToken(c1)

    expect((await a.c.json(`/api/admin/users/${u.id}/logout`, { method: 'POST' })).status).toBe(200)
    expect((await c1.request('/api/tokens')).status).toBe(401)
    expect((await c2.request('/api/tokens')).status).toBe(401)
    expect((await ping(token.token)).status).toBe(200)
    expect((await fresh().login(u.email, u.password)).status).toBe(200)

    const [[me]] = await db().query<any[]>('SELECT id FROM users WHERE email = ?', [a.email])
    expect((await a.c.json(`/api/admin/users/${me.id}/logout`, { method: 'POST' })).status).toBe(400)
    expect((await a.c.json('/api/admin/users/999999999/logout', { method: 'POST' })).status).toBe(404)
  })

  it('解除登录锁定：详情里能看到失败次数和被锁的 IP，解除后马上能登录', async () => {
    const u = await new Client().register('unlock')
    const attacker = fresh()
    for (let i = 0; i < 5; i++) expect((await attacker.login(u.email, 'wrong-password')).status).toBe(401)
    expect((await attacker.login(u.email, u.password)).status).toBe(429)

    const detail = (await a.c.json(`/api/admin/users/${u.id}`)).data
    expect(detail.login).toMatchObject({ failures: 5, accountLocked: false, lockedIps: 1 })
    expect(detail.login.lastFailureAt).not.toBeNull()

    expect((await a.c.json(`/api/admin/users/${u.id}/unlock`, { method: 'POST' })).status).toBe(200)
    expect((await a.c.json(`/api/admin/users/${u.id}`)).data.login).toMatchObject({ failures: 0, lockedIps: 0, lastFailureAt: null })
    expect((await attacker.login(u.email, u.password)).status).toBe(200)
  })

  it('发重置密码邮件：邮件说明是管理员发起的，用户用验证码自己设置新密码', async () => {
    const u = await new Client().register('adminreset')
    const sent = await a.c.json(`/api/admin/users/${u.id}/reset-password`, { method: 'POST' })
    expect(sent).toMatchObject({ status: 200, data: { to: u.email } })
    const mail = latestMail(u.email)
    expect(mail.text).toContain('管理员为你')
    expect(mail.text).toContain('原来的密码仍然可以使用')

    // 重置之前原密码仍然有效
    expect((await fresh().login(u.email, u.password)).status).toBe(200)
    const reset = await fresh().json('/api/auth/password-reset', { body: { email: u.email, code: latestCode(u.email), password: 'reset-by-admin' } })
    expect(reset.status).toBe(200)
    expect((await fresh().login(u.email, 'reset-by-admin')).status).toBe(200)
  })

  it('撤销用户的访问令牌：马上失效；别人的令牌、已撤销的令牌返回 404', async () => {
    const c = new Client()
    const u = await c.register('revoke')
    const token = await createToken(c)
    const other = await createToken(a.c)

    const listed = (await a.c.json(`/api/admin/users/${u.id}`)).data.tokens
    expect(listed).toEqual([expect.objectContaining({ id: token.id, name: '测试令牌', prefix: token.prefix, scope: 'read' })])
    expect(JSON.stringify(listed)).not.toContain(token.token)

    expect((await a.c.request(`/api/admin/users/${u.id}/tokens/${other.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await a.c.request(`/api/admin/users/${u.id}/tokens/${token.id}`, { method: 'DELETE' })).status).toBe(200)
    expect((await ping(token.token)).status).toBe(401)
    expect((await a.c.request(`/api/admin/users/${u.id}/tokens/${token.id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await ping(other.token)).status).toBe(200)
  })
})

describe('后台：用户详情', () => {
  it('学习情况和最近 30 天的 AI 用量；不返回笔记内容', async () => {
    const u = await new Client().register('detail')
    const [rows] = await db().query<any[]>('SELECT id FROM questions ORDER BY id LIMIT 4')
    const q = rows.map((r) => r.id)
    await db().query('INSERT INTO study_records (user_id, question_id, status, starred, note) VALUES ?', [
      [
        [u.id, q[0], 'mastered', true, '只有自己能看的笔记'],
        [u.id, q[1], 'mastered', false, null],
        [u.id, q[2], 'fuzzy', true, ''],
        [u.id, q[3], 'weak', false, null],
      ],
    ])
    await db().query('INSERT INTO ai_calls (user_id, kind, status, prompt_tokens, completion_tokens, model, error) VALUES ?', [
      [
        [u.id, 'interview', 'ok', 1000, 500, 'mock-model', null],
        [u.id, 'interview', 'error', null, null, 'mock-model', '502 AI 服务出错'],
        [u.id, 'ask-own', 'ok', 800, 200, 'my-model', null],
      ],
    ])

    const { status, data } = await a.c.json(`/api/admin/users/${u.id}`)
    expect(status).toBe(200)
    expect(data.user).toMatchObject({ id: u.id, aiUsed24h: 1, mastered: 2 })
    expect(data.defaultLimit).toBe(inject('dailyLimit'))
    expect(data.mailConfigured).toBe(true)
    expect(data.study).toEqual({ mastered: 2, fuzzy: 1, weak: 1, starred: 2, notes: 1, cards: 0, due: 0 })
    expect(data.practice).toEqual({ interviews: 0, mocks: 0, mocksFinished: 0, agents: 0 })
    expect(data.ai).toMatchObject({
      site: 2,
      own: 1,
      errors: 1,
      promptTokens: 1000,
      completionTokens: 500,
      cost: null,
      byKind: [
        { kind: 'interview', site: 2, own: 0, errors: 1 },
        { kind: 'ask', site: 0, own: 1, errors: 0 },
      ],
    })
    expect(data.ai.recent).toHaveLength(3)
    expect(data.ai.recent[0]).toMatchObject({ kind: 'ask-own', model: 'my-model', status: 'ok', tokens: 1000 })
    expect(data.ai.recent[1]).toMatchObject({ kind: 'interview', status: 'error', tokens: null, error: '502 AI 服务出错' })
    expect(data.tokens).toEqual([])
    expect(JSON.stringify(data)).not.toContain('只有自己能看的笔记')
    expect(JSON.stringify(data)).not.toMatch(/password|session_?version/i)

    expect((await a.c.request('/api/admin/users/999999999')).status).toBe(404)
  })

  it('普通用户和没登录的都不能用这些接口', async () => {
    const c = new Client()
    const u = await c.register('plainuser')
    const calls: [string, string, unknown?][] = [
      ['GET', `/api/admin/users/${u.id}`],
      ['PUT', `/api/admin/users/${u.id}`, { aiDailyLimit: 1000 }],
      ['POST', `/api/admin/users/${u.id}/logout`, {}],
      ['POST', `/api/admin/users/${u.id}/unlock`, {}],
      ['POST', `/api/admin/users/${u.id}/reset-password`, {}],
      ['DELETE', `/api/admin/users/${u.id}/tokens/1`],
    ]
    for (const [method, path, body] of calls) {
      expect((await c.request(path, { method, body })).status).toBe(403)
      expect((await new Client().request(path, { method, body })).status).toBe(401)
    }
    expect((await rowOf(u.id)).aiLimitCustom).toBeNull()
  })
})
